import http from "node:http";
import type { AddressInfo } from "node:net";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { hostToAppName } from "./host.js";
import { createAuthProxy } from "./server.js";
import { SESSION_COOKIE, hashToken } from "./session.js";

const VALID_TOKEN = "raw-token-123";
const VIEWER_TOKEN = "raw-token-viewer";
const STRANGER_TOKEN = "raw-token-stranger";
const BASE = { baseDomain: "osita.ai", appPrefix: "sc-" };

let upstream: http.Server;
let proxy: http.Server;
let proxyPort: number;
let upstreamRequests: Array<{ url: string; user: string | undefined }>;
let issuedLinks: Array<{ email: string; host: string }>;
const revokedHashes = new Set<string>();

beforeAll(async () => {
  upstreamRequests = [];
  upstream = http.createServer((req, res) => {
    upstreamRequests.push({
      url: req.url ?? "",
      user: req.headers["x-smallcloud-user"] as string | undefined,
    });
    res.writeHead(200, { "content-type": "text/plain", "x-app-custom": "yes" });
    res.end("app says hi");
  });
  await new Promise<void>((r) => upstream.listen(0, "127.0.0.1", r));
  const upstreamPort = (upstream.address() as AddressInfo).port;

  issuedLinks = [];
  proxy = createAuthProxy({
    ...BASE,
    validateSession: (tokenHash) => {
      if (revokedHashes.has(tokenHash)) return undefined;
      if (tokenHash === hashToken(VALID_TOKEN)) return { userId: "user-1" };
      if (tokenHash === hashToken(VIEWER_TOKEN)) return { userId: "viewer-1" };
      if (tokenHash === hashToken(STRANGER_TOKEN)) return { userId: "stranger-1" };
      return undefined;
    },
    resolveUpstream: (app) =>
      app === "todo" ? `http://127.0.0.1:${upstreamPort}` : undefined,
    authorize: (userId, _app, method) => {
      if (userId === "user-1") return true; // owner in these tests
      if (userId === "viewer-1") return ["GET", "HEAD", "OPTIONS"].includes(method);
      return false;
    },
    workspace: {
      appName: "home",
      render: (userId) => `<h1>workspace for ${userId}</h1>`,
    },
    auth: {
      requestLoginLink: (email, host) => issuedLinks.push({ email, host }),
      redeemLoginToken: (raw) =>
        raw === "good-login-token"
          ? { sessionToken: VALID_TOKEN, expiresAt: new Date(Date.now() + 60_000).toISOString() }
          : undefined,
      logout: (tokenHash) => revokedHashes.add(tokenHash),
    },
  });
  await new Promise<void>((r) => proxy.listen(0, "127.0.0.1", r));
  proxyPort = (proxy.address() as AddressInfo).port;
});

afterAll(async () => {
  await new Promise((r) => proxy.close(r));
  await new Promise((r) => upstream.close(r));
});

interface TestResponse {
  status: number;
  body: string;
}

function request(
  path: string,
  headers: Record<string, string> = {},
  host = "sc-todo.osita.ai",
): Promise<TestResponse> {
  return new Promise((resolve, reject) => {
    const req = http.request(
      { host: "127.0.0.1", port: proxyPort, path, headers: { host, ...headers } },
      (res) => {
        let body = "";
        res.on("data", (chunk: Buffer) => (body += chunk.toString()));
        res.on("end", () => resolve({ status: res.statusCode ?? 0, body }));
      },
    );
    req.on("error", reject);
    req.end();
  });
}

describe("hostToAppName", () => {
  it("extracts the app from a prefixed subdomain", () => {
    expect(hostToAppName("sc-todo.osita.ai", BASE)).toBe("todo");
    expect(hostToAppName("sc-my-app.osita.ai:443", BASE)).toBe("my-app");
  });

  it("rejects hosts outside the namespace", () => {
    expect(hostToAppName("todo.osita.ai", BASE)).toBeUndefined();
    expect(hostToAppName("sc-todo.evil.com", BASE)).toBeUndefined();
    expect(hostToAppName("deep.sc-todo.osita.ai", BASE)).toBeUndefined();
    expect(hostToAppName("sc-.osita.ai", BASE)).toBeUndefined();
    expect(hostToAppName(undefined, BASE)).toBeUndefined();
  });
});

