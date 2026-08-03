import { execFileSync } from "node:child_process";
import { mkdirSync, rmSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { openDatabase, type Database } from "../db/database.js";
import { migrate } from "../db/migrations.js";
import { backupDirName } from "./backup.js";
import { runDoctor } from "./doctor.js";

const PROXY = "sc-doctor-test-proxy";
const WAKER = "sc-doctor-test-waker";
const REPO = new URL("../../../..", import.meta.url).pathname;
const WORK = join(REPO, ".doctor-test");

let db: Database;
const docker = (...args: string[]) => execFileSync("docker", args, { encoding: "utf8" });

function fakeService(name: string): void {
  docker("run", "-d", "--name", name, "--network", "none", "--memory", "16m", "busybox:stable", "sleep", "3600");
}

beforeAll(() => {
  rmSync(WORK, { recursive: true, force: true });
  mkdirSync(join(WORK, "backups", backupDirName()), { recursive: true });
  writeFileSync(join(WORK, "backups", backupDirName(), "smallcloud.sqlite"), "");
  for (const name of [PROXY, WAKER]) {
    try {
      docker("rm", "-f", name);
    } catch {
      /* fresh */
    }
  }
  fakeService(PROXY);
  db = openDatabase(":memory:");
  migrate(db);
}, 120_000);

afterAll(() => {
  for (const name of [PROXY, WAKER]) {
    try {
      docker("rm", "-f", name);
    } catch {
      /* gone */
    }
  }
  rmSync(WORK, { recursive: true, force: true });
}, 60_000);

function check(report: Awaited<ReturnType<typeof runDoctor>>, name: string) {
  return report.checks.find((c) => c.name === name);
}

describe("runDoctor", () => {
  it("heals a down service and reports healthy", { timeout: 120_000 }, async () => {
    let healCalls = 0;
    const report = await runDoctor({
      db,
      dataDir: WORK,
      authProxyName: PROXY,
      wakerName: WAKER, // not running yet — heal must bring it up
      heal: async () => {
        healCalls += 1;
        fakeService(WAKER);
      },
    });

    expect(healCalls).toBe(1);
    expect(check(report, "docker")?.status).toBe("ok");
    expect(check(report, `service:${PROXY}`)?.status).toMatch(/ok|healed/);
    expect(check(report, `service:${WAKER}`)?.status).toBe("healed");
    expect(check(report, "backups")?.status).toBe("ok");
    expect(report.healthy).toBe(true);
  });

  it("heals a STOPPED auth proxy", { timeout: 120_000 }, async () => {
    docker("stop", PROXY);
    const report = await runDoctor({
      db,
      dataDir: WORK,
      authProxyName: PROXY,
      wakerName: WAKER,
      heal: async () => docker("start", PROXY),
    });
    expect(check(report, `service:${PROXY}`)?.status).toBe("healed");
    expect(report.healthy).toBe(true);
  });

  it("fails without a heal path, warns on stale backups", { timeout: 60_000 }, async () => {
    docker("rm", "-f", WAKER);
    const staleDir = join(WORK, "stale");
    mkdirSync(join(staleDir, "backups", "2020-01-01"), { recursive: true });

    const report = await runDoctor({
      db,
      dataDir: staleDir,
      authProxyName: PROXY,
      wakerName: WAKER,
    });
    expect(check(report, `service:${WAKER}`)?.status).toBe("fail");
    expect(check(report, "backups")?.status).toBe("warn");
    expect(report.healthy).toBe(false);
  });
});
