import { existsSync, mkdirSync, readdirSync, rmSync } from "node:fs";
import { join } from "node:path";
import type { Database } from "../db/database.js";
import type { Runtime } from "../runtime/types.js";

export const BACKUP_KEEP_DAYS = 7;

/** Backup folder name for a given moment: YYYY-MM-DD (UTC). */
export function backupDirName(nowMs: number = Date.now()): string {
  return new Date(nowMs).toISOString().slice(0, 10);
}

/** Which of the existing date-named dirs fall outside the retention window. */
export function expiredBackupDirs(
  dirNames: string[],
  nowMs: number = Date.now(),
  keepDays: number = BACKUP_KEEP_DAYS,
): string[] {
  const cutoff = nowMs - keepDays * 24 * 60 * 60_000;
  return dirNames
    .filter((name) => /^\d{4}-\d{2}-\d{2}$/.test(name))
    .filter((name) => Date.parse(`${name}T00:00:00Z`) < cutoff);
}

export interface BackupResult {
  dir: string;
  volumes: string[];
  pruned: string[];
}

/**
 * One backup run: consistent SQLite snapshot (VACUUM INTO) + a tarball per
 * app data volume, in a date-named folder, then retention pruning.
 */
export async function runBackup(
  db: Database,
  runtime: Runtime,
  backupsRoot: string,
  nowMs: number = Date.now(),
): Promise<BackupResult> {
  const dir = join(backupsRoot, backupDirName(nowMs));
  mkdirSync(dir, { recursive: true });

  const dbTarget = join(dir, "smallcloud.sqlite");
  rmSync(dbTarget, { force: true }); // VACUUM INTO refuses to overwrite
  db.exec(`VACUUM INTO '${dbTarget.replaceAll("'", "''")}'`);

  const volumes = await runtime.listVolumes("sc-data-");
  for (const volume of volumes) {
    await runtime.backupVolume(volume, dir);
  }

  const pruned = expiredBackupDirs(
    existsSync(backupsRoot) ? readdirSync(backupsRoot) : [],
    nowMs,
  );
  for (const name of pruned) {
    rmSync(join(backupsRoot, name), { recursive: true, force: true });
  }

  return { dir, volumes, pruned };
}

export interface RestoreResult {
  dbFile: string | undefined;
  volumes: string[];
}

/**
 * Restores every volume tarball from a backup dir. The database file is NOT
 * copied over the live DB automatically — the caller decides (services must
 * be stopped first); its path is returned instead.
 */
export async function restoreVolumesFromBackup(
  runtime: Runtime,
  backupsRoot: string,
  date: string,
): Promise<RestoreResult> {
  const dir = join(backupsRoot, date);
  if (!existsSync(dir)) {
    throw new Error(`No backup for ${date} under ${backupsRoot}`);
  }
  const volumes: string[] = [];
  for (const file of readdirSync(dir)) {
    if (!file.endsWith(".tar.gz")) continue;
    const volume = file.slice(0, -".tar.gz".length);
    await runtime.restoreVolume(volume, join(dir, file));
    volumes.push(volume);
  }
  const dbFile = join(dir, "smallcloud.sqlite");
  return { dbFile: existsSync(dbFile) ? dbFile : undefined, volumes };
}
