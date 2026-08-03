import { execFileSync } from "node:child_process";
import { mkdirSync, rmSync, writeFileSync } from "node:fs";
import http from "node:http";
import type { AddressInfo } from "node:net";
import { join } from "node:path";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { issueLoginToken } from "../auth/magiclink.js";
import { openDatabase, type Database } from "../db/database.js";
import { migrate } from "../db/migrations.js";
import { containerIpOnNetwork } from "../ingress/discover.js";
import { DockerRuntime } from "../runtime/docker.js";
import { ensureAuthProxyRunning } from "./authproxy.js";
import { Deployer, appContainerName } from "./deployer.js";
import { createControlPlaneServer } from "./http.js";

const APP = "deploytest";
const NETWORK = "smallcloud-test-deploy";
const PROXY = "sc-test-auth-proxy";
const REPO = new URL("../../../..", import.meta.url).pathname;
const DATA_DIR = join(REPO, ".test-data");
const BASE_DOMAIN = "osita.ai";

const runtime = new DockerRuntime();
let db: Database;
let api: http.Server;
let apiPort: number;
let fixtureDir: string;

const docker = (...args: string[]) => execFileSync("docker", args, { encoding: "utf8" });

beforeAll(async () => {
  rmSync(DATA_DIR, { recursive: true, force: true });
  mkdirSync(DATA_DIR, { recursive: true });
  await runtime.stopContainer(appContainerName(APP));
  await runtime.stopContainer(PROXY);
  await runtime.ensureAppNetwork(NETWORK);

  db = openDatabase(join(DATA_DIR, "smallcloud.sqlite"));
  migrate(db);

  fixtureDir = join(DATA_DIR, "fixture-app");
  mkdirSync(fixtureDir);
  writeFileSync(join(fixtureDir, "index.html"), "<h1>deploy api fixture</h1>");

  await ensureAuthProxyRunning({
    name: PROXY,
    repoDir: REPO,
    dataDir: DATA_DIR,
    baseDomain: BASE_DOMAIN,
    networks: [NETWORK],
  });

  const deployer = new Deployer({
    db,
    runtime,
    baseDomain: BASE_DOMAIN,
    network: NETWORK,
    authProxyOrigin: `http://${PROXY}:7777`,
  });
  api = createControlPlaneServer(deployer);
  await new Promise<void>((r) => api.listen(0, "127.0.0.1", r));
  apiPort = (api.address() as AddressInfo).port;
}, 180_000);

afterAll(async () => {
  await new Promise((r) => api.close(r));
  await runtime.stopContainer(appContainerName(APP));
  await runtime.stopContainer(`sc-route-${APP}`);
  await runtime.stopContainer(PROXY);
  docker("images", "-q", `smallcloud/${APP}`)
    .split("\n")
    .filter(Boolean)
    .forEach((id) => docker("rmi", "-f", id));
  try {
    docker("network", "rm", NETWORK);
  } catch {
    /* shared or already gone */
  }
  rmSync(DATA_DIR, { recursive: true, force: true });
}, 120_000);

async function apiCall(path: string, init?: RequestInit): Promise<{ status: number; body: any }> {
  const res = await fetch(`http://127.0.0.1:${apiPort}${path}`, init);
  return { status: res.status, body: await res.json() };
}

describe("deploy API", () => {
  it("deploys via POST and serves the app auth-gated", { timeout: 180_000 }, async () => {
    const deploy = await apiCall("/deploy", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        sourceDir: fixtureDir,
        appName: APP,
        ownerEmail: "owner@example.com",
      }),
    });
    expect(deploy.status).toBe(200);
    expect(deploy.body.url).toBe(`https://sc-${APP}.${BASE_DOMAIN}`);

    // the route anchor carries the ingress labels (they must survive the app
    // container stopping — scale-to-zero); the app container carries none
    const anchorLabels = JSON.parse(
      docker("inspect", `sc-route-${APP}`, "--format", "{{json .Config.Labels}}"),
    );
    expect(anchorLabels["caddy_0"]).toBe(`https://sc-${APP}.${BASE_DOMAIN}`);
    expect(anchorLabels["caddy_0.reverse_proxy"]).toBe(`http://${PROXY}:7777`);
    const appLabels = JSON.parse(
      docker("inspect", appContainerName(APP), "--format", "{{json .Config.Labels}}"),
    );
    expect(appLabels["caddy_0"]).toBeUndefined();

    // status + list reflect the running deployment
    const status = await apiCall(`/apps/${APP}`);
    expect(status.body.deployment.status).toBe("running");
    const list = await apiCall("/apps");
    expect(list.body.map((s: any) => s.app.name)).toContain(APP);

    // the app answers ONLY behind auth, through the proxy container
    const proxyIp = await containerIpOnNetwork(PROXY, NETWORK);
    const wall = await proxyRequest(proxyIp, "/");
    expect(wall.status).toBe(401);

    const { rawToken } = issueLoginToken(db, "owner@example.com");
    const redeem = await proxyRequest(proxyIp, `/_sc/auth?token=${rawToken}`);
    expect(redeem.status).toBe(302);
    const cookie = redeem.setCookie!.split(";")[0]!;

    let app = { status: 0, body: "" , setCookie: undefined as string | undefined };
    for (let i = 0; i < 20 && app.status !== 200; i++) {
      app = await proxyRequest(proxyIp, "/", { cookie });
      if (app.status !== 200) await new Promise((r) => setTimeout(r, 500));
    }
    expect(app.status).toBe(200);
    expect(app.body).toContain("deploy api fixture");
  });

  it("serves logs and deletes the app, removing route and container", async () => {
    const logs = await apiCall(`/apps/${APP}/logs?tail=50`);
    expect(logs.status).toBe(200);
    expect(typeof logs.body.logs).toBe("string");

    const del = await apiCall(`/apps/${APP}`, { method: "DELETE" });
    expect(del.status).toBe(200);

    // container (and with it the caddy route label) is gone
    expect(() => docker("inspect", appContainerName(APP))).toThrow();
    // the app is gone from the control plane
    expect((await apiCall(`/apps/${APP}`)).status).toBe(404);
    expect((await apiCall("/apps")).body.map((s: any) => s.app.name)).not.toContain(APP);
    // logs for a deleted app 404
    expect((await apiCall(`/apps/${APP}/logs`)).status).toBe(404);
  });

  it("rejects an undeployable directory with 400", async () => {
    const emptyDir = join(DATA_DIR, "empty");
    mkdirSync(emptyDir, { recursive: true });
    const res = await apiCall("/deploy", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ sourceDir: emptyDir, appName: "nope", ownerEmail: "o@e.com" }),
    });
    expect(res.status).toBe(400);
    expect(res.body.error).toMatch(/Unsupported app/);
  });

  it("404s unknown apps", async () => {
    const res = await apiCall("/apps/ghost");
    expect(res.status).toBe(404);
  });
});

function proxyRequest(
  ip: string,
  path: string,
  headers: Record<string, string> = {},
): Promise<{ status: number; body: string; setCookie: string | undefined }> {
  return new Promise((resolve, reject) => {
    const req = http.request(
      {
        host: ip,
        port: 7777,
        path,
        headers: { host: `sc-${APP}.${BASE_DOMAIN}`, ...headers },
      },
      (res) => {
        let body = "";
        res.on("data", (c: Buffer) => (body += c.toString()));
        res.on("end", () =>
          resolve({
            status: res.statusCode ?? 0,
            body,
            setCookie: res.headers["set-cookie"]?.[0],
          }),
        );
      },
    );
    req.on("error", reject);
    req.end();
  });
}
