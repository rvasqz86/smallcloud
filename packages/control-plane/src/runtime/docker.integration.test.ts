import { execFile } from "node:child_process";
import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { promisify } from "node:util";
import { afterAll, describe, expect, it } from "vitest";
import { detectStack } from "../detect/detect.js";
import { DockerRuntime } from "./docker.js";

const exec = promisify(execFile);
const runtime = new DockerRuntime();

const cleanups: Array<() => Promise<void> | void> = [];

afterAll(async () => {
  for (const cleanup of cleanups.reverse()) await cleanup();
}, 60_000);

async function buildAndServe(sourceDir: string, imageTag: string): Promise<string> {
  const built = await runtime.buildImage({
    sourceDir,
    detection: detectStack(sourceDir),
    imageTag,
  });
  cleanups.push(() => runtime.removeImage(imageTag));

  const { stdout: containerId } = await exec("docker", [
    "run",
    "-d",
    "--rm",
    "-p",
    `127.0.0.1:0:${built.containerPort}`,
    imageTag,
  ]);
  const id = containerId.trim();
  cleanups.push(() => exec("docker", ["rm", "-f", id]).then(() => undefined, () => undefined));

  const { stdout: portLine } = await exec("docker", ["port", id, String(built.containerPort)]);
  const hostPort = portLine.trim().split("\n")[0]!.split(":").pop()!;

  const url = `http://127.0.0.1:${hostPort}/`;
  let lastError: unknown;
  for (let attempt = 0; attempt < 30; attempt++) {
    try {
      const res = await fetch(url);
      if (res.ok) return await res.text();
      lastError = new Error(`HTTP ${res.status}`);
    } catch (err) {
      lastError = err;
    }
    await new Promise((r) => setTimeout(r, 500));
  }
  throw new Error(`App at ${url} never became healthy: ${String(lastError)}`);
}

describe("DockerRuntime.buildImage", () => {
  it("builds and serves a static site", { timeout: 120_000 }, async () => {
    const dir = mkdtempSync(join(tmpdir(), "sc-static-"));
    cleanups.push(() => rmSync(dir, { recursive: true, force: true }));
    writeFileSync(join(dir, "index.html"), "<h1>smallcloud static ok</h1>");

    const body = await buildAndServe(dir, "smallcloud-test/static-fixture:it");
    expect(body).toContain("smallcloud static ok");
  });

  it("builds and serves a node web app", { timeout: 180_000 }, async () => {
    const dir = mkdtempSync(join(tmpdir(), "sc-node-"));
    cleanups.push(() => rmSync(dir, { recursive: true, force: true }));
    writeFileSync(
      join(dir, "package.json"),
      JSON.stringify({ name: "fixture", main: "server.js" }),
    );
    writeFileSync(
      join(dir, "server.js"),
      `const http = require("node:http");
http.createServer((req, res) => res.end("smallcloud node ok")).listen(process.env.PORT || 8080);`,
    );

    const body = await buildAndServe(dir, "smallcloud-test/node-fixture:it");
    expect(body).toContain("smallcloud node ok");
  });
});
