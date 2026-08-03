import { mkdirSync } from "node:fs";
import { join } from "node:path";
import { DatabaseSync } from "node:sqlite";

/**
 * Smallcloud app kit: the persistence primitive for deployed apps.
 *
 * Every Smallcloud app owns a private volume mounted at $DATA_DIR (/data).
 * `openKV()` gives a durable key-value store backed by a SQLite file on that
 * volume — no network service, no credentials, isolated per app by
 * construction. Namespaces separate concerns inside one app.
 */

export interface KV {
  get(key: string): string | undefined;
  getJSON<T>(key: string): T | undefined;
  put(key: string, value: string): void;
  putJSON(key: string, value: unknown): void;
  delete(key: string): boolean;
  /** Keys in this namespace, optionally filtered by prefix, sorted. */
  list(prefix?: string): string[];
  close(): void;
}

export interface KVOptions {
  /** Defaults to $DATA_DIR, then ./data — the app's private volume. */
  dataDir?: string;
  /** Separate keyspaces within one app. Default "default". */
  namespace?: string;
}

export function openKV(options: KVOptions = {}): KV {
  const dir = options.dataDir ?? process.env["DATA_DIR"] ?? "./data";
  const namespace = options.namespace ?? "default";
  mkdirSync(dir, { recursive: true });

  const db = new DatabaseSync(join(dir, "kv.sqlite"));
  db.exec("PRAGMA journal_mode = WAL;");
  db.exec(`
    CREATE TABLE IF NOT EXISTS kv (
      namespace TEXT NOT NULL,
      key TEXT NOT NULL,
      value TEXT NOT NULL,
      updated_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now')),
      PRIMARY KEY (namespace, key)
    );
  `);

  const getStmt = db.prepare("SELECT value FROM kv WHERE namespace = ? AND key = ?");
  const putStmt = db.prepare(
    `INSERT INTO kv (namespace, key, value) VALUES (?, ?, ?)
     ON CONFLICT (namespace, key)
     DO UPDATE SET value = excluded.value, updated_at = strftime('%Y-%m-%dT%H:%M:%fZ','now')`,
  );
  const deleteStmt = db.prepare("DELETE FROM kv WHERE namespace = ? AND key = ?");
  const listStmt = db.prepare(
    "SELECT key FROM kv WHERE namespace = ? AND key GLOB ? ORDER BY key",
  );

  return {
    get(key) {
      const row = getStmt.get(namespace, key) as { value: string } | undefined;
      return row?.value;
    },
    getJSON<T>(key: string): T | undefined {
      const raw = this.get(key);
      return raw === undefined ? undefined : (JSON.parse(raw) as T);
    },
    put(key, value) {
      putStmt.run(namespace, key, value);
    },
    putJSON(key, value) {
      this.put(key, JSON.stringify(value));
    },
    delete(key) {
      return Number(deleteStmt.run(namespace, key).changes) > 0;
    },
    list(prefix = "") {
      const rows = listStmt.all(namespace, `${prefix.replaceAll("*", "[*]")}*`) as Array<{
        key: string;
      }>;
      return rows.map((r) => r.key);
    },
    close() {
      try {
        db.close();
      } catch {
        // already closed — closing twice is fine
      }
    },
  };
}
