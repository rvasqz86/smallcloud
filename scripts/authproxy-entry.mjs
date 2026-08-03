#!/usr/bin/env node
/**
 * Container entrypoint for the Smallcloud auth proxy (v0 composition).
 * Runs inside node:22-slim with the repo bind-mounted read-only at /ws and a
 * writable data dir at /data. Apps are reached by container name over the
 * shared internal network (docker DNS) — no docker socket inside.
 */
import net from "node:net";
import {
  createMailSender,
  deleteSession,
  deliverLoginLink,
  recordAudit,
  getUserById,
  getValidSession,
  isAllowed,
  migrate,
  openDatabase,
  redeemLoginToken,
  redeemShareLink,
  renderWorkspacePage,
  touchAppActivity,
} from "../packages/control-plane/dist/index.js";
import { createAuthProxy } from "../packages/auth-proxy/dist/index.js";

const WAKER_SOCK = process.env.SC_WAKER_SOCK ?? "/sock/waker.sock";

// throttled activity writes: at most one per app per 10s
const lastTouched = new Map();
function recordActivity(db, app) {
  const now = Date.now();
  if (now - (lastTouched.get(app) ?? 0) < 10_000) return;
  lastTouched.set(app, now);
  try {
    touchAppActivity(db, app);
  } catch {
    /* activity is best-effort */
  }
}

function wakeViaDaemon(app) {
  return new Promise((resolve) => {
    const conn = net.connect(WAKER_SOCK);
    const timer = setTimeout(() => {
      conn.destroy();
      resolve(false);
    }, 8000);
    let buffer = "";
    conn.on("connect", () => conn.write(JSON.stringify({ app }) + "\n"));
    conn.on("data", (chunk) => {
      buffer += chunk.toString();
      if (!buffer.includes("\n")) return;
      clearTimeout(timer);
      try {
        resolve(JSON.parse(buffer.trim()).ok === true);
      } catch {
        resolve(false);
      }
      conn.end();
    });
    conn.on("error", () => {
      clearTimeout(timer);
      resolve(false);
    });
  });
}

const PORT = Number(process.env.PORT ?? 7777);
const BASE_DOMAIN = process.env.SC_BASE_DOMAIN ?? "osita.ai";
const DB_PATH = process.env.SC_DB ?? "/data/smallcloud.sqlite";

const db = openDatabase(DB_PATH);
migrate(db);

// Email delivery when configured (SC_RESEND_API_KEY + SC_MAIL_FROM env,
// injected from ~/.smallcloud/config.json at container creation); otherwise
// links fall back to this log.
const mailSender = createMailSender({
  resendApiKey: process.env.SC_RESEND_API_KEY,
  mailFrom: process.env.SC_MAIL_FROM,
});
console.log(`magic-link delivery: ${mailSender ? "email (resend)" : "server log"}`);

const proxy = createAuthProxy({
  baseDomain: BASE_DOMAIN,
  appPrefix: "sc-",
  validateSession: (hash) => {
    const s = getValidSession(db, hash);
    return s && { userId: s.userId };
  },
  resolveUpstream: (app) => `http://sc-app-${app}:8080`,
  authorize: (userId, app, method) => isAllowed(db, app, userId, method),
  onAppRequest: (app) => recordActivity(db, app),
  wakeUpstream: (app) => wakeViaDaemon(app),
  workspace: {
    appName: "home",
    render: (userId) =>
      renderWorkspacePage(db, userId, getUserById(db, userId)?.email ?? "unknown", BASE_DOMAIN),
  },
  auth: {
    requestLoginLink: (email, host) => {
      void deliverLoginLink(db, email, host, mailSender).then((delivery) => {
        if (delivery.via === "email") {
          console.log(`MAGIC-LINK ${email} sent by email`);
        } else {
          console.log(`MAGIC-LINK ${email} ${delivery.url}`);
        }
      });
    },
    redeemShareToken: (raw, userId) => redeemShareLink(db, raw, userId),
    logout: (tokenHash) => {
      const session = getValidSession(db, tokenHash);
      if (session) {
        recordAudit(db, {
          actor: getUserById(db, session.userId)?.email ?? session.userId,
          action: "logout",
          subject: "session",
        });
      }
      deleteSession(db, tokenHash);
    },
    redeemLoginToken: (raw) => {
      const r = redeemLoginToken(db, raw);
      return r && { sessionToken: r.sessionToken, expiresAt: r.expiresAt };
    },
  },
});

proxy.listen(PORT, "0.0.0.0", () => {
  console.log(`smallcloud auth proxy listening on :${PORT} for *.${BASE_DOMAIN}`);
});
