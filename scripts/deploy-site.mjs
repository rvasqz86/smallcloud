#!/usr/bin/env node
/**
 * Build and (re)deploy the public site container `sc-www` at
 * https://onsmallcloud.com. PUBLIC on purpose (DECISIONS.md D-012):
 * static marketing/docs only, no user data, same hardened container regime;
 * caddy routes to it directly — the auth proxy is not involved.
 */
import { execFileSync } from "node:child_process";
import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { DockerRuntime, detectStack } from "../packages/control-plane/dist/index.js";
import { buildSite } from "./build-site.mjs";

const HOST = "onsmallcloud.com";
const CONTAINER = "sc-www";
const IMAGE = "smallcloud/www:latest";
const BASE_IMAGE = "smallcloud/www:base";
const LOG_VOLUME = "sc-www-logs";
const DIST = new URL("../site/dist", import.meta.url).pathname;

// The standard static Caddyfile plus first-party analytics: JSON access logs
// on a persistent volume, aggregated by scripts/site-stats.mjs. Site-only —
// user apps keep the log-free template.
const CADDYFILE = `:8080 {
	root * /srv
	file_server
	handle_errors {
		@notfound expression {err.status_code} == 404
		rewrite @notfound /404.html
		file_server
	}
	log {
		output file /data/access.log {
			roll_size 20MiB
			roll_keep 7
		}
		format json
	}
}
`;

const log = (m) => console.log(`[deploy-site] ${m}`);
const runtime = new DockerRuntime();

const slugs = await buildSite();
log(`site built (${slugs.length} pages)`);

await runtime.buildImage({ sourceDir: DIST, detection: detectStack(DIST), imageTag: BASE_IMAGE });
const overlay = mkdtempSync(join(tmpdir(), "sc-www-"));
try {
  writeFileSync(join(overlay, "Caddyfile"), CADDYFILE);
  writeFileSync(join(overlay, "Dockerfile"), `FROM ${BASE_IMAGE}\nCOPY Caddyfile /etc/caddy/Caddyfile\n`);
  execFileSync("docker", ["build", "-t", IMAGE, overlay], { stdio: "pipe" });
} finally {
  rmSync(overlay, { recursive: true, force: true });
}
log("image built");

await runtime.stopContainer(CONTAINER);
await runtime.runContainer({
  imageTag: IMAGE,
  name: CONTAINER,
  network: "coolify", // reverse-proxy-reachable: this one is public by design
  restart: "unless-stopped",
  volume: { name: LOG_VOLUME, mountPath: "/data" },
  labels: {
    caddy_0: `https://${HOST}`,
    "caddy_0.reverse_proxy": "{{upstreams 8080}}",
    "caddy_0.encode": "zstd gzip",
    "caddy_0.header": "-Server",
    // legacy + www hostnames 301 to the canonical apex
    caddy_1: "https://www.onsmallcloud.com, https://smallcloud.osita.ai",
    "caddy_1.redir": `https://${HOST}{uri} permanent`,
    caddy_ingress_network: "coolify",
    "smallcloud.site": "www",
  },
});
log(`deployed → https://${HOST}`);

// wait for the public URL
for (let i = 0; i < 30; i++) {
  try {
    const res = await fetch(`https://${HOST}`, { signal: AbortSignal.timeout(8000) });
    if (res.status === 200) {
      log(`✓ live: HTTP 200`);
      process.exit(0);
    }
    log(`  attempt ${i + 1}: HTTP ${res.status}`);
  } catch (err) {
    log(`  attempt ${i + 1}: ${err.cause?.code ?? err.message}`);
  }
  await new Promise((r) => setTimeout(r, 3000));
}
console.error("[deploy-site] site never came up");
execFileSync("docker", ["logs", CONTAINER], { stdio: "inherit" });
process.exit(1);
