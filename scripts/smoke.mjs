#!/usr/bin/env node
/**
 * M0 end-to-end smoke test (run: `pnpm smoke`).
 *
 * Drives the REAL CLI against the REAL environment (~/.smallcloud +
 * sc-auth-proxy + coolify-proxy + Cloudflare): deploys a static and a Node
 * fixture, then proves over the public internet that each app is
 * auth-gated (401), signs in via the CLI-printed magic link, and serves its
 * content — all within the charter's 60s session-to-URL budget.
 *
 * Additive only: creates/removes sc-app-smoke-* containers and images.
 */
import { execFileSync, execFile } from "node:child_process";
import { mkdirSync, rmSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { promisify } from "node:util";

const exec = promisify(execFile);
const REPO = new URL("..", import.meta.url).pathname;
const FIXTURES = join(REPO, ".smoke-data");
const CLI = join(REPO, "packages/cli/dist/index.js");
const EMAIL = "smoke@smallcloud.internal";
const DEPLOY_BUDGET_S = 60;

const log = (m) => console.log(`[smoke] ${m}`);
const fail = (m) => {
  console.error(`[smoke] FAILED: ${m}`);
  process.exit(1);
};

const APPS = [
  {
    name: "smoke-static",
    marker: "smoke static ok",
    files: (dir) => writeFileSync(join(dir, "index.html"), `<h1>smoke static ok</h1>`),
  },
  {
    name: "smoke-node",
    marker: "smoke node ok",
    files: (dir) => {
      writeFileSync(join(dir, "package.json"), JSON.stringify({ name: "smoke", main: "server.js" }));
      writeFileSync(
        join(dir, "server.js"),
        `const http = require("node:http");
http.createServer((req, res) => res.end("smoke node ok")).listen(process.env.PORT || 8080);`,
      );
    },
  },
];

async function poll(fn, attempts = 30, delayMs = 3000) {
  let last;
  for (let i = 0; i < attempts; i++) {
    try {
      const result = await fn();
      if (result) return result;
    } catch (err) {
      last = err;
    }
    await new Promise((r) => setTimeout(r, delayMs));
  }
  throw new Error(`poll exhausted${last ? `: ${last.message}` : ""}`);
}

async function smokeApp({ name, marker, files }) {
  const dir = join(FIXTURES, name);
  mkdirSync(dir, { recursive: true });
  files(dir);

  log(`deploying ${name} via CLI…`);
  const started = Date.now();
  const { stdout } = await exec(
    "node",
    [CLI, "deploy", dir, "--name", name, "--email", EMAIL],
    { timeout: DEPLOY_BUDGET_S * 1000 },
  );
  const deploySeconds = (Date.now() - started) / 1000;

  const url = stdout.match(/URL\s+(\S+)/)?.[1];
  const signIn = stdout.match(/Sign in\s+(\S+)/)?.[1];
  if (!url || !signIn) fail(`CLI output missing URL or sign-in link:\n${stdout}`);
  log(`  deployed in ${deploySeconds.toFixed(1)}s → ${url}`);
  if (deploySeconds > DEPLOY_BUDGET_S) fail(`deploy took ${deploySeconds}s (> ${DEPLOY_BUDGET_S}s)`);

  log("  waiting for the public auth wall…");
  await poll(async () => (await fetch(url, { redirect: "manual" })).status === 401);
  log("  ✓ unauthenticated request → 401");

  const redeem = await fetch(signIn, { redirect: "manual" });
  if (redeem.status !== 302) fail(`magic link redeem: HTTP ${redeem.status}`);
  const cookie = redeem.headers.get("set-cookie")?.split(";")[0];
  if (!cookie?.startsWith("sc_session=")) fail("no session cookie set");
  log("  ✓ magic link → session cookie");

  const body = await poll(async () => {
    const res = await fetch(url, { headers: { cookie } });
    const text = await res.text();
    return res.status === 200 && text.includes(marker) ? text : undefined;
  }, 10, 1000);
  if (!body) fail("authenticated fetch did not return app content");
  log(`  ✓ authenticated request → 200 with app content`);

  const replay = await fetch(signIn, { redirect: "manual" });
  if (replay.status !== 400) fail(`replayed magic link should 400, got ${replay.status}`);
  log("  ✓ magic link is single-use");

  // scale-to-zero: stop the app container, the next request must wake it < 2s
  execFileSync("docker", ["stop", `sc-app-${name}`], { stdio: "ignore" });
  await new Promise((r) => setTimeout(r, 1500));
  const coldStart = Date.now();
  const woken = await fetch(url, { headers: { cookie } });
  const wakeMs = Date.now() - coldStart;
  const wokenBody = await woken.text();
  if (woken.status !== 200 || !wokenBody.includes(marker)) {
    fail(`wake-on-request failed: HTTP ${woken.status}`);
  }
  if (wakeMs > 2000) fail(`cold start took ${wakeMs}ms (> 2000ms budget)`);
  log(`  ✓ scale-to-zero wake in ${wakeMs}ms (budget 2000ms)`);

  return deploySeconds;
}

function teardown() {
  for (const { name } of APPS) {
    // delete through the product so the control-plane record stays consistent
    try {
      execFileSync("node", [CLI, "delete", name], { stdio: "ignore" });
    } catch { /* fall through to raw cleanup */ }
    for (const container of [`sc-app-${name}`, `sc-route-${name}`]) {
      try {
        execFileSync("docker", ["rm", "-f", container], { stdio: "ignore" });
      } catch { /* not running */ }
    }
    try {
      const images = execFileSync("docker", ["images", "-q", `smallcloud/${name}`], {
        encoding: "utf8",
      })
        .split("\n")
        .filter(Boolean);
      for (const id of images) execFileSync("docker", ["rmi", "-f", id], { stdio: "ignore" });
    } catch { /* none */ }
  }
  rmSync(FIXTURES, { recursive: true, force: true });
}

async function main() {
  rmSync(FIXTURES, { recursive: true, force: true });
  const times = [];
  try {
    for (const app of APPS) times.push(await smokeApp(app));
  } finally {
    teardown();
  }
  log(`SMOKE PASSED — deploys: ${times.map((t) => `${t.toFixed(1)}s`).join(", ")} (budget ${DEPLOY_BUDGET_S}s)`);
}

main().catch((err) => fail(err.message));
