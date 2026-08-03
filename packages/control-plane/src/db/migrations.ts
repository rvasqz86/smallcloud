import type { Database } from "./database.js";

export interface Migration {
  id: number;
  name: string;
  sql: string;
}

const NOW = "(strftime('%Y-%m-%dT%H:%M:%fZ','now'))";

export const MIGRATIONS: Migration[] = [
  {
    id: 1,
    name: "initial-schema",
    sql: `
      CREATE TABLE users (
        id TEXT PRIMARY KEY,
        email TEXT NOT NULL UNIQUE,
        created_at TEXT NOT NULL DEFAULT ${NOW}
      );

      CREATE TABLE apps (
        id TEXT PRIMARY KEY,
        name TEXT NOT NULL UNIQUE,
        owner_user_id TEXT NOT NULL REFERENCES users(id),
        created_at TEXT NOT NULL DEFAULT ${NOW},
        deleted_at TEXT
      );

      CREATE TABLE deployments (
        id TEXT PRIMARY KEY,
        app_id TEXT NOT NULL REFERENCES apps(id),
        status TEXT NOT NULL CHECK (status IN ('building','running','stopped','failed','deleted')),
        image_ref TEXT,
        container_id TEXT,
        url TEXT,
        created_at TEXT NOT NULL DEFAULT ${NOW},
        updated_at TEXT NOT NULL DEFAULT ${NOW}
      );
      CREATE INDEX idx_deployments_app ON deployments(app_id);

      CREATE TABLE sessions (
        token_hash TEXT PRIMARY KEY,
        user_id TEXT NOT NULL REFERENCES users(id),
        created_at TEXT NOT NULL DEFAULT ${NOW},
        expires_at TEXT NOT NULL
      );
      CREATE INDEX idx_sessions_user ON sessions(user_id);
    `,
  },
  {
    id: 2,
    name: "login-tokens",
    sql: `
      CREATE TABLE login_tokens (
        token_hash TEXT PRIMARY KEY,
        email TEXT NOT NULL,
        created_at TEXT NOT NULL DEFAULT ${NOW},
        expires_at TEXT NOT NULL,
        used_at TEXT
      );
      CREATE INDEX idx_login_tokens_email ON login_tokens(email);
    `,
  },
  {
    id: 3,
    name: "sharing",
    sql: `
      CREATE TABLE share_links (
        token_hash TEXT PRIMARY KEY,
        app_id TEXT NOT NULL REFERENCES apps(id),
        role TEXT NOT NULL CHECK (role IN ('editor','viewer')),
        created_at TEXT NOT NULL DEFAULT ${NOW},
        revoked_at TEXT
      );

      CREATE TABLE grants (
        id TEXT PRIMARY KEY,
        app_id TEXT NOT NULL REFERENCES apps(id),
        user_id TEXT NOT NULL REFERENCES users(id),
        role TEXT NOT NULL CHECK (role IN ('editor','viewer')),
        created_at TEXT NOT NULL DEFAULT ${NOW},
        revoked_at TEXT
      );
      CREATE UNIQUE INDEX idx_grants_active ON grants(app_id, user_id) WHERE revoked_at IS NULL;
    `,
  },
  {
    id: 4,
    name: "app-activity",
    sql: `
      CREATE TABLE app_activity (
        app_name TEXT PRIMARY KEY,
        last_request_at TEXT NOT NULL
      );
    `,
  },
  {
    id: 5,
    name: "audit-events",
    sql: `
      CREATE TABLE audit_events (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        at TEXT NOT NULL DEFAULT ${NOW},
        actor TEXT NOT NULL,
        action TEXT NOT NULL,
        subject TEXT NOT NULL,
        detail TEXT
      );
      CREATE INDEX idx_audit_at ON audit_events(at);
    `,
  },
  {
    id: 6,
    name: "egress",
    sql: `
      ALTER TABLE apps ADD COLUMN egress_token_hash TEXT;

      CREATE TABLE app_egress (
        app_id TEXT NOT NULL REFERENCES apps(id),
        hostname TEXT NOT NULL,
        PRIMARY KEY (app_id, hostname)
      );
    `,
  },
];

/** Applies pending migrations in id order. Returns how many were applied. */
export function migrate(db: Database, migrations: Migration[] = MIGRATIONS): number {
  db.exec(`
    CREATE TABLE IF NOT EXISTS schema_migrations (
      id INTEGER PRIMARY KEY,
      name TEXT NOT NULL,
      applied_at TEXT NOT NULL DEFAULT ${NOW}
    );
  `);
  const appliedRows = db.prepare("SELECT id FROM schema_migrations").all() as Array<{
    id: number;
  }>;
  const applied = new Set(appliedRows.map((r) => r.id));

  let count = 0;
  for (const m of [...migrations].sort((a, b) => a.id - b.id)) {
    if (applied.has(m.id)) continue;
    db.exec("BEGIN");
    try {
      db.exec(m.sql);
      db.prepare("INSERT INTO schema_migrations (id, name) VALUES (?, ?)").run(m.id, m.name);
      db.exec("COMMIT");
    } catch (err) {
      db.exec("ROLLBACK");
      throw err;
    }
    count++;
  }
  return count;
}
