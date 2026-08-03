import { randomBytes, randomUUID } from "node:crypto";
import { sha256Hex } from "@smallcloud/shared";
import type { Database } from "../db/database.js";
import { getAppByName, getUserById } from "../db/repos.js";
import { recordAudit } from "../server/audit.js";

function appNameById(db: Database, appId: string): string {
  const row = db.prepare("SELECT name FROM apps WHERE id = ?").get(appId) as
    | { name: string }
    | undefined;
  return row?.name ?? appId;
}

export type ShareRole = "editor" | "viewer";
export type AppRole = "owner" | ShareRole;

export interface ShareLink {
  /** Goes into the share URL. Never stored. */
  rawToken: string;
  role: ShareRole;
}

export function createShareLink(db: Database, appId: string, role: ShareRole): ShareLink {
  const rawToken = randomBytes(32).toString("hex");
  db.prepare("INSERT INTO share_links (token_hash, app_id, role) VALUES (?, ?, ?)").run(
    sha256Hex(rawToken),
    appId,
    role,
  );
  recordAudit(db, { actor: "owner", action: "share.create", subject: appNameById(db, appId), detail: role });
  return { rawToken, role };
}

/**
 * Attaches the link's role to a signed-in user. Idempotent per (app, user);
 * a fresh redemption upgrades or refreshes the active grant.
 */
export function redeemShareLink(db: Database, rawToken: string, userId: string): boolean {
  const link = db
    .prepare("SELECT app_id, role FROM share_links WHERE token_hash = ? AND revoked_at IS NULL")
    .get(sha256Hex(rawToken)) as { app_id: string; role: ShareRole } | undefined;
  if (!link) return false;

  db.exec("BEGIN");
  try {
    db.prepare(
      "UPDATE grants SET revoked_at = strftime('%Y-%m-%dT%H:%M:%fZ','now') WHERE app_id = ? AND user_id = ? AND revoked_at IS NULL",
    ).run(link.app_id, userId);
    db.prepare("INSERT INTO grants (id, app_id, user_id, role) VALUES (?, ?, ?, ?)").run(
      randomUUID(),
      link.app_id,
      userId,
      link.role,
    );
    db.exec("COMMIT");
    recordAudit(db, {
      actor: getUserById(db, userId)?.email ?? userId,
      action: "share.redeem",
      subject: appNameById(db, link.app_id),
      detail: link.role,
    });
    return true;
  } catch (err) {
    db.exec("ROLLBACK");
    throw err;
  }
}

export function revokeShareLinks(db: Database, appId: string): number {
  const result = db
    .prepare(
      "UPDATE share_links SET revoked_at = strftime('%Y-%m-%dT%H:%M:%fZ','now') WHERE app_id = ? AND revoked_at IS NULL",
    )
    .run(appId);
  return Number(result.changes);
}

export function revokeGrant(db: Database, appId: string, userId: string): boolean {
  const result = db
    .prepare(
      "UPDATE grants SET revoked_at = strftime('%Y-%m-%dT%H:%M:%fZ','now') WHERE app_id = ? AND user_id = ? AND revoked_at IS NULL",
    )
    .run(appId, userId);
  const revoked = Number(result.changes) > 0;
  if (revoked) {
    recordAudit(db, {
      actor: "owner",
      action: "share.revoke",
      subject: appNameById(db, appId),
      detail: getUserById(db, userId)?.email ?? userId,
    });
  }
  return revoked;
}

/** Owner beats grants; otherwise the active grant's role; otherwise nothing. */
export function getRoleForUser(db: Database, appId: string, userId: string): AppRole | undefined {
  const owner = db
    .prepare("SELECT 1 FROM apps WHERE id = ? AND owner_user_id = ? AND deleted_at IS NULL")
    .get(appId, userId);
  if (owner) return "owner";

  const grant = db
    .prepare("SELECT role FROM grants WHERE app_id = ? AND user_id = ? AND revoked_at IS NULL")
    .get(appId, userId) as { role: ShareRole } | undefined;
  return grant?.role;
}

const READ_METHODS = new Set(["GET", "HEAD", "OPTIONS"]);

/**
 * The per-app authorization rule the auth proxy enforces on every request:
 * owner/editor → everything; viewer → read-only methods; no role → nothing.
 */
export function isAllowed(db: Database, appName: string, userId: string, method: string): boolean {
  const app = getAppByName(db, appName);
  if (!app) return false;
  const role = getRoleForUser(db, app.id, userId);
  if (!role) return false;
  if (role === "viewer") return READ_METHODS.has(method.toUpperCase());
  return true;
}
