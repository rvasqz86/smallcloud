#!/usr/bin/env node
/**
 * Restore Smallcloud from a backup: node scripts/restore.mjs <YYYY-MM-DD> --yes
 *
 * Stops Smallcloud services, restores every app data volume from the backup's
 * tarballs, copies the database snapshot over the live DB, and restarts
 * services. DESTRUCTIVE for current state — hence the required --yes.
 */
import { execFileSync } from "node:child_process";
import { copyFileSync } from "node:fs";
import { homedir } from "node:os";
import { join } from "node:path";
import {
  DockerRuntime,
  restoreVolumesFromBackup,
} from "../packages/control-plane/dist/index.js";

const [date, confirm] = process.argv.slice(2);
if (!date || !/^\d{4}-\d{2}-\d{2}$/.test(date) || confirm !== "--yes") {
  console.error("Usage: node scripts/restore.mjs <YYYY-MM-DD> --yes");
  process.exit(1);
}

const home = process.env.SMALLCLOUD_HOME ?? join(homedir(), ".smallcloud");
const dataDir = join(home, "data");
const backupsRoot = join(dataDir, "backups");
const log = (m) => console.log(`[restore] ${m}`);
const docker = (...args) => execFileSync("docker", args, { stdio: "ignore" });

log("stopping smallcloud services…");
for (const service of ["sc-auth-proxy", "sc-waker"]) {
  try {
    docker("stop", service);
  } catch {
    /* not running */
  }
}

const runtime = new DockerRuntime();
const result = await restoreVolumesFromBackup(runtime, backupsRoot, date);
log(`restored ${result.volumes.length} volume(s): ${result.volumes.join(", ") || "none"}`);

if (result.dbFile) {
  copyFileSync(result.dbFile, join(dataDir, "smallcloud.sqlite"));
  log("database snapshot restored");
}

log("restarting services…");
for (const service of ["sc-waker", "sc-auth-proxy"]) {
  try {
    docker("start", service);
  } catch {
    /* recreated on next deploy if missing */
  }
}
log(`RESTORE COMPLETE from ${date}. Redeploy any app whose container/image is missing.`);
