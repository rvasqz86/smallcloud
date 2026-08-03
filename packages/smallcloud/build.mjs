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
import { chmodSync, copyFileSync, mkdirSync, rmSync, writeFileSync } from "node:fs";
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

/**
 * Bins are a launcher + implementation pair: the launcher silences Node's
 * SQLite ExperimentalWarning (which fires at module load, before any code in
 * the same file could) and then imports the real bundle.
 */
const LAUNCHER = (impl, invoke) => `#!/usr/bin/env node
const origEmit = process.emitWarning;
process.emitWarning = function (warning, ...args) {
  const text = String(typeof warning === "object" ? warning?.message : warning);
  const type = typeof args[0] === "string" ? args[0] : args[0]?.type;
  const name = typeof warning === "object" ? warning?.name : undefined;
  if ((type === "ExperimentalWarning" || name === "ExperimentalWarning") && text.includes("SQLite")) return;
  return origEmit.call(process, warning, ...args);
};
const mod = await import("./${impl}");
${invoke}
`;

async function buildBin(entry, name, invoke) {
  await build({
    ...common,
    entryPoints: [join(REPO, entry)],
    outfile: join(PKG, `bin/_${name}-impl.js`),
  });
  writeFileSync(join(PKG, `bin/${name}.js`), LAUNCHER(`_${name}-impl.js`, invoke));
}

await buildBin(
  "packages/cli/src/index.ts",
  "smallcloud",
  "process.exitCode = await mod.run(process.argv.slice(2));",
);
await buildBin("packages/mcp-server/src/index.ts", "smallcloud-mcp", "await mod.main();");

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
