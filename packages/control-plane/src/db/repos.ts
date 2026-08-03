import { randomUUID } from "node:crypto";
import { isReservedAppName, isValidAppName } from "@smallcloud/shared";
import type { Database } from "./database.js";

export interface User {
  id: string;
  email: string;
  createdAt: string;
}

export interface App {
  id: string;
  name: string;
  ownerUserId: string;
  createdAt: string;
  deletedAt: string | null;
}

export type DeploymentStatus = "building" | "running" | "stopped" | "failed" | "deleted";

export interface Deployment {
  id: string;
  appId: string;
  status: DeploymentStatus;
  imageRef: string | null;
  containerId: string | null;
  url: string | null;
  createdAt: string;
  updatedAt: string;
}

export interface Session {
  tokenHash: string;
  userId: string;
  createdAt: string;
  expiresAt: string;
}

// --- users ---

export function createUser(db: Database, email: string): User {
  const id = randomUUID();
  db.prepare("INSERT INTO users (id, email) VALUES (?, ?)").run(id, email);
  return getUserByEmail(db, email)!;
}

export function getUserById(db: Database, id: string): User | undefined {
  const row = db
    .prepare("SELECT id, email, created_at FROM users WHERE id = ?")
    .get(id) as { id: string; email: string; created_at: string } | undefined;
  return row && { id: row.id, email: row.email, createdAt: row.created_at };
}

export function getUserByEmail(db: Database, email: string): User | undefined {
  const row = db
    .prepare("SELECT id, email, created_at FROM users WHERE email = ?")
    .get(email) as { id: string; email: string; created_at: string } | undefined;
  return row && { id: row.id, email: row.email, createdAt: row.created_at };
}

// --- apps ---

function rowToApp(row: {
  id: string;
  name: string;
  owner_user_id: string;
  created_at: string;
  deleted_at: string | null;
}): App {
  return {
    id: row.id,
    name: row.name,
    ownerUserId: row.owner_user_id,
    createdAt: row.created_at,
    deletedAt: row.deleted_at,
  };
}

const APP_COLUMNS = "id, name, owner_user_id, created_at, deleted_at";

export function createApp(db: Database, input: { name: string; ownerUserId: string }): App {
  if (!isValidAppName(input.name)) {
    throw new Error(`Invalid app name: ${input.name}`);
  }
  if (isReservedAppName(input.name)) {
    throw new Error(`App name "${input.name}" is reserved by Smallcloud`);
  }
  const id = randomUUID();
  db.prepare("INSERT INTO apps (id, name, owner_user_id) VALUES (?, ?, ?)").run(
    id,
    input.name,
    input.ownerUserId,
  );
  return getAppByName(db, input.name)!;
}

export function getAppByName(db: Database, name: string): App | undefined {
  const row = db
    .prepare(`SELECT ${APP_COLUMNS} FROM apps WHERE name = ? AND deleted_at IS NULL`)
    .get(name) as Parameters<typeof rowToApp>[0] | undefined;
  return row && rowToApp(row);
}

export function listApps(db: Database): App[] {
  const rows = db
    .prepare(`SELECT ${APP_COLUMNS} FROM apps WHERE deleted_at IS NULL ORDER BY name`)
    .all() as Array<Parameters<typeof rowToApp>[0]>;
  return rows.map(rowToApp);
}

export function softDeleteApp(db: Database, id: string): void {
  // The tombstone keeps history but frees the (unique) name for reuse.
  db.prepare(
    `UPDATE apps
     SET deleted_at = strftime('%Y-%m-%dT%H:%M:%fZ','now'),
         name = name || '#deleted-' || substr(id, 1, 8)
     WHERE id = ? AND deleted_at IS NULL`,
  ).run(id);
}

// --- deployments ---

function rowToDeployment(row: {
  id: string;
  app_id: string;
  status: string;
  image_ref: string | null;
  container_id: string | null;
  url: string | null;
  created_at: string;
  updated_at: string;
}): Deployment {
  return {
    id: row.id,
    appId: row.app_id,
    status: row.status as DeploymentStatus,
    imageRef: row.image_ref,
    containerId: row.container_id,
    url: row.url,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  };
}

const DEPLOYMENT_COLUMNS = "id, app_id, status, image_ref, container_id, url, created_at, updated_at";

export function createDeployment(db: Database, appId: string): Deployment {
  const id = randomUUID();
  db.prepare("INSERT INTO deployments (id, app_id, status) VALUES (?, ?, 'building')").run(
    id,
    appId,
  );
  return getDeployment(db, id)!;
}

export function getDeployment(db: Database, id: string): Deployment | undefined {
  const row = db
    .prepare(`SELECT ${DEPLOYMENT_COLUMNS} FROM deployments WHERE id = ?`)
    .get(id) as Parameters<typeof rowToDeployment>[0] | undefined;
  return row && rowToDeployment(row);
}

export function updateDeployment(
  db: Database,
  id: string,
  patch: Partial<Pick<Deployment, "status" | "imageRef" | "containerId" | "url">>,
): Deployment | undefined {
  const current = getDeployment(db, id);
  if (!current) return undefined;
  db.prepare(
    `UPDATE deployments
     SET status = ?, image_ref = ?, container_id = ?, url = ?,
         updated_at = strftime('%Y-%m-%dT%H:%M:%fZ','now')
     WHERE id = ?`,
  ).run(
    patch.status ?? current.status,
    patch.imageRef !== undefined ? patch.imageRef : current.imageRef,
    patch.containerId !== undefined ? patch.containerId : current.containerId,
    patch.url !== undefined ? patch.url : current.url,
    id,
  );
  return getDeployment(db, id);
}

export function latestDeploymentForApp(db: Database, appId: string): Deployment | undefined {
  const row = db
    .prepare(
      `SELECT ${DEPLOYMENT_COLUMNS} FROM deployments
       WHERE app_id = ? ORDER BY created_at DESC, rowid DESC LIMIT 1`,
    )
    .get(appId) as Parameters<typeof rowToDeployment>[0] | undefined;
  return row && rowToDeployment(row);
}

// --- sessions ---

export function createSession(
  db: Database,
  input: { tokenHash: string; userId: string; expiresAt: string },
): Session {
  db.prepare("INSERT INTO sessions (token_hash, user_id, expires_at) VALUES (?, ?, ?)").run(
    input.tokenHash,
    input.userId,
    input.expiresAt,
  );
  return getValidSession(db, input.tokenHash, new Date(0).toISOString())!;
}

/** Returns the session only if it has not expired as of `now` (ISO 8601 UTC). */
export function getValidSession(
  db: Database,
  tokenHash: string,
  now: string = new Date().toISOString(),
): Session | undefined {
  const row = db
    .prepare(
      "SELECT token_hash, user_id, created_at, expires_at FROM sessions WHERE token_hash = ? AND expires_at > ?",
    )
    .get(tokenHash, now) as
    | { token_hash: string; user_id: string; created_at: string; expires_at: string }
    | undefined;
  return (
    row && {
      tokenHash: row.token_hash,
      userId: row.user_id,
      createdAt: row.created_at,
      expiresAt: row.expires_at,
    }
  );
}

export function deleteSession(db: Database, tokenHash: string): void {
  db.prepare("DELETE FROM sessions WHERE token_hash = ?").run(tokenHash);
}

export function deleteExpiredSessions(db: Database, now: string = new Date().toISOString()): number {
  const result = db.prepare("DELETE FROM sessions WHERE expires_at <= ?").run(now);
  return Number(result.changes);
}
