import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { homedir } from "node:os";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { openDatabase } from "../db/database.js";
import { migrate } from "../db/migrations.js";
import { DockerRuntime } from "../runtime/docker.js";
import { ingressLabels } from "../ingress/labels.js";
import { ensureAuthProxyRunning, ensureEgressRunning, ensureWakerRunning } from "./authproxy.js";
import { Deployer } from "./deployer.js";

/** v0 composition constants shared by every local client (CLI, MCP server). */
export const DEFAULT_BASE_DOMAIN = "osita.ai";

/**
 * The base domain is per-installation — there is no sane default. Fail with
 * a recipe instead of silently minting hostnames on someone else's domain.
 */
export function requireBaseDomain(): string {
  const domain = loadConfig().baseDomain;
  if (domain) return domain;
  throw new Error(
    `No baseDomain configured. Smallcloud apps live at sc-<app>.<your-domain>.\n` +
      `Set it in ${join(smallcloudHome(), "config.json")}:\n` +
      `  { "baseDomain": "example.com" }\n` +
      `Options if you don't own a domain:\n` +
      `  - free: duckdns.org — claim yourname.duckdns.org, point it at this server,\n` +
      `    use "baseDomain": "yourname.duckdns.org" (HTTPS works automatically)\n` +
      `  - testing only: "baseDomain": "<server-ip-with-dashes>.sslip.io"\n` +
      `  - or buy any domain and add a wildcard record (*.example.com -> this server)`,
  );
}
export const APP_NETWORK = "smallcloud-apps";
export const AUTH_PROXY_CONTAINER = "sc-auth-proxy";
export const AUTH_PROXY_ORIGIN = `http://${AUTH_PROXY_CONTAINER}:7777`;
/** Networks the auth proxy joins: reverse-proxy-reachable first, then apps. */
export const AUTH_PROXY_NETWORKS = ["coolify", APP_NETWORK];
export const WAKER_CONTAINER = "sc-waker";
export const WAKER_SOCK_VOLUME = "sc-waker-sock";

export interface LocalConfig {
  email?: string;
  baseDomain?: string;
  /** Resend API key — when set (with mailFrom), magic links are emailed. */
  resendApiKey?: string;
  /** Verified sender, e.g. "Smallcloud <signin@yourdomain.com>". */
  mailFrom?: string;
}

export function smallcloudHome(): string {
  return process.env["SMALLCLOUD_HOME"] ?? join(homedir(), ".smallcloud");
}

export function dataDir(): string {
  const dir = join(smallcloudHome(), "data");
  mkdirSync(dir, { recursive: true });
  return dir;
}

function configPath(): string {
  return join(smallcloudHome(), "config.json");
}

export function loadConfig(): LocalConfig {
  if (!existsSync(configPath())) return {};
  try {
    return JSON.parse(readFileSync(configPath(), "utf8")) as LocalConfig;
  } catch {
    return {};
  }
}

export function saveConfig(config: LocalConfig): void {
  mkdirSync(smallcloudHome(), { recursive: true });
  writeFileSync(configPath(), `${JSON.stringify(config, null, 2)}\n`);
}

/**
 * Smallcloud's install root — the directory containing `scripts/*-entry.mjs`,
 * bind-mounted read-only at /ws inside the service containers. Found by
 * probing upward so the same code works from a repo checkout (root =
 * packages/control-plane/dist/server/../../../..) AND from an installed npm
 * package (root = wherever the bundle landed).
 */
export function repoDir(): string {
  let dir = dirname(fileURLToPath(import.meta.url));
  for (let i = 0; i < 8; i++) {
    if (existsSync(join(dir, "scripts", "authproxy-entry.mjs"))) return dir;
    const parent = resolve(dir, "..");
    if (parent === dir) break;
    dir = parent;
  }
  throw new Error(
    "Cannot locate the Smallcloud root (no scripts/authproxy-entry.mjs above this module)",
  );
}

/** The app-kit library file that `smallcloud new` vendors into kv templates. */
export function appKitFile(): string {
  const root = repoDir();
  for (const candidate of [
    join(root, "packages/app-kit/dist/index.js"), // repo checkout
    join(root, "assets/app-kit.js"), // installed npm package
  ]) {
    if (existsSync(candidate)) return candidate;
  }
  throw new Error("Cannot locate the app-kit library (run pnpm build?)");
}

export function createLocalDeployer(): Deployer {
  const db = openDatabase(join(dataDir(), "smallcloud.sqlite"));
  migrate(db);
  return new Deployer({
    db,
    runtime: new DockerRuntime(),
    baseDomain: requireBaseDomain(),
    network: APP_NETWORK,
    authProxyOrigin: AUTH_PROXY_ORIGIN,
  });
}

/** Brings up the substrate a deploy needs: app network, auth proxy, waker. */
export async function ensureEnvironment(): Promise<{ authProxyStarted: boolean }> {
  const runtime = new DockerRuntime();
  await runtime.ensureAppNetwork(APP_NETWORK);
  const wakerStarted = await ensureWakerRunning({
    name: WAKER_CONTAINER,
    repoDir: repoDir(),
    dataDir: dataDir(),
    wakerSockVolume: WAKER_SOCK_VOLUME,
  });
  await ensureEgressRunning({
    name: "sc-egress",
    repoDir: repoDir(),
    dataDir: dataDir(),
    appNetwork: APP_NETWORK,
  });
  const config = loadConfig();
  const baseDomain = requireBaseDomain();
  const authProxyStarted = await ensureAuthProxyRunning({
    name: AUTH_PROXY_CONTAINER,
    repoDir: repoDir(),
    dataDir: dataDir(),
    baseDomain,
    networks: AUTH_PROXY_NETWORKS,
    wakerSockVolume: WAKER_SOCK_VOLUME,
    mail: { ...(config.resendApiKey ? { resendApiKey: config.resendApiKey } : {}), ...(config.mailFrom ? { mailFrom: config.mailFrom } : {}) },
  });
  // the workspace lives at sc-home.<domain>, served by the auth proxy itself
  await runtime.ensureRouteAnchor(
    "sc-route-home",
    ingressLabels("home", { baseDomain, authProxyOrigin: AUTH_PROXY_ORIGIN }),
  );
  return { authProxyStarted: authProxyStarted || wakerStarted };
}