describe("auth wall", () => {
  it("401s without a session cookie and never touches the upstream", async () => {
    const before = upstreamRequests.length;
    const res = await request("/secret-page");
    expect(res.status).toBe(401);
    expect(upstreamRequests.length).toBe(before);
  });

  it("401s with an invalid session cookie", async () => {
    const before = upstreamRequests.length;
    const res = await request("/", { cookie: `${SESSION_COOKIE}=wrong-token` });
    expect(res.status).toBe(401);
    expect(upstreamRequests.length).toBe(before);
  });

  it("proxies authenticated requests and stamps the user header", async () => {
    const res = await request("/hello?x=1", {
      cookie: `${SESSION_COOKIE}=${VALID_TOKEN}`,
    });
    expect(res.status).toBe(200);
    expect(res.body).toBe("app says hi");
    expect(upstreamRequests.at(-1)).toEqual({ url: "/hello?x=1", user: "user-1" });
  });

  it("404s unknown hosts", async () => {
    const res = await request("/", {}, "sc-nope.evil.com");
    expect(res.status).toBe(404);
  });

  it("502s for apps with no running upstream — still authenticated only", async () => {
    const unauth = await request("/", {}, "sc-ghost.osita.ai");
    expect(unauth.status).toBe(401);

    const auth = await request(
      "/",
      { cookie: `${SESSION_COOKIE}=${VALID_TOKEN}` },
      "sc-ghost.osita.ai",
    );
    expect(auth.status).toBe(502);
  });

  it("keeps the /_sc/ control namespace off the app", async () => {
    const res = await request("/_sc/anything", {
      cookie: `${SESSION_COOKIE}=${VALID_TOKEN}`,
    });
    expect(res.status).toBe(404);
    expect(upstreamRequests.every((r) => !r.url.startsWith("/_sc/"))).toBe(true);
  });
});

describe("per-app authorization", () => {
  it("403s an authenticated user with no role", async () => {
    const res = await request("/", { cookie: `${SESSION_COOKIE}=${STRANGER_TOKEN}` });
    expect(res.status).toBe(403);
  });

  it("limits viewers to read methods", async () => {
    const read = await request("/", { cookie: `${SESSION_COOKIE}=${VIEWER_TOKEN}` });
    expect(read.status).toBe(200);

    const write = await new Promise<TestResponse>((resolve, reject) => {
      const req = http.request(
        {
          host: "127.0.0.1",
          port: proxyPort,
          path: "/",
          method: "POST",
          headers: { host: "sc-todo.osita.ai", cookie: `${SESSION_COOKIE}=${VIEWER_TOKEN}` },
        },
        (r) => {
          let body = "";
          r.on("data", (c: Buffer) => (body += c.toString()));
          r.on("end", () => resolve({ status: r.statusCode ?? 0, body }));
        },
      );
      req.on("error", reject);
      req.end();
    });
    expect(write.status).toBe(403);
  });
});

describe("workspace host", () => {
  it("requires a session", async () => {
    const res = await request("/", {}, "sc-home.osita.ai");
    expect(res.status).toBe(401);
  });

  it("serves the rendered workspace to signed-in users", async () => {
    const res = await request(
      "/",
      { cookie: `${SESSION_COOKIE}=${VALID_TOKEN}` },
      "sc-home.osita.ai",
    );
    expect(res.status).toBe(200);
    expect(res.body).toContain("workspace for user-1");
  });

  it("still serves the login flow on the workspace host", async () => {
    const res = await request("/_sc/login", {}, "sc-home.osita.ai");
    expect(res.status).toBe(200);
    expect(res.body).toContain('action="/_sc/login"');
  });
});

describe("security headers", () => {
  function withHeaders(path: string, headers: Record<string, string> = {}) {
    return new Promise<http.IncomingHttpHeaders>((resolve, reject) => {
      const req = http.request(
        { host: "127.0.0.1", port: proxyPort, path, headers: { host: "sc-todo.osita.ai", ...headers } },
        (r) => {
          r.resume();
          r.on("end", () => resolve(r.headers));
        },
      );
      req.on("error", reject);
      req.end();
    });
  }

  it("hardens Smallcloud's own pages", async () => {
    const headers = await withHeaders("/_sc/login");
    expect(headers["strict-transport-security"]).toContain("max-age=");
    expect(headers["content-security-policy"]).toContain("default-src 'none'");
    expect(headers["x-frame-options"]).toBe("DENY");
    expect(headers["x-content-type-options"]).toBe("nosniff");
    expect(headers["referrer-policy"]).toBe("no-referrer");
  });

  it("adds only HSTS to app responses, preserving their headers", async () => {
    const headers = await withHeaders("/", { cookie: `${SESSION_COOKIE}=${VALID_TOKEN}` });
    expect(headers["strict-transport-security"]).toContain("max-age=");
    expect(headers["x-app-custom"]).toBe("yes");
    expect(headers["content-security-policy"]).toBeUndefined();
    expect(headers["x-frame-options"]).toBeUndefined();
  });
});

