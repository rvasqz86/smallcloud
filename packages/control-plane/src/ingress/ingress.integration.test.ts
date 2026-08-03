import http from "node:http";
import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import type { AddressInfo } from "node:net";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { SESSION_COOKIE, createAuthProxy } from "@smallcloud/auth-proxy";
import { sha256Hex } from "@smallcloud/shared";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { issueLoginToken, redeemLoginToken } from "../auth/magiclink.js";
import { openDatabase, type Database } from "../db/database.js";
import { migrate } from "../db/migrations.js";
import { getValidSession } from "../db/repos.js";
import { detectStack } from "../detect/detect.js";
import { DockerRuntime } from "../runtime/docker.js";
import { containerIpOnNetwork, gatewayIpForProxy } from "./discover.js";
import { ingressLabels } from "./labels.js";

/**
 * The full v0 data path minus the production proxy hop: a sandboxed app on the
 * internal network, fronted by the real auth proxy running on the host,
 * upstream resolved by container IP — exactly how deploys will wire it.
 */

const NETWORK = "smallcloud-test-ingress";
const CONTAINER = "sc-test-ingress-app";
const IMAGE = "smallcloud-test/ingress-fixture:it";
const APP = "ingresstest";

const runtime = new DockerRuntime();
let db: Database;
let proxy: http.Server;
let proxyPort: number;
let appIp: string;

beforeAll(async () => {
  db = openDatabase(":memory:");
  migrate(db);

  const dir = mkdtempSync(join(tmpdir(), "sc-ingress-"));
  writeFileSync(join(dir, "index.html"), "<h1>ingress fixture live</h1>");

  await runtime.stopContainer(CONTAINER); // clear any leftover from a crashed run
  await runtime.ensureAppNetwork(NETWORK);
  await runtime.buildImage({ sourceDir: dir, detection: detectStack(dir), imageTag: IMAGE });
  rmSync(dir, { recursive: true, force: true });

  const gateway = await gatewayIpForProxy();
  await runtime.runContainer({
    imageTag: IMAGE,
    name: CONTAINER,
    network: NETWORK,
    labels: ingressLabels(APP, {
      baseDomain: "osita.ai",
      authProxyOrigin: `http://${gateway}:7777`,
    }),
  });
  appIp = await containerIpOnNetwork(CONTAINER, NETWORK);

  proxy = createAuthProxy({
    baseDomain: "osita.ai",
    appPrefix: "sc-",
    validateSession: (tokenHash) => {
      const session = getValidSession(db, tokenHash);
      return session && { userId: session.userId };
    },
    resolveUpstream: (app) => (app === APP ? `http://${appIp}:8080` : undefined),
    authorize: () => true, // role logic is covered by sharing tests
    auth: {
      requestLoginLink: () => undefined,
      redeemLoginToken: (raw) => {
        const redeemed = redeemLoginToken(db, raw);
        return redeemed && { sessionToken: redeemed.sessionToken, expiresAt: redeemed.expiresAt };
      },
    },
  });
  await new Promise<void>((r) => proxy.listen(0, "0.0.0.0", r));
  proxyPort = (proxy.address() as AddressInfo).port;
}, 180_000);

afterAll(async () => {
  await new Promise((r) => proxy.close(r));
  await runtime.stopContainer(CONTAINER);
  await runtime.removeImage(IMAGE);
  const { execFile } = await import("node:child_process");
  const { promisify } = await import("node:util");
  await promisify(execFile)("docker", ["network", "rm", NETWORK]).catch(() => undefined);
}, 60_000);

function request(
  path: string,
  headers: http.OutgoingHttpHeaders = {},
): Promise<{ status: number; body: string }> {
  return new Promise((resolve, reject) => {
    const req = http.request(
      {
        host: "127.0.0.1",
        port: proxyPort,
        path,
        headers: { host: `sc-${APP}.osita.ai`, ...headers },
      },
      (res) => {
        let body = "";
        res.on("data", (c: Buffer) => (body += c.toString()));
        res.on("end", () => resolve({ status: res.statusCode ?? 0, body }));
      },
    );
    req.on("error", reject);
    req.end();
  });
}

describe("host auth-proxy → internal-network app", () => {
  it("serves the sandboxed app only behind auth", { timeout: 60_000 }, async () => {
    const wall = await request("/");
    expect(wall.status).toBe(401);

    const { rawToken } = issueLoginToken(db, "builder@example.com");
    const redeemed = redeemLoginToken(db, rawToken)!;
    expect(getValidSession(db, sha256Hex(redeemed.sessionToken))).toBeDefined();

    // retry: static container may still be starting
    let res = { status: 0, body: "" };
    for (let i = 0; i < 20; i++) {
      res = await request("/", { cookie: `${SESSION_COOKIE}=${redeemed.sessionToken}` });
      if (res.status === 200) break;
      await new Promise((r) => setTimeout(r, 500));
    }
    expect(res.status).toBe(200);
    expect(res.body).toContain("ingress fixture live");
  });
});
