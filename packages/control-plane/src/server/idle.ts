import type { Database } from "../db/database.js";

export const DEFAULT_IDLE_MINUTES = 15;

export function touchAppActivity(
  db: Database,
  appName: string,
  nowIso: string = new Date().toISOString(),
): void {
  db.prepare(
    `INSERT INTO app_activity (app_name, last_request_at) VALUES (?, ?)
     ON CONFLICT (app_name) DO UPDATE SET last_request_at = excluded.last_request_at`,
  ).run(appName, nowIso);
}

export function lastActivity(db: Database, appName: string): string | undefined {
  const row = db
    .prepare("SELECT last_request_at FROM app_activity WHERE app_name = ?")
    .get(appName) as { last_request_at: string } | undefined;
  return row?.last_request_at;
}

export interface RunningApp {
  appName: string;
  /** ISO timestamp the container started — the idle baseline when no request was ever seen. */
  startedAt: string;
}

/**
 * The reaper rule: an app is idle when neither its last request nor its
 * container start is within the idle window. Pure — the waker daemon and
 * tests share it.
 */
export function selectIdleApps(
  running: RunningApp[],
  activity: Map<string, string>,
  nowMs: number,
  idleMs: number = DEFAULT_IDLE_MINUTES * 60_000,
): string[] {
  return running
    .filter((app) => {
      const lastSeen = activity.get(app.appName);
      const baseline = Math.max(
        Date.parse(app.startedAt) || 0,
        lastSeen ? Date.parse(lastSeen) || 0 : 0,
      );
      return nowMs - baseline > idleMs;
    })
    .map((app) => app.appName);
}
