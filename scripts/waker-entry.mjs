#!/usr/bin/env node
/**
 * sc-waker: the scale-to-zero daemon (runs as a container, D-011).
 *
 * - Wake: listens on /sock/waker.sock (shared volume with the auth proxy);
 *   a JSON line {"app":"name"} starts the app container and replies once
 *   it is running. The auth proxy never touches docker (D-008) — this
 *   daemon does, over the Engine API, and only for `sc-app-*` names.
 * - Reap: every 30s stops app containers idle beyond IDLE_MINUTES, judged
 *   by the auth proxy's activity table + container start time.
 */
import { chmodSync, existsSync, mkdirSync, readdirSync, rmSync, unlinkSync } from "node:fs";
import http from "node:http";
import net from "node:net";
import {
  backupDirName,
  expiredBackupDirs,
  openDatabase,
  selectIdleApps,
} from "../packages/control-plane/dist/index.js";

const SOCK = "/sock/waker.sock";
const DOCKER = "/var/run/docker.sock";
const IDLE_MS = Number(process.env.IDLE_MINUTES ?? 15) * 60_000;
const APP_NAME_RE = /^[a-z0-9](?:[a-z0-9-]*[a-z0-9])?$/;
const BACKUPS_DIR = "/data/backups";
/** Host path of /data — needed to construct binds for helper containers. */
const HOST_DATA_DIR = process.env.SC_HOST_DATA_DIR;

const db = openDatabase("/data/smallcloud.sqlite");
const log = (m) => console.log(`[waker] ${m}`);

function dockerApi(method, path, jsonBody) {
  return new Promise((resolve, reject) => {
    const payload = jsonBody === undefined ? undefined : JSON.stringify(jsonBody);
    const req = http.request(
      {
        socketPath: DOCKER,
        method,
        path,
        headers: payload ? { "content-type": "application/json" } : {},
      },
      (res) => {
        let body = "";
        res.on("data", (c) => (body += c));
        res.on("end", () => resolve({ status: res.statusCode ?? 0, body }));
      },
    );
    req.on("error", reject);
    req.end(payload);
  });
}

/** Run a one-shot helper container to completion (Engine API, no CLI). */
async function runOneShot(image, cmd, binds) {
  const create = await dockerApi("POST", "/containers/create", {
    Image: image,
    Cmd: cmd,
    HostConfig: { Binds: binds },
  });
  if (create.status !== 201) throw new Error(`create failed: ${create.body.slice(0, 200)}`);
  const id = JSON.parse(create.body).Id;
  try {
    await dockerApi("POST", `/containers/${id}/start`);
    await dockerApi("POST", `/containers/${id}/wait`);
  } finally {
    await dockerApi("DELETE", `/containers/${id}?force=true`);
  }
}

async function runDailyBackup() {
  if (!HOST_DATA_DIR) {
    log("backup skipped: SC_HOST_DATA_DIR not set");
    return;
  }
  const date = backupDirName(Date.now());
  const dir = `${BACKUPS_DIR}/${date}`;
  if (existsSync(`${dir}/smallcloud.sqlite`)) return; // already done today
  mkdirSync(dir, { recursive: true });

  rmSync(`${dir}/smallcloud.sqlite`, { force: true });
  db.exec(`VACUUM INTO '${dir}/smallcloud.sqlite'`);

  const list = await dockerApi("GET", "/volumes");
  const volumes = (JSON.parse(list.body).Volumes ?? [])
    .map((v) => v.Name)
    .filter((n) => n.startsWith("sc-data-"));
  for (const volume of volumes) {
    await runOneShot(
      "alpine",
      ["tar", "czf", `/backup/${volume}.tar.gz`, "-C", "/vol", "."],
      [`${volume}:/vol:ro`, `${HOST_DATA_DIR}/backups/${date}:/backup`],
    );
  }

  for (const old of expiredBackupDirs(readdirSync(BACKUPS_DIR), Date.now())) {
    rmSync(`${BACKUPS_DIR}/${old}`, { recursive: true, force: true });
  }
  log(`backup complete: ${date} (${volumes.length} volumes)`);
}

async function wakeApp(app) {
  if (!APP_NAME_RE.test(app)) return false;
  const name = `sc-app-${app}`;
  const started = await dockerApi("POST", `/containers/${name}/start`);
  if (started.status !== 204 && started.status !== 304) return false;
  for (let i = 0; i < 50; i++) {
    const info = await dockerApi("GET", `/containers/${name}/json`);
    if (info.status === 200 && JSON.parse(info.body).State?.Running) return true;
    await new Promise((r) => setTimeout(r, 100));
  }
  return false;
}

async function reap() {
  const list = await dockerApi(
    "GET",
    `/containers/json?filters=${encodeURIComponent(JSON.stringify({ name: ["sc-app-"] }))}`,
  );
  if (list.status !== 200) return;
  const running = JSON.parse(list.body)
    .filter((c) => c.Names?.some((n) => n.startsWith("/sc-app-")))
    .map((c) => ({
      appName: c.Names[0].replace("/sc-app-", ""),
      id: c.Id,
    }));
  if (running.length === 0) return;

  const withStart = [];
  for (const c of running) {
    const info = await dockerApi("GET", `/containers/${c.id}/json`);
    if (info.status === 200) {
      withStart.push({ appName: c.appName, startedAt: JSON.parse(info.body).State.StartedAt });
    }
  }
  const activity = new Map(
    db.prepare("SELECT app_name, last_request_at FROM app_activity").all()
      .map((r) => [r.app_name, r.last_request_at]),
  );
  for (const app of selectIdleApps(withStart, activity, Date.now(), IDLE_MS)) {
    log(`reaping idle app ${app}`);
    await dockerApi("POST", `/containers/sc-app-${app}/stop?t=5`);
  }
}

try {
  unlinkSync(SOCK);
} catch {
  /* fresh socket */
}
const server = net.createServer((conn) => {
  let buffer = "";
  conn.on("data", (chunk) => {
    buffer += chunk.toString();
    const newline = buffer.indexOf("\n");
    if (newline === -1) return;
    const line = buffer.slice(0, newline);
    buffer = "";
    let app;
    try {
      app = JSON.parse(line).app;
    } catch {
      conn.end(JSON.stringify({ ok: false }) + "\n");
      return;
    }
    wakeApp(String(app ?? "")).then(
      (ok) => conn.end(JSON.stringify({ ok }) + "\n"),
      () => conn.end(JSON.stringify({ ok: false }) + "\n"),
    );
  });
});
server.listen(SOCK, () => {
  // The proxy connects as uid 1000; the volume is private to the two containers.
  chmodSync(SOCK, 0o666);
  log(`listening on ${SOCK}, idle timeout ${IDLE_MS / 60000}m`);
});
setInterval(() => reap().catch((err) => log(`reap error: ${err.message}`)), 30_000);
setTimeout(() => runDailyBackup().catch((err) => log(`backup error: ${err.message}`)), 10_000);
setInterval(() => runDailyBackup().catch((err) => log(`backup error: ${err.message}`)), 60 * 60_000);
