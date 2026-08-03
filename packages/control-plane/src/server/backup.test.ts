import { describe, expect, it } from "vitest";
import { backupDirName, expiredBackupDirs } from "./backup.js";

describe("backupDirName", () => {
  it("is the UTC date", () => {
    expect(backupDirName(Date.parse("2026-08-02T23:59:00Z"))).toBe("2026-08-02");
  });
});

describe("expiredBackupDirs", () => {
  const now = Date.parse("2026-08-02T12:00:00Z");

  it("keeps the last 7 days, prunes older, ignores foreign names", () => {
    expect(
      expiredBackupDirs(["2026-08-02", "2026-07-27", "2026-07-25", "2020-01-01", "junk"], now),
    ).toEqual(["2026-07-25", "2020-01-01"]);
  });
});
