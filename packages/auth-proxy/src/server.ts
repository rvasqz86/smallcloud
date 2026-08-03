import http from "node:http";
import type { HostConfig } from "./host.js";
import { hostToAppName } from "./host.js";
import { clientIp, createRateLimiter, type RateLimiter } from "./ratelimit.js";
import type { SessionValidator } from "./session.js";
import { SESSION_COOKIE, hashToken, parseCookies } from "./session.js";

export interface AuthFlow {
  /** Issues a magic link for the email. Delivery is the composition root's job (v0: CLI/log). */
  requestLoginLink(email: string, host: string): void;
  /** Exchanges a raw login token for a raw session token, or undefined if invalid. */
  redeemLoginToken(rawToken: string): { sessionToken: string; expiresAt: string } | undefined;
  /** Attaches a share link's role to the signed-in user. Returns false for invalid/revoked. */
  redeemShareToken?(rawToken: string, userId: string): boolean;
  /** Deletes the session for a logout. */
  logout?(tokenHash: string): void;
}

export interface AuthProxyOptions extends HostConfig {
  validateSession: SessionValidator;
  /** Maps an app name to its upstream origin, e.g. "http://sc-app-todo:8080". */
  resolveUpstream: (appName: string) => string | undefined;
  /** Per-app authorization, checked on every proxied request. */
  authorize: (userId: string, appName: string, method: string) => boolean;
  /** Activity hook for the scale-to-zero reaper. Called on authorized requests. */
  onAppRequest?: (appName: string) => void;
  /** Wakes a sleeping app. Resolves true once it is running again. */
  wakeUpstream?: (appName: string) => Promise<boolean>;
  /** Built-in workspace page served at a reserved app host (no upstream). */
  workspace?: { appName: string; render: (userId: string) => string };
  /** Auth-endpoint rate limit override (defaults: burst 10, ~10/min refill). */
  authRateLimit?: { capacity: number; refillPerSec: number };
  auth: AuthFlow;
}

const CONTROL_PREFIX = "/_sc/";

const HSTS = "max-age=31536000; includeSubDomains";

/** Hardening for Smallcloud's own pages. Apps keep their own headers. */
const CONTROL_PAGE_HEADERS = {
  "strict-transport-security": HSTS,
  "content-security-policy":
    "default-src 'none'; style-src 'unsafe-inline'; form-action 'self'; base-uri 'none'",
  "x-frame-options": "DENY",
  "x-content-type-options": "nosniff",
  "referrer-policy": "no-referrer",
} as const;

function html(res: http.ServerResponse, status: number, body: string): void {
  res.writeHead(status, { "content-type": "text/html; charset=utf-8", ...CONTROL_PAGE_HEADERS });
  res.end(`<!doctype html>${body}`);
}

function text(res: http.ServerResponse, status: number, body: string, extra: Record<string, string> = {}): void {
  res.writeHead(status, {
    "content-type": "text/plain",
    "strict-transport-security": HSTS,
    "x-content-type-options": "nosniff",
    ...extra,
  });
  res.end(body);
}

function redirect(res: http.ServerResponse, headers: Record<string, string | undefined>): void {
  const clean = Object.fromEntries(
    Object.entries(headers).filter(([, v]) => v !== undefined),
  ) as Record<string, string>;
  res.writeHead(302, { ...CONTROL_PAGE_HEADERS, ...clean });
  res.end();
}

const LOGIN_FORM = `<title>Sign in — Smallcloud</title>
<h1>Sign in</h1>
<form method="post" action="/_sc/login">
  <label>Email <input type="email" name="email" required></label>
  <button type="submit">Send magic link</button>
</form>`;

function unauthorized(res: http.ServerResponse): void {
  html(
    res,
    401,
    `<title>Sign in — Smallcloud</title>
<h1>Sign in required</h1>
<p>This app is private. <a href="/_sc/login">Request a magic link</a> to continue.</p>`,
  );
}

