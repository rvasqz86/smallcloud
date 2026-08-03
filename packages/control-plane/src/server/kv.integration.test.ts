import { execFileSync } from "node:child_process";
import { copyFileSync, mkdirSync, rmSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { openDatabase, type Database } from "../db/database.js";
import { migrate } from "../db/migrations.js";
import { containerIpOnNetwork } from "../ingress/discover.js";
import { DockerRuntime } from "../runtime/docker.js";
import { Deployer, appContainerName, appVolumeName } from "./deployer.js";

/**
 * M1-04 acceptance: two deployed apps use @smallcloud/app-kit for KV; data
 * written in one is invisible to the other (isolation = separate volumes).
 */

const APPS = ["kvtest-a", "kvtest-b"] as const;
const NETWORK = "smallcloud-test-kv";
const REPO = new URL("../../../..", import.meta.url).pathname;
const WORK = join(REPO, ".kv-test");

const runtime = new DockerRuntime();
let deployer: Deployer;
let db: Database;

const docker = (...args: string[]) => execFileSync("docker", args, { encoding: "utf8" });

beforeAll(async () => {
  rmSync(WORK, { recursive: true, force: true });
  mkdirSync(WORK, { recursive: true });
  for (const app of APPS) {
    await runtime.stopContainer(appContainerName(app));
    await runtime.removeVolume(appVolumeName(app));
  }
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

  for (const app of APPS) {
    const dir = join(WORK, app);
    mkdirSync(dir);
    writeFileSync(join(dir, "package.json"), JSON.stringify({ name: app, type: "module", main: "server.js" }));
    // the REAL library, vendored the way an app would receive it
    copyFileSync(join(REPO, "packages/app-kit/dist/index.js"), join(dir, "kv.js"));
    writeFileSync(
      join(dir, "server.js"),
      `import http from "node:http";
import { openKV } from "./kv.js";
const kv = openKV();
http.createServer((req, res) => {
  const url = new URL(req.url, "http://x");
  const key = url.searchParams.get("k") ?? "";
  if (url.pathname === "/set") { kv.put(key, url.searchParams.get("v") ?? ""); res.end("ok"); return; }
  if (url.pathname === "/get") {
    const value = kv.get(key);
    res.statusCode = value === undefined ? 404 : 200;
    res.end(value ?? "not found"); return;
  }
  res.end("kv app");
}).listen(process.env.PORT || 8080);`,
    );
    await deployer.deploy({ sourceDir: dir, appName: app, ownerEmail: "kv@example.com" });
  }
}, 300_000);

afterAll(async () => {
  for (const app of APPS) {
    await runtime.stopContainer(appContainerName(app));
    await runtime.stopContainer(`sc-route-${app}`);
    await runtime.removeVolume(appVolumeName(app));
    docker("images", "-q", `smallcloud/${app}`)
      .split("\n")
      .filter(Boolean)
      .forEach((id) => docker("rmi", "-f", id));
  }
  try {
    docker("network", "rm", NETWORK);
  } catch {
    /* fine */
  }
  rmSync(WORK, { recursive: true, force: true });
}, 120_000);

async function call(app: string, path: string): Promise<{ status: number; body: string }> {
  const ip = await containerIpOnNetwork(appContainerName(app), NETWORK);
  let last: unknown;
  for (let i = 0; i < 30; i++) {
    try {
      const res = await fetch(`http://${ip}:8080${path}`, { signal: AbortSignal.timeout(2000) });
      return { status: res.status, body: await res.text() };
    } catch (err) {
      last = err;
    }
    await new Promise((r) => setTimeout(r, 500));
  }
  throw new Error(`${app} never answered: ${String(last)}`);
}

describe("KV primitive in deployed apps", () => {
  it("stores and reads within an app, invisible to the other app", { timeout: 120_000 }, async () => {
    expect((await call("kvtest-a", "/set?k=color&v=teal")).body).toBe("ok");
    expect((await call("kvtest-a", "/get?k=color")).body).toBe("teal");

    // the same key in app B: not found — separate volume, separate universe
    const other = await call("kvtest-b", "/get?k=color");
    expect(other.status).toBe(404);

    // B's own writes work and don't leak back
    await call("kvtest-b", "/set?k=color&v=crimson");
    expect((await call("kvtest-b", "/get?k=color")).body).toBe("crimson");
    expect((await call("kvtest-a", "/get?k=color")).body).toBe("teal");
  });
});
