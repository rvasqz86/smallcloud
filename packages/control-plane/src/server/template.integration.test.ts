import { execFileSync } from "node:child_process";
import { mkdirSync, rmSync } from "node:fs";
import { join } from "node:path";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { openDatabase, type Database } from "../db/database.js";
import { migrate } from "../db/migrations.js";
import { containerIpOnNetwork } from "../ingress/discover.js";
import { DockerRuntime } from "../runtime/docker.js";
import { Deployer, appContainerName, appVolumeName, routeAnchorName } from "./deployer.js";

/**
 * M5-03 acceptance: the kv template (as scaffolded by `smallcloud new`)
 * deploys and its guestbook persists entries.
 */

const APP = "tpltest";
const NETWORK = "smallcloud-test-tpl";
const REPO = new URL("../../../..", import.meta.url).pathname;
const WORK = join(REPO, ".tpl-test");

const runtime = new DockerRuntime();
let db: Database;
let deployer: Deployer;

const docker = (...args: string[]) => execFileSync("docker", args, { encoding: "utf8" });
const cli = (...args: string[]) =>
  execFileSync("node", [join(REPO, "packages/cli/dist/index.js"), ...args], { encoding: "utf8" });

beforeAll(async () => {
  rmSync(WORK, { recursive: true, force: true });
  mkdirSync(WORK, { recursive: true });
  await runtime.stopContainer(appContainerName(APP));
  await runtime.stopContainer(routeAnchorName(APP));
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
  });

  cli("new", join(WORK, APP), "--template", "kv");
  await deployer.deploy({ sourceDir: join(WORK, APP), appName: APP, ownerEmail: "t@example.com" });
}, 300_000);

afterAll(async () => {
  await runtime.stopContainer(appContainerName(APP));
  await runtime.stopContainer(routeAnchorName(APP));
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

async function appGet(path: string): Promise<{ status: number; body: string }> {
  const ip = await containerIpOnNetwork(appContainerName(APP), NETWORK);
  let last: unknown;
  for (let i = 0; i < 30; i++) {
    try {
      const res = await fetch(`http://${ip}:8080${path}`, {
        redirect: "manual",
        signal: AbortSignal.timeout(2000),
      });
      return { status: res.status, body: await res.text() };
    } catch (err) {
      last = err;
    }
    await new Promise((r) => setTimeout(r, 500));
  }
  throw new Error(`app never answered: ${String(last)}`);
}

describe("kv template", () => {
  it("scaffolds, deploys, and persists guestbook entries", { timeout: 120_000 }, async () => {
    expect((await appGet("/")).body).toContain("Guestbook (0)");
    expect((await appGet("/sign?name=ada")).status).toBe(302);
    const after = await appGet("/");
    expect(after.body).toContain("Guestbook (1)");
    expect(after.body).toContain("ada");
  });
});
