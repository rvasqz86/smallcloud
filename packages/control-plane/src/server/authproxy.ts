import { execFile } from "node:child_process";
import { statSync } from "node:fs";
import { promisify } from "node:util";
import { sha256Hex } from "@smallcloud/shared";

const exec = promisify(execFile);

export interface AuthProxyRunConfig {
  /** Container name. Production: "sc-auth-proxy". */
  name: string;
  /** Repo root, mounted read-only at /ws (code + entry script). */
  repoDir: string;
  /** Writable data dir holding the shared SQLite file, mounted at /data. */
  dataDir: string;
  baseDomain: string;
  /** First network is the run network; the rest are connected after start. */
  networks: string[];
  /** Named volume carrying the waker socket, mounted at /sock. */
  wakerSockVolume?: string;
  /** Email delivery settings — a change recreates the container to apply. */
  mail?: { resendApiKey?: string; mailFrom?: string };
}

function mailFingerprint(mail?: { resendApiKey?: string; mailFrom?: string }): string {
  return sha256Hex(`${mail?.resendApiKey ?? ""}|${mail?.mailFrom ?? ""}`).slice(0, 12);
}

/**
 * Ensures the containerized auth proxy is up (composition per D-008).
 * Idempotent: a running container with the expected mounts is left alone.
 * Returns true if (re)started.
 */
export async function ensureAuthProxyRunning(cfg: AuthProxyRunConfig): Promise<boolean> {
  const state = await exec("docker", [
    "inspect",
    cfg.name,
    "--format",
    "{{.State.Status}}",
  ]).then(
    ({ stdout }) => stdout.trim(),
    () => "missing",
  );
  if (state === "running") {
    const { stdout } = await exec("docker", [
      "inspect",
      cfg.name,
      "--format",
      '{{json .Mounts}}{{index .Config.Labels "smallcloud.mailcfg"}}',
    ]);
    const [mountsJson, mailLabel] = stdout.split("");
    const hasSock =
      !cfg.wakerSockVolume ||
      (JSON.parse(mountsJson!) as Array<{ Name?: string }>).some(
        (m) => m.Name === cfg.wakerSockVolume,
      );
    const mailCurrent = (mailLabel ?? "").trim() === mailFingerprint(cfg.mail);
    if (hasSock && mailCurrent) return false;
    // config drift (new mount or mail settings) → recreate below
  }

  await exec("docker", ["rm", "-f", cfg.name]).catch(() => undefined);
  const [runNetwork, ...extraNetworks] = cfg.networks;
  await exec("docker", [
    "run",
    "-d",
    "--name",
    cfg.name,
    "--network",
    runNetwork!,
    "--read-only",
    "--tmpfs",
    "/tmp:rw,size=32m",
    "--user",
    "1000:1000",
    "--cap-drop",
    "ALL",
    "--security-opt",
    "no-new-privileges",
    "--memory",
    "256m",
    "--cpus",
    "0.5",
    "--restart",
    "unless-stopped",
    "-v",
    `${cfg.repoDir}:/ws:ro`,
    "-v",
    `${cfg.dataDir}:/data`,
    ...(cfg.wakerSockVolume ? ["-v", `${cfg.wakerSockVolume}:/sock`] : []),
    "-e",
    `SC_BASE_DOMAIN=${cfg.baseDomain}`,
    ...(cfg.mail?.resendApiKey ? ["-e", `SC_RESEND_API_KEY=${cfg.mail.resendApiKey}`] : []),
    ...(cfg.mail?.mailFrom ? ["-e", `SC_MAIL_FROM=${cfg.mail.mailFrom}`] : []),
    "--label",
    `smallcloud.mailcfg=${mailFingerprint(cfg.mail)}`,
    "node:22-slim",
    "node",
    "/ws/scripts/authproxy-entry.mjs",
  ]);
  for (const network of extraNetworks) {
    await exec("docker", ["network", "connect", network, cfg.name]);
  }
  return true;
}

