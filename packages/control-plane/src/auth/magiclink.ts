import { randomBytes } from "node:crypto";
import { sha256Hex } from "@smallcloud/shared";
import type { Database } from "../db/database.js";
import { createSession, createUser, getUserByEmail } from "../db/repos.js";
import { recordAudit } from "../server/audit.js";

export const LOGIN_TOKEN_TTL_MS = 15 * 60_000;
export const SESSION_TTL_MS = 30 * 24 * 60 * 60_000;

export interface IssuedLoginToken {
  /** Goes into the magic link. Shown to the requester, never stored. */
  rawToken: string;
  expiresAt: string;
}

export interface RedeemedSession {
  /** Goes into the session cookie. Never stored. */
  sessionToken: string;
  expiresAt: string;
  userId: string;
}

export function issueLoginToken(
  db: Database,
  email: string,
  nowMs: number = Date.now(),
): IssuedLoginToken {
  const rawToken = randomBytes(32).toString("hex");
  const expiresAt = new Date(nowMs + LOGIN_TOKEN_TTL_MS).toISOString();
  db.prepare("INSERT INTO login_tokens (token_hash, email, expires_at) VALUES (?, ?, ?)").run(
    sha256Hex(rawToken),
    email,
    expiresAt,
  );
  recordAudit(db, { actor: email, action: "login.issue", subject: "magic-link" });
  return { rawToken, expiresAt };
}

/**
 * Single-use redemption: marks the token used, creates the user on first
 * login, and mints a session. Expired, used, or unknown tokens all fail the
 * same way (undefined) so callers can't distinguish them.
 */
export function redeemLoginToken(
  db: Database,
  rawToken: string,
  nowMs: number = Date.now(),
): RedeemedSession | undefined {
  const nowIso = new Date(nowMs).toISOString();
  const tokenHash = sha256Hex(rawToken);

  db.exec("BEGIN");
  try {
    const row = db
      .prepare(
        "SELECT email FROM login_tokens WHERE token_hash = ? AND used_at IS NULL AND expires_at > ?",
      )
      .get(tokenHash, nowIso) as { email: string } | undefined;
    if (!row) {
      db.exec("ROLLBACK");
      return undefined;
    }

    db.prepare("UPDATE login_tokens SET used_at = ? WHERE token_hash = ?").run(nowIso, tokenHash);

    const user = getUserByEmail(db, row.email) ?? createUser(db, row.email);
    const sessionToken = randomBytes(32).toString("hex");
    const expiresAt = new Date(nowMs + SESSION_TTL_MS).toISOString();
    createSession(db, { tokenHash: sha256Hex(sessionToken), userId: user.id, expiresAt });

    db.exec("COMMIT");
    recordAudit(db, { actor: user.email, action: "login.redeem", subject: "session" });
    return { sessionToken, expiresAt, userId: user.id };
  } catch (err) {
    db.exec("ROLLBACK");
    throw err;
  }
}

export function purgeExpiredLoginTokens(db: Database, nowMs: number = Date.now()): number {
  const result = db
    .prepare("DELETE FROM login_tokens WHERE expires_at <= ? OR used_at IS NOT NULL")
    .run(new Date(nowMs).toISOString());
  return Number(result.changes);
}
