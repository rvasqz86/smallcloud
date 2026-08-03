import { execFileSync } from "node:child_process";
import { existsSync, rmSync } from "node:fs";
import { join } from "node:path";
import { afterAll, beforeAll, describe, expect, it } from "vitest";

/**
 * M6-02 acceptance: the `smallcloud` npm package installs from its tarball
 * into a clean prefix (exactly what `npm i -g smallcloud` does) and the
 * installed binary scaffolds a working app — proving the package is
 * self-contained (bundled deps, package-layout root probing, vendored kv).
 */

const REPO = new URL("../../../..", import.meta.url).pathname;
const PKG = join(REPO, "packages/smallcloud");
const PREFIX = join(REPO, ".npm-test-prefix");
const APP_DIR = join(REPO, ".npm-test-scaffold");

const run = (cmd: string, args: string[], cwd = REPO) =>
  execFileSync(cmd, args, { cwd, encoding: "utf8" });

beforeAll(() => {
  rmSync(PREFIX, { recursive: true, force: true });
  rmSync(APP_DIR, { recursive: true, force: true });
  run("node", [join(PKG, "build.mjs")]);
  run("npm", ["pack", "--silent"], PKG);
  run("npm", ["install", "-g", "--prefix", PREFIX, join(PKG, "rvasqz86-smallcloud-0.1.1.tgz")]);
}, 300_000);

afterAll(() => {
  rmSync(PREFIX, { recursive: true, force: true });
  rmSync(APP_DIR, { recursive: true, force: true });
  rmSync(join(PKG, "rvasqz86-smallcloud-0.1.1.tgz"), { force: true });
}, 60_000);

describe("npm-installed smallcloud", () => {
  const bin = join(PREFIX, "bin/smallcloud");

  it("installs a working CLI via bin symlink", () => {
    const help = run(bin, ["help"]);
    expect(help).toContain("Usage: smallcloud");
    expect(help).toContain("deploy");
  });

  it("scaffolds the kv template from the packaged app-kit asset", () => {
    const out = run(bin, ["new", APP_DIR, "--template", "kv"]);
    expect(out).toContain("Created kv app");
    expect(existsSync(join(APP_DIR, "kv.js"))).toBe(true);
    expect(existsSync(join(APP_DIR, "server.js"))).toBe(true);
  });

  it("ships self-contained service entrypoints under the package root", () => {
    const root = join(PREFIX, "lib/node_modules/@rvasqz86/smallcloud");
    for (const entry of ["authproxy-entry.mjs", "waker-entry.mjs", "egress-entry.mjs"]) {
      expect(existsSync(join(root, "scripts", entry))).toBe(true);
    }
    // self-contained = no imports reaching outside the file
    const bundled = run("node", ["-e", `
      const s = require("node:fs").readFileSync("${join(PREFIX, "lib/node_modules/@rvasqz86/smallcloud/scripts/authproxy-entry.mjs")}", "utf8");
      console.log(/from "\\.\\.\\/packages/.test(s) ? "external-imports" : "self-contained");
    `]);
    expect(bundled.trim()).toBe("self-contained");
  });

  it("exposes the MCP server bin", () => {
    expect(existsSync(join(PREFIX, "bin/smallcloud-mcp"))).toBe(true);
  });
});
