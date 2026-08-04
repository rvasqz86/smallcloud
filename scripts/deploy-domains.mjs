#!/usr/bin/env node
/**
 * Deploys the sc-domains claim service at https://claim.<base>. Operator-only.
 * Run with credentials in the environment:  source ~/.secrets && node scripts/deploy-domains.mjs
 */
import { execFileSync } from "node:child_process";

const TOKEN = process.env.SMALLCLOUD_CF_TOKEN;
const BASE = process.env.SC_DOMAINS_BASE ?? "onsmallcloud.com";
const HOST = `claim.${BASE}`;
const CONTAINER = "sc-domains";
const REPO = new URL("..", import.meta.url).pathname;
const log = (m) => console.log(`[deploy-domains] ${m}`);
if (!TOKEN) {
  console.error("SMALLCLOUD_CF_TOKEN missing — source ~/.secrets first");
  process.exit(1);
}

const cf = async (path, init) => {
  const res = await fetch(`https://api.cloudflare.com/client/v4${path}`, {
    ...init,
    headers: { authorization: `Bearer ${TOKEN}`, "content-type": "application/json" },
  });
  const body = await res.json();
  if (!body.success) throw new Error(JSON.stringify(body.errors).slice(0, 300));
  return body.result;
};

// zone id + a proxied AAAA for the claim host itself (fronted like our site)
const zone = (await cf(`/zones?name=${BASE}`))[0];
if (!zone) throw new Error(`zone ${BASE} not found for this token`);
log(`zone ${BASE} (${zone.id.slice(0, 8)}…)`);

const hostIp = (await (await fetch("https://api64.ipify.org")).text()).trim();
const existing = await cf(`/zones/${zone.id}/dns_records?name=${HOST}`);
if (existing.length === 0) {
  await cf(`/zones/${zone.id}/dns_records`, {
    method: "POST",
    body: JSON.stringify({
      type: hostIp.includes(":") ? "AAAA" : "A",
      name: HOST,
      content: hostIp,
      proxied: true,
      comment: "smallcloud claim service",
    }),
  });
  log(`created ${HOST} → ${hostIp} (proxied)`);
} else {
  log(`${HOST} record already exists`);
}

const docker = (...args) => execFileSync("docker", args, { encoding: "utf8" });
try {
  docker("rm", "-f", CONTAINER);
} catch {
  /* fresh */
}
// the data volume starts root-owned; the service runs as uid 1000
docker("run", "--rm", "-v", "sc-domains-data:/data", "alpine", "chown", "1000:1000", "/data");
docker(
  "run", "-d", "--name", CONTAINER,
  "--network", "coolify",
  "--user", "1000:1000",
  "--read-only", "--tmpfs", "/tmp:rw,size=16m",
  "--cap-drop", "ALL", "--security-opt", "no-new-privileges",
  "--memory", "128m", "--cpus", "0.25",
  "--restart", "unless-stopped",
  "-v", `${REPO}:/ws:ro`,
  "-v", "sc-domains-data:/data",
  "-e", `SMALLCLOUD_CF_TOKEN=${TOKEN}`,
  "-e", `SMALLCLOUD_CF_ZONE=${zone.id}`,
  "-e", `SC_DOMAINS_BASE=${BASE}`,
  "--label", `caddy_0=https://${HOST}`,
  "--label", "caddy_0.reverse_proxy={{upstreams 8080}}",
  "--label", "caddy_0.header=-Server",
  "--label", "caddy_ingress_network=coolify",
  "node:22-slim", "node", "/ws/scripts/domains-entry.mjs",
);
log(`container up — waiting for https://${HOST}`);

for (let i = 0; i < 30; i++) {
  try {
    const res = await fetch(`https://${HOST}/`, { signal: AbortSignal.timeout(8000) });
    if (res.status === 200) {
      log(`✓ live: https://${HOST}`);
      process.exit(0);
    }
    log(`  attempt ${i + 1}: HTTP ${res.status}`);
  } catch (err) {
    log(`  attempt ${i + 1}: ${err.cause?.code ?? err.message}`);
  }
  await new Promise((r) => setTimeout(r, 3000));
}
console.error("claim service never came up");
execFileSync("docker", ["logs", CONTAINER], { stdio: "inherit" });
process.exit(1);
