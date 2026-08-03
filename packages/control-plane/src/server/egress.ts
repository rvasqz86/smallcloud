import { randomBytes } from "node:crypto";
import { sha256Hex } from "@smallcloud/shared";
import type { Database } from "../db/database.js";
import { getAppByName } from "../db/repos.js";
import { recordAudit } from "./audit.js";

export const EGRESS_CONTAINER = "sc-egress";
export const EGRESS_ORIGIN_HOST = `${EGRESS_CONTAINER}:3128`;

const HOSTNAME_RE = /^[a-z0-9.-]+$/i;

/** Replaces an app's egress allowlist. Empty list = no egress (the default). */
export function setAppEgress(db: Database, appId: string, hostnames: string[]): string[] {
  const cleaned = [...new Set(hostnames.map((h) => h.trim().toLowerCase()).filter(Boolean))];
  for (const hostname of cleaned) {
    if (!HOSTNAME_RE.test(hostname)) {
      throw new Error(`Invalid egress hostname: ${hostname}`);
    }
  }
  db.exec("BEGIN");
  try {
    db.prepare("DELETE FROM app_egress WHERE app_id = ?").run(appId);
    for (const hostname of cleaned) {
      db.prepare("INSERT INTO app_egress (app_id, hostname) VALUES (?, ?)").run(appId, hostname);
    }
    db.exec("COMMIT");
  } catch (err) {
    db.exec("ROLLBACK");
    throw err;
  }
  recordAudit(db, {
    actor: "operator",
    action: "egress.allow",
    subject: appId,
    detail: cleaned.join(",") || "(none)",
  });
  return cleaned;
}

export function getAppEgress(db: Database, appId: string): string[] {
  return (
    db.prepare("SELECT hostname FROM app_egress WHERE app_id = ? ORDER BY hostname").all(appId) as Array<{
      hostname: string;
    }>
  ).map((r) => r.hostname);
}

/**
 * Rotates the app's egress credential. The raw token is only ever in the
 * container's environment; we store its hash. Each deploy mints a fresh one.
 */
export function rotateEgressToken(db: Database, appId: string): string {
  const rawToken = randomBytes(32).toString("hex");
  db.prepare("UPDATE apps SET egress_token_hash = ? WHERE id = ?").run(sha256Hex(rawToken), appId);
  return rawToken;
}

/** Proxy Basic-auth check: username "sc-<app>", password = the app's token. */
export function authenticateEgress(
  db: Database,
  username: string,
  password: string,
): string | undefined {
  if (!username.startsWith("sc-")) return undefined;
  const appName = username.slice(3);
  const app = getAppByName(db, appName);
  if (!app) return undefined;
  const row = db.prepare("SELECT egress_token_hash FROM apps WHERE id = ?").get(app.id) as
    | { egress_token_hash: string | null }
    | undefined;
  if (!row?.egress_token_hash) return undefined;
  return row.egress_token_hash === sha256Hex(password) ? appName : undefined;
}

export function isEgressAllowed(db: Database, appName: string, hostname: string): boolean {
  const app = getAppByName(db, appName);
  if (!app) return false;
  return getAppEgress(db, app.id).includes(hostname.toLowerCase());
}
