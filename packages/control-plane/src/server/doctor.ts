import { execFile } from "node:child_process";
import { existsSync, readdirSync, statfsSync } from "node:fs";
import { join } from "node:path";
import { promisify } from "node:util";
import type { Database } from "../db/database.js";
import { latestDeploymentForApp, listApps } from "../db/repos.js";
import { appContainerName, routeAnchorName } from "./deployer.js";

const exec = promisify(execFile);

export interface DoctorCheck {
  name: string;
  status: "ok" | "healed" | "warn" | "fail";
  message: string;
}

export interface DoctorReport {
  checks: DoctorCheck[];
  /** No `fail` findings (warns are advisory). */
  healthy: boolean;
}

export interface DoctorOptions {
  db: Database;
  /** ~/.smallcloud/data — disk and backup checks live here. */
  dataDir: string;
  authProxyName?: string;
  wakerName?: string;
  /** Called once when a service is down (production: ensureEnvironment). */
  heal?: () => Promise<unknown>;
  minFreeBytes?: number;
  maxBackupAgeHours?: number;
}

async function containerState(name: string): Promise<string> {
  return exec("docker", ["inspect", name, "--format", "{{.State.Status}}"]).then(
    ({ stdout }) => stdout.trim(),
    () => "missing",
  );
}

export async function runDoctor(options: DoctorOptions): Promise<DoctorReport> {
  const checks: DoctorCheck[] = [];
  const authProxy = options.authProxyName ?? "sc-auth-proxy";
  const waker = options.wakerName ?? "sc-waker";

  // 1. docker reachable — everything else depends on it
  const dockerOk = await exec("docker", ["version", "--format", "{{.Server.Version}}"]).then(
    ({ stdout }) => stdout.trim(),
    () => undefined,
  );
  if (!dockerOk) {
    checks.push({ name: "docker", status: "fail", message: "docker daemon unreachable" });
    return { checks, healthy: false };
  }
  checks.push({ name: "docker", status: "ok", message: `daemon ${dockerOk}` });

  // 2. smallcloud services — heal once if anything is down
  let healed = false;
  for (const service of [authProxy, waker]) {
    let state = await containerState(service);
    if (state !== "running" && options.heal && !healed) {
      await options.heal();
      healed = true;
      state = await containerState(service);
    } else if (state !== "running" && options.heal && healed) {
      state = await containerState(service);
    }
    if (state === "running") {
      checks.push({
        name: `service:${service}`,
        status: healed ? "healed" : "ok",
        message: healed ? "was down — restarted" : "running",
      });
    } else {
      checks.push({ name: `service:${service}`, status: "fail", message: `state: ${state}` });
    }
  }

  // 3. app consistency — stopped app containers are fine (scale-to-zero),
  //    but a running app needs its container + anchor, and strays get flagged
  const apps = listApps(options.db);
  const appNames = new Set(apps.map((a) => a.name));
  for (const app of apps) {
    const deployment = latestDeploymentForApp(options.db, app.id);
    if (deployment?.status !== "running") continue;
    const container = await containerState(appContainerName(app.name));
    const anchor = await containerState(routeAnchorName(app.name));
    if (container === "missing") {
      checks.push({
        name: `app:${app.name}`,
        status: "warn",
        message: "recorded running but container is missing — redeploy it",
      });
    } else if (anchor !== "running") {
      checks.push({
        name: `app:${app.name}`,
        status: "warn",
        message: `route anchor is ${anchor} — its URL is dark; redeploy to fix`,
      });
    } else {
      checks.push({ name: `app:${app.name}`, status: "ok", message: `container ${container}` });
    }
  }
  const { stdout: names } = await exec("docker", [
    "ps",
    "-a",
    "--filter",
    "name=sc-app-",
    "--format",
    "{{.Names}}",
  ]);
  for (const name of names.split("\n").filter(Boolean)) {
    const app = name.replace(/^sc-app-/, "");
    if (!appNames.has(app)) {
      checks.push({
        name: `orphan:${name}`,
        status: "warn",
        message: "container has no app record — remove with docker rm -f",
      });
    }
  }

  // 4. disk space where the data lives
  const stat = statfsSync(options.dataDir);
  const freeBytes = stat.bsize * stat.bavail;
  const minFree = options.minFreeBytes ?? 5 * 1024 ** 3;
  checks.push({
    name: "disk",
    status: freeBytes < minFree ? "warn" : "ok",
    message: `${Math.round(freeBytes / 1024 ** 3)} GiB free`,
  });

  // 5. backup freshness
  const backupsRoot = join(options.dataDir, "backups");
  const dates = existsSync(backupsRoot)
    ? readdirSync(backupsRoot).filter((n) => /^\d{4}-\d{2}-\d{2}$/.test(n)).sort()
    : [];
  const latest = dates.at(-1);
  const maxAgeMs = (options.maxBackupAgeHours ?? 48) * 3600_000;
  const fresh = latest !== undefined && Date.now() - Date.parse(`${latest}T00:00:00Z`) < maxAgeMs;
  checks.push({
    name: "backups",
    status: fresh ? "ok" : "warn",
    message: latest ? `latest ${latest}` : "no backups yet — run: smallcloud backup",
  });

  return { checks, healthy: !checks.some((c) => c.status === "fail") };
}