export interface EgressRunConfig {
  /** Container name. Production: "sc-egress". */
  name: string;
  repoDir: string;
  dataDir: string;
  /** Internal app network (where apps reach it) — it also joins "bridge" for internet access. */
  appNetwork: string;
}

/**
 * Ensures the egress proxy is up: dual-homed — the internal app network for
 * inbound, the default bridge for outbound internet. DB mounted for
 * credential + allowlist lookups. No docker socket.
 */
export async function ensureEgressRunning(cfg: EgressRunConfig): Promise<boolean> {
  const state = await exec("docker", [
    "inspect",
    cfg.name,
    "--format",
    "{{.State.Status}}",
  ]).then(
    ({ stdout }) => stdout.trim(),
    () => "missing",
  );
  if (state === "running") return false;

  await exec("docker", ["rm", "-f", cfg.name]).catch(() => undefined);
  await exec("docker", [
    "run",
    "-d",
    "--name",
    cfg.name,
    "--network",
    cfg.appNetwork,
    "--user",
    "1000:1000",
    "--read-only",
    "--tmpfs",
    "/tmp:rw,size=16m",
    "--cap-drop",
    "ALL",
    "--security-opt",
    "no-new-privileges",
    "--memory",
    "128m",
    "--cpus",
    "0.25",
    "--restart",
    "unless-stopped",
    "-v",
    `${cfg.repoDir}:/ws:ro`,
    "-v",
    `${cfg.dataDir}:/data`,
    "node:22-slim",
    "node",
    "/ws/scripts/egress-entry.mjs",
  ]);
  await exec("docker", ["network", "connect", "bridge", cfg.name]);
  return true;
}

export interface WakerRunConfig {
  /** Container name. Production: "sc-waker". */
  name: string;
  repoDir: string;
  dataDir: string;
  wakerSockVolume: string;
  idleMinutes?: number;
}

/**
 * Ensures the scale-to-zero waker/reaper daemon is up (D-011). It holds the
 * docker socket — trusted code only, never exposed to app traffic; the only
 * docker actions it performs are start/stop of `sc-app-*` containers.
 */
export async function ensureWakerRunning(cfg: WakerRunConfig): Promise<boolean> {
  const state = await exec("docker", [
    "inspect",
    cfg.name,
    "--format",
    "{{.State.Status}}",
  ]).then(
    ({ stdout }) => stdout.trim(),
    () => "missing",
  );
  if (state === "running") return false;

  await exec("docker", ["rm", "-f", cfg.name]).catch(() => undefined);
  // uid 1000 matches the data dir owner (cap-drop ALL removes DAC_OVERRIDE,
  // so root couldn't write it); the socket's group grants docker API access.
  // The sock volume starts root-owned — hand it to the waker's uid first.
  await exec("docker", [
    "run",
    "--rm",
    "-v",
    `${cfg.wakerSockVolume}:/sock`,
    "alpine",
    "chown",
    "1000:1000",
    "/sock",
  ]);
  const dockerGid = statSync("/var/run/docker.sock").gid;
  await exec("docker", [
    "run",
    "-d",
    "--name",
    cfg.name,
    "--network",
    "none",
    "--user",
    "1000:1000",
    "--group-add",
    String(dockerGid),
    "--read-only",
    "--tmpfs",
    "/tmp:rw,size=16m",
    "--cap-drop",
    "ALL",
    "--security-opt",
    "no-new-privileges",
    "--memory",
    "128m",
    "--cpus",
    "0.25",
    "--restart",
    "unless-stopped",
    "-v",
    "/var/run/docker.sock:/var/run/docker.sock",
    "-v",
    `${cfg.repoDir}:/ws:ro`,
    "-v",
    `${cfg.dataDir}:/data`,
    "-v",
    `${cfg.wakerSockVolume}:/sock`,
    "-e",
    `IDLE_MINUTES=${cfg.idleMinutes ?? 15}`,
    "-e",
    `SC_HOST_DATA_DIR=${cfg.dataDir}`,
    "node:22-slim",
    "node",
    "/ws/scripts/waker-entry.mjs",
  ]);
  return true;
}
