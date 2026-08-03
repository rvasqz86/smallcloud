import { execFileSync } from "node:child_process";
import { mkdirSync, rmSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { openDatabase, type Database } from "../db/database.js";
import { migrate } from "../db/migrations.js";
import { containerIpOnNetwork } from "../ingress/discover.js";
import { DockerRuntime } from "../runtime/docker.js";
import { Deployer, appContainerName, appVolumeName } from "./deployer.js";

/**
 * M1-03 acceptance: an app's SQLite data survives redeploys, and a quota
 * breach stops the app with a clear error instead of eating the host disk.
 */

const APP = "persisttest";
const NETWORK = "smallcloud-test-persist";
const REPO = new URL("../../../..", import.meta.url).pathname;
const WORK = join(REPO, ".persist-test");

const runtime = new DockerRuntime();
let db: Database;
let deployer: Deployer;
let fixtureDir: string;

const docker = (...args: string[]) => execFileSync("docker", args, { encoding: "utf8" });

beforeAll(async () => {
  rmSync(WORK, { recursive: true, force: true });
  mkdirSync(WORK, { recursive: true });
  await runtime.stopContainer(appContainerName(APP));
  await runtime.removeVolume(appVolumeName(APP));
  await runtime.ensureAppNetwork(NETWORK);

  db = openDatabase(":memory:");
  migrate(db);
  deployer = new Deployer({
    db,
    runtime,
    baseDomain: "osita.ai",
    network: NETWORK,
    authProxyOrigin: "http://unused:7777",
    dataQuotaMb: 2,
  });

  fixtureDir = join(WORK, "counter-app");
  mkdirSync(fixtureDir);
  writeFileSync(join(fixtureDir, "package.json"), JSON.stringify({ name: "c", main: "server.js" }));
  writeFileSync(
    join(fixtureDir, "server.js"),
    `const { DatabaseSync } = require("node:sqlite");
const http = require("node:http");
const db = new DatabaseSync(process.env.DATA_DIR + "/app.sqlite");
db.exec("CREATE TABLE IF NOT EXISTS hits (n INTEGER)");
http.createServer((req, res) => {
  db.prepare("INSERT INTO hits (n) VALUES (1)").run();
  const { c } = db.prepare("SELECT COUNT(*) AS c FROM hits").get();
  res.end(String(c));
}).listen(process.env.PORT || 8080);`,
  );
}, 60_000);

afterAll(async () => {
  await runtime.stopContainer(appContainerName(APP));
  await runtime.stopContainer(`sc-route-${APP}`);
  await runtime.removeVolume(appVolumeName(APP));
  docker("images", "-q", `smallcloud/${APP}`)
    .split("\n")
    .filter(Boolean)
    .forEach((id) => docker("rmi", "-f", id));
  try {
    docker("network", "rm", NETWORK);
  } catch {
    /* fine */
  }
  rmSync(WORK, { recursive: true, force: true });
}, 120_000);

async function hitApp(): Promise<string> {
  const ip = await containerIpOnNetwork(appContainerName(APP), NETWORK);
  let last: unknown;
  for (let i = 0; i < 30; i++) {
    try {
      const res = await fetch(`http://${ip}:8080/`, { signal: AbortSignal.timeout(2000) });
      if (res.ok) return await res.text();
      last = new Error(`HTTP ${res.status}`);
    } catch (err) {
      last = err;
    }
    await new Promise((r) => setTimeout(r, 500));
  }
  throw new Error(`app never answered: ${String(last)}`);
}

describe("per-app persistence", () => {
  it("keeps SQLite data across redeploys", { timeout: 300_000 }, async () => {
    await deployer.deploy({ sourceDir: fixtureDir, appName: APP, ownerEmail: "p@example.com" });
    expect(await hitApp()).toBe("1");
    expect(await hitApp()).toBe("2");

    // redeploy: brand-new container + image, same volume
    await deployer.deploy({ sourceDir: fixtureDir, appName: APP, ownerEmail: "p@example.com" });
    expect(await hitApp()).toBe("3");
  });

  it("stops the app and reports clearly on quota breach", { timeout: 120_000 }, async () => {
    // blow past the 2 MiB quota from inside the container
    docker("exec", appContainerName(APP), "sh", "-c", "dd if=/dev/zero of=/data/bloat bs=1M count=4");

    const report = await deployer.checkQuota(APP);
    expect(report?.overQuota).toBe(true);
    expect(report?.stopped).toBe(true);
    expect(report!.usedBytes).toBeGreaterThan(report!.quotaBytes);
    expect(() => docker("inspect", appContainerName(APP))).toThrow();
    expect(deployer.status(APP)?.deployment?.status).toBe("stopped");

    // a fresh deploy over an over-quota volume is refused with a clear error
    await expect(
      deployer.deploy({ sourceDir: fixtureDir, appName: APP, ownerEmail: "p@example.com" }),
    ).rejects.toThrow(/over quota/);
  });

  it("delete removes the data volume", { timeout: 60_000 }, async () => {
    await deployer.delete(APP);
    const volumes = docker("volume", "ls", "-q").split("\n");
    expect(volumes).not.toContain(appVolumeName(APP));
  });
});