describe("logout", () => {
  it("revokes the session and clears the cookie", async () => {
    const LOGOUT_TOKEN = "raw-token-logout-test";
    // make it valid first
    revokedHashes.delete(hashToken(LOGOUT_TOKEN));
    // it maps to no user in validateSession, so use the viewer token instead
    const before = await request("/", { cookie: `${SESSION_COOKIE}=${VIEWER_TOKEN}` });
    expect(before.status).toBe(200);

    const res = await new Promise<{ status: number; setCookie: string | undefined; location: string | undefined }>(
      (resolve, reject) => {
        const req = http.request(
          {
            host: "127.0.0.1",
            port: proxyPort,
            path: "/_sc/logout",
            headers: { host: "sc-todo.osita.ai", cookie: `${SESSION_COOKIE}=${VIEWER_TOKEN}` },
          },
          (r) => {
            r.resume();
            resolve({
              status: r.statusCode ?? 0,
              setCookie: r.headers["set-cookie"]?.[0],
              location: r.headers.location,
            });
          },
        );
        req.on("error", reject);
        req.end();
      },
    );
    expect(res.status).toBe(302);
    expect(res.location).toBe("/_sc/login");
    expect(res.setCookie).toContain(`${SESSION_COOKIE}=;`);
    expect(res.setCookie).toContain("Expires=Thu, 01 Jan 1970");

    const after = await request("/", { cookie: `${SESSION_COOKIE}=${VIEWER_TOKEN}` });
    expect(after.status).toBe(401);
  });
});

describe("rate limiting", () => {
  it("429s sensitive auth endpoints after the burst is exhausted", async () => {
    const upstreamLocal = http.createServer((_q, s) => s.end("x"));
    await new Promise<void>((r) => upstreamLocal.listen(0, "127.0.0.1", r));
    const limited = createAuthProxy({
      ...BASE,
      validateSession: () => undefined,
      resolveUpstream: () => undefined,
      authorize: () => false,
      authRateLimit: { capacity: 2, refillPerSec: 0.001 },
      auth: { requestLoginLink: () => undefined, redeemLoginToken: () => undefined },
    });
    await new Promise<void>((r) => limited.listen(0, "127.0.0.1", r));
    const port = (limited.address() as AddressInfo).port;

    const hit = () =>
      new Promise<number>((resolve, reject) => {
        const req = http.request(
          { host: "127.0.0.1", port, path: "/_sc/auth?token=x", headers: { host: "sc-todo.osita.ai" } },
          (r) => {
            r.resume();
            resolve(r.statusCode ?? 0);
          },
        );
        req.on("error", reject);
        req.end();
      });

    expect(await hit()).toBe(400); // invalid token, but allowed through
    expect(await hit()).toBe(400);
    expect(await hit()).toBe(429); // bucket exhausted
    expect(await hit()).toBe(429);

    // the un-limited login form still answers
    const form = await new Promise<number>((resolve, reject) => {
      const req = http.request(
        { host: "127.0.0.1", port, path: "/_sc/login", headers: { host: "sc-todo.osita.ai" } },
        (r) => {
          r.resume();
          resolve(r.statusCode ?? 0);
        },
      );
      req.on("error", reject);
      req.end();
    });
    expect(form).toBe(200);

    await new Promise((r) => limited.close(r));
    await new Promise((r) => upstreamLocal.close(r));
  });
});

describe("magic-link routes", () => {
  it("serves the login form without a session", async () => {
    const res = await request("/_sc/login");
    expect(res.status).toBe(200);
    expect(res.body).toContain('action="/_sc/login"');
  });

  it("issues a link on POST and does not leak whether the email exists", async () => {
    const res = await new Promise<TestResponse>((resolve, reject) => {
      const req = http.request(
        {
          host: "127.0.0.1",
          port: proxyPort,
          path: "/_sc/login",
          method: "POST",
          headers: {
            host: "sc-todo.osita.ai",
            "content-type": "application/x-www-form-urlencoded",
          },
        },
        (r) => {
          let body = "";
          r.on("data", (c: Buffer) => (body += c.toString()));
          r.on("end", () => resolve({ status: r.statusCode ?? 0, body }));
        },
      );
      req.on("error", reject);
      req.end("email=Builder%40Example.com");
    });
    expect(res.status).toBe(200);
    expect(issuedLinks).toEqual([{ email: "builder@example.com", host: "sc-todo.osita.ai" }]);
  });

  it("redeems a valid token into a session cookie and redirects", async () => {
    const res = await new Promise<{ status: number; setCookie: string | undefined; location: string | undefined }>(
      (resolve, reject) => {
        const req = http.request(
          {
            host: "127.0.0.1",
            port: proxyPort,
            path: "/_sc/auth?token=good-login-token",
            headers: { host: "sc-todo.osita.ai" },
          },
          (r) => {
            r.resume();
            resolve({
              status: r.statusCode ?? 0,
              setCookie: r.headers["set-cookie"]?.[0],
              location: r.headers.location,
            });
          },
        );
        req.on("error", reject);
        req.end();
      },
    );
    expect(res.status).toBe(302);
    expect(res.location).toBe("/");
    expect(res.setCookie).toContain(`${SESSION_COOKIE}=${VALID_TOKEN}`);
    expect(res.setCookie).toContain("HttpOnly");
    expect(res.setCookie).toContain("Secure");
  });

  it("rejects a bad token", async () => {
    const res = await request("/_sc/auth?token=nope");
    expect(res.status).toBe(400);
  });
});
