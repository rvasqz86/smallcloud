#!/usr/bin/env node
/**
 * Builds the publishable `smallcloud` npm package: everything the platform
 * needs at runtime, bundled self-contained into this directory.
 *
 *   bin/smallcloud.js        the CLI (workspace deps inlined; zero npm deps)
 *   bin/smallcloud-mcp.js    the MCP server (SDK + zod inlined)
 *   scripts/*-entry.mjs      service-container entrypoints, self-contained —
 *                            the package root is bind-mounted at /ws exactly
 *                            like a repo checkout (same path contract)
 *   assets/app-kit.js        the KV library `smallcloud new` vendors
 *
 * Run: node packages/smallcloud/build.mjs   (repo must be pnpm-built first)
 */
import { chmodSync, copyFileSync, mkdirSync, rmSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { build } from "esbuild";

const PKG = dirname(fileURLToPath(import.meta.url));
const REPO = join(PKG, "../..");

for (const dir of ["bin", "scripts", "assets"]) {
  rmSync(join(PKG, dir), { recursive: true, force: true });
  mkdirSync(join(PKG, dir), { recursive: true });
}

// no banner: the entry sources already carry hashbangs, which esbuild hoists
const common = {
  bundle: true,
  platform: "node",
  format: "esm",
  target: "node22",
  minify: false,
};

await build({
  ...common,
  entryPoints: [join(REPO, "packages/cli/src/index.ts")],
  outfile: join(PKG, "bin/smallcloud.js"),
});

await build({
  ...common,
  entryPoints: [join(REPO, "packages/mcp-server/src/index.ts")],
  outfile: join(PKG, "bin/smallcloud-mcp.js"),
});

for (const entry of ["authproxy-entry", "waker-entry", "egress-entry"]) {
  await build({
    ...common,
    entryPoints: [join(REPO, "scripts", `${entry}.mjs`)],
    outfile: join(PKG, "scripts", `${entry}.mjs`),
  });
}

await build({
  ...common,
  entryPoints: [join(REPO, "packages/app-kit/src/index.ts")],
  outfile: join(PKG, "assets/app-kit.js"),
});

copyFileSync(join(REPO, "README.md"), join(PKG, "README.md"));
copyFileSync(join(REPO, "LICENSE"), join(PKG, "LICENSE"));
for (const bin of ["bin/smallcloud.js", "bin/smallcloud-mcp.js"]) {
  chmodSync(join(PKG, bin), 0o755);
}

console.log("smallcloud package built: bin/, scripts/, assets/");
