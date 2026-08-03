import { execFileSync } from "node:child_process";
import { mkdirSync, rmSync } from "node:fs";
import { join } from "node:path";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { openDatabase, type Database } from "../db/database.js";
import { migrate } from "../db/migrations.js";
import { createApp, createUser, type App } from "../db/repos.js";
import { ensureEgressRunning } from "./authproxy.js";
import { rotateEgressToken, setAppEgress } from "./egress.js";

/**
 * M5-02 acceptance: a container on the zero-egress internal network reaches
 * ONLY its allowlisted host, through the real sc-egress service.
 */

const NETWORK = "smallcloud-test-egress";
const EGRESS = "sc-test-egress";
const TARGET = "sc-egress-target";
const REPO = new URL("../../../..", import.meta.url).pathname;
const WORK = join(REPO, ".egress-test");

let db: Database;
let app: App;
let token: string;
let targetIp: string;

const docker = (...args: string[]) => execFileSync("docker", args, { encoding: "utf8" });

beforeAll(async () => {
  rmSync(WORK, { recursive: true, force: true });
  mkdirSync(WORK, { recursive: true });
  for (const name of [EGRESS, TARGET]) {
    try {
      docker("rm", "-f", name);
    } catch {
      /* fresh */
    }
  }
  docker("network", "create", "--internal", NETWORK);

  // the "external API": a tiny http server on the default bridge (internet stand-in)
  docker(
    "run", "-d", "--name", TARGET, "--memory", "32m", "busybox:stable",
    "sh", "-c", "mkdir /www && echo target-ok > /www/index.html && httpd -f -p 8080 -h /www",
  );
  targetIp = docker("inspect", TARGET, "--format", "{{(index .NetworkSettings.Networks \"bridge\").IPAddress}}").trim();

  db = openDatabase(join(WORK, "smallcloud.sqlite"));
  migrate(db);
  const owner = createUser(db, "egress@example.com");
  app = createApp(db, { name: "egresstest", ownerUserId: owner.id });
  setAppEgress(db, app.id, [targetIp]);
  token = rotateEgressToken(db, app.id);

  await ensureEgressRunning({ name: EGRESS, repoDir: REPO, dataDir: WORK, appNetwork: NETWORK });
  await new Promise((r) => setTimeout(r, 1500));
}, 180_000);

afterAll(() => {
  for (const name of [EGRESS, TARGET]) {
    try {
      docker("rm", "-f", name);
    } catch {
      /* gone */
    }
  }
  try {
    docker("network", "rm", NETWORK);
  } catch {
    /* fine */
  }
  rmSync(WORK, { recursive: true, force: true });
}, 60_000);

/** Runs a throwaway "app" on the internal network that calls through the proxy. */
function appFetch(targetUrl: string): string {
  const script = `
const http = require("node:http");
const target = new URL(process.argv[1]);
const req = http.request({
  host: "${EGRESS}", port: 3128, path: target.href,
  headers: {
    host: target.host,
    "proxy-authorization": "Basic " + Buffer.from("sc-egresstest:${token}").toString("base64"),
  },
}, (res) => {
  let body = "";
  res.on("data", (c) => body += c);
  res.on("end", () => console.log(res.statusCode + " " + body.trim()));
});
req.on("error", (e) => { console.log("ERR " + e.message); });
req.end();
setTimeout(() => process.exit(0), 4000);`;
  return docker(
    "run", "--rm", "--network", NETWORK, "--memory", "64m", "node:22-slim",
    "node", "-e", script, targetUrl,
  ).trim();
}

describe("egress end to end", () => {
  it("app on the internal network reaches only its allowlisted host", { timeout: 120_000 }, () => {
    expect(appFetch(`http://${targetIp}:8080/`)).toBe("200 target-ok");
    expect(appFetch("http://not-allowed.example.com/")).toContain("403");
  });

  it("direct egress (bypassing the proxy) still fails on the internal network", { timeout: 60_000 }, () => {
    const direct = docker(
      "run", "--rm", "--network", NETWORK, "--memory", "64m", "node:22-slim",
      "node", "-e",
      `fetch("http://${targetIp}:8080/", { signal: AbortSignal.timeout(3000) })
        .then(() => console.log("REACHED"), (e) => console.log("BLOCKED"));
       setTimeout(() => process.exit(0), 4000);`,
    ).trim();
    expect(direct).toBe("BLOCKED");
  });
});