function readBody(req: http.IncomingMessage, limit = 4096): Promise<string> {
  return new Promise((resolve, reject) => {
    let body = "";
    req.on("data", (chunk: Buffer) => {
      body += chunk.toString();
      if (body.length > limit) {
        reject(new Error("Body too large"));
        req.destroy();
      }
    });
    req.on("end", () => resolve(body));
    req.on("error", reject);
  });
}

async function handleControlRoute(
  req: http.IncomingMessage,
  res: http.ServerResponse,
  options: AuthProxyOptions,
  rateLimiter: RateLimiter,
): Promise<void> {
  const url = new URL(req.url ?? "/", "http://placeholder");

  // Token-guessing and link-bombing protection: the sensitive operations are
  // POST login (issues links) and the token redemptions; the plain login form
  // GET stays unlimited.
  const sensitive =
    (url.pathname === "/_sc/login" && req.method === "POST") ||
    url.pathname === "/_sc/auth" ||
    url.pathname === "/_sc/share";
  if (sensitive && !rateLimiter(clientIp(req.headers, req.socket.remoteAddress))) {
    text(res, 429, "Too many requests — try again shortly", { "retry-after": "60" });
    return;
  }

  if (url.pathname === "/_sc/login" && req.method === "GET") {
    html(res, 200, LOGIN_FORM);
    return;
  }

  if (url.pathname === "/_sc/login" && req.method === "POST") {
    const body = await readBody(req).catch(() => "");
    const email = new URLSearchParams(body).get("email")?.trim().toLowerCase();
    // Same response with or without a valid email: no account enumeration.
    if (email && email.includes("@")) {
      options.auth.requestLoginLink(email, req.headers.host ?? "");
    }
    html(
      res,
      200,
      `<title>Check your terminal — Smallcloud</title>
<h1>Magic link issued</h1>
<p>If that address is allowed, a sign-in link has been issued. Check where Smallcloud delivers links (v0: the CLI/server log).</p>`,
    );
    return;
  }

  if (url.pathname === "/_sc/share" && req.method === "GET") {
    const cookies = parseCookies(req.headers.cookie);
    const rawSession = cookies[SESSION_COOKIE];
    const session = rawSession ? options.validateSession(hashToken(rawSession)) : undefined;
    if (!session) {
      html(
        res,
        401,
        `<title>Sign in first — Smallcloud</title>
<h1>Sign in to accept this share</h1>
<p><a href="/_sc/login">Sign in with a magic link</a>, then open this share link again.</p>`,
      );
      return;
    }
    const rawToken = url.searchParams.get("token");
    const redeemed =
      rawToken && options.auth.redeemShareToken
        ? options.auth.redeemShareToken(rawToken, session.userId)
        : false;
    if (!redeemed) {
      html(
        res,
        400,
        `<title>Invalid share link — Smallcloud</title>
<h1>Share link invalid or revoked</h1>
<p>Ask the app owner for a fresh link.</p>`,
      );
      return;
    }
    redirect(res, { location: "/" });
    return;
  }

  if (url.pathname === "/_sc/logout") {
    const cookies = parseCookies(req.headers.cookie);
    const rawSession = cookies[SESSION_COOKIE];
    if (rawSession) options.auth.logout?.(hashToken(rawSession));
    redirect(res, {
      location: "/_sc/login",
      "set-cookie": `${SESSION_COOKIE}=; HttpOnly; Secure; SameSite=Lax; Path=/; Expires=Thu, 01 Jan 1970 00:00:00 GMT`,
    });
    return;
  }

  if (url.pathname === "/_sc/auth" && req.method === "GET") {
    const rawToken = url.searchParams.get("token");
    const redeemed = rawToken ? options.auth.redeemLoginToken(rawToken) : undefined;
    if (!redeemed) {
      html(
        res,
        400,
        `<title>Invalid link — Smallcloud</title>
<h1>Link invalid or expired</h1>
<p><a href="/_sc/login">Request a new magic link</a>.</p>`,
      );
      return;
    }
    const expires = new Date(redeemed.expiresAt).toUTCString();
    redirect(res, {
      location: "/",
      "set-cookie": `${SESSION_COOKIE}=${redeemed.sessionToken}; HttpOnly; Secure; SameSite=Lax; Path=/; Expires=${expires}`,
    });
    return;
  }

  text(res, 404, "Not found");
}

