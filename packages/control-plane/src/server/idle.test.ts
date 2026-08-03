import { beforeEach, describe, expect, it } from "vitest";
import { openDatabase, type Database } from "../db/database.js";
import { migrate } from "../db/migrations.js";
import { lastActivity, selectIdleApps, touchAppActivity } from "./idle.js";

describe("touchAppActivity", () => {
  let db: Database;
  beforeEach(() => {
    db = openDatabase(":memory:");
    migrate(db);
  });

  it("upserts the last-request timestamp", () => {
    touchAppActivity(db, "todo", "2026-08-01T10:00:00Z");
    touchAppActivity(db, "todo", "2026-08-01T11:00:00Z");
    expect(lastActivity(db, "todo")).toBe("2026-08-01T11:00:00Z");
    expect(lastActivity(db, "other")).toBeUndefined();
  });
});

describe("selectIdleApps", () => {
  const now = Date.parse("2026-08-01T12:00:00Z");
  const idleMs = 15 * 60_000;

  it("reaps apps with no recent request and an old start", () => {
    const idle = selectIdleApps(
      [
        { appName: "stale", startedAt: "2026-08-01T10:00:00Z" },
        { appName: "busy", startedAt: "2026-08-01T10:00:00Z" },
        { appName: "fresh-start", startedAt: "2026-08-01T11:55:00Z" },
      ],
      new Map([
        ["stale", "2026-08-01T11:00:00Z"],
        ["busy", "2026-08-01T11:58:00Z"],
      ]),
      now,
      idleMs,
    );
    expect(idle).toEqual(["stale"]);
  });

  it("uses container start as the baseline when no request was ever seen", () => {
    const idle = selectIdleApps(
      [{ appName: "never-hit", startedAt: "2026-08-01T11:00:00Z" }],
      new Map(),
      now,
      idleMs,
    );
    expect(idle).toEqual(["never-hit"]);
  });
});
