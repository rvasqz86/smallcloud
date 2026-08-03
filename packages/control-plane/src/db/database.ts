import { DatabaseSync } from "node:sqlite";

// node:sqlite is experimental in Node 22; every consumer goes through this
// module so a swap to better-sqlite3 touches one file (see DECISIONS.md D-006).
export type Database = DatabaseSync;

export function openDatabase(path = ":memory:"): Database {
  const db = new DatabaseSync(path);
  db.exec("PRAGMA journal_mode = WAL;");
  db.exec("PRAGMA foreign_keys = ON;");
  return db;
}