/**
 * The auth wall in front of every Smallcloud app. No request reaches an
 * upstream without a valid session — there are no unauthenticated app URLs.
 */
export function createAuthProxy(options: AuthProxyOptions): http.Server {
  const rateLimiter = createRateLimiter({
    capacity: options.authRateLimit?.capacity ?? 10,
    refillPerSec: options.authRateLimit?.refillPerSec ?? 10 / 60,
  });

  return http.createServer((req, res) => {
    const app = hostToAppName(req.headers.host, options);
    if (!app) {
      text(res, 404, "Unknown host");
      return;
    }

    // Control namespace: login flow, never proxied to apps.
    if (req.url?.startsWith(CONTROL_PREFIX)) {
      void handleControlRoute(req, res, options, rateLimiter);
      return;
    }

    const cookies = parseCookies(req.headers.cookie);
    const rawToken = cookies[SESSION_COOKIE];
    const session = rawToken ? options.validateSession(hashToken(rawToken)) : undefined;
    if (!session) {
      unauthorized(res);
      return;
    }

    if (options.workspace && app === options.workspace.appName) {
      html(res, 200, options.workspace.render(session.userId));
      return;
    }

    if (!options.authorize(session.userId, app, req.method ?? "GET")) {
      html(
        res,
        403,
        `<title>No access — Smallcloud</title>
<h1>You don't have access to this app</h1>
<p>Ask the owner for a share link.</p>`,
      );
      return;
    }

    const upstream = options.resolveUpstream(app);
    if (!upstream) {
      text(res, 502, "App is not running");
      return;
    }

    options.onAppRequest?.(app);
    proxyRequest(req, res, options, app, upstream, session.userId, true);
  });
}

const RETRYABLE_METHODS = new Set(["GET", "HEAD", "OPTIONS"]);
const WAKE_RETRY_ATTEMPTS = 20;
const WAKE_RETRY_DELAY_MS = 200;

function proxyRequest(
  req: http.IncomingMessage,
  res: http.ServerResponse,
  options: AuthProxyOptions,
  app: string,
  upstream: string,
  userId: string,
  mayWake: boolean,
): void {
  const fail = (message: string) => {
    if (!res.headersSent) {
      text(res, 502, message);
      return;
    }
    res.end(message);
  };

  const attempt = (onError: (() => void) | undefined) => {
    const target = new URL(req.url ?? "/", upstream);
    const proxied = http.request(
      target,
      {
        method: req.method,
        headers: {
          ...req.headers,
          host: target.host,
          "x-smallcloud-user": userId,
        },
      },
      (upstreamRes) => {
        // App headers pass through untouched — HSTS is the one thing we add.
        res.writeHead(upstreamRes.statusCode ?? 502, {
          ...upstreamRes.headers,
          "strict-transport-security": HSTS,
        });
        upstreamRes.pipe(res);
      },
    );
    proxied.on("error", () => (onError ? onError() : fail("Upstream error")));
    req.pipe(proxied);
  };

  if (!mayWake || !options.wakeUpstream || !RETRYABLE_METHODS.has(req.method ?? "")) {
    attempt(undefined);
    return;
  }

  // A dead upstream usually means the app is scaled to zero: wake it, then
  // retry until it answers — a freshly started container needs a beat for its
  // server to bind and its DNS entry to appear. Read methods only (empty
  // bodies are safe to resend).
  attempt(() => {
    void options.wakeUpstream!(app).then((woken) => {
      if (!woken) {
        fail("App failed to wake");
        return;
      }
      let tries = 0;
      const retry = () => {
        attempt(() => {
          tries += 1;
          if (tries < WAKE_RETRY_ATTEMPTS) setTimeout(retry, WAKE_RETRY_DELAY_MS);
          else fail("App woke but did not answer in time");
        });
      };
      retry();
    });
  });
}
