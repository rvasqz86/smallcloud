import { execFileSync } from "node:child_process";
import { existsSync, mkdirSync, rmSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { openDatabase, type Database } from "../db/database.js";
import { migrate } from "../db/migrations.js";
import { createUser } from "../db/repos.js";
import { DockerRuntime } from "../runtime/docker.js";
import { restoreVolumesFromBackup, runBackup } from "./backup.js";

const VOLUME = "sc-data-backuptest";
const REPO = new URL("../../../..", import.meta.url).pathname;
const WORK = join(REPO, ".backup-test");
const BACKUPS = join(WORK, "backups");

const runtime = new DockerRuntime();
let db: Database;

const docker = (...args: string[]) => execFileSync("docker", args, { encoding: "utf8" });

function volumeFileContent(): string {
  return docker(
    "run",
    "--rm",
    "-v",
    `${VOLUME}:/vol:ro`,
    "alpine",
    "sh",
    "-c",
    "cat /vol/precious.txt 2>/dev/null || echo MISSING",
  ).trim();
}

beforeAll(async () => {
  rmSync(WORK, { recursive: true, force: true });
  mkdirSync(BACKUPS, { recursive: true });
  await runtime.removeVolume(VOLUME);
  docker("run", "--rm", "-v", `${VOLUME}:/vol`, "alpine", "sh", "-c", "echo save-me > /vol/precious.txt");

  db = openDatabase(join(WORK, "live.sqlite"));
  migrate(db);
  createUser(db, "backup@example.com");
}, 120_000);

afterAll(async () => {
  await runtime.removeVolume(VOLUME);
  rmSync(WORK, { recursive: true, force: true });
}, 60_000);

describe("backup and restore", () => {
  it("round-trips the database and app volumes", { timeout: 180_000 }, async () => {
    // stale backup dir to prove retention pruning
    mkdirSync(join(BACKUPS, "2020-01-01"), { recursive: true });
    writeFileSync(join(BACKUPS, "2020-01-01", "old.txt"), "old");

    const result = await runBackup(db, runtime, BACKUPS);
    expect(result.volumes).toContain(VOLUME);
    expect(result.pruned).toContain("2020-01-01");
    expect(existsSync(join(result.dir, "smallcloud.sqlite"))).toBe(true);
    expect(existsSync(join(result.dir, `${VOLUME}.tar.gz`))).toBe(true);
    expect(existsSync(join(BACKUPS, "2020-01-01"))).toBe(false);

    // the snapshot is a valid, complete database
    const snapshot = openDatabase(join(result.dir, "smallcloud.sqlite"));
    const row = snapshot
      .prepare("SELECT email FROM users WHERE email = 'backup@example.com'")
      .get();
    expect(row).toBeDefined();

    // destroy the volume's data, then restore it from the tarball
    docker("run", "--rm", "-v", `${VOLUME}:/vol`, "alpine", "sh", "-c", "rm -f /vol/precious.txt");
    expect(volumeFileContent()).toBe("MISSING");

    const date = result.dir.slice(result.dir.lastIndexOf("/") + 1);
    const restored = await restoreVolumesFromBackup(runtime, BACKUPS, date);
    expect(restored.volumes).toContain(VOLUME);
    expect(restored.dbFile).toBeDefined();
    expect(volumeFileContent()).toBe("save-me");
  });

  it("throws for a missing backup date", async () => {
    await expect(restoreVolumesFromBackup(runtime, BACKUPS, "1999-01-01")).rejects.toThrow(
      /No backup/,
    );
  });
});
