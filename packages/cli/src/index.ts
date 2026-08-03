#!/usr/bin/env node
import { realpathSync } from "node:fs";
import { basename, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { join } from "node:path";
import {
  DetectionError,
  DockerRuntime,
  createLocalDeployer,
  createShareLink,
  dataDir,
  ensureEnvironment,
  getAppByName,
  getUserByEmail,
  issueLoginToken,
  listAudit,
  loadConfig,
  revokeGrant,
  runBackup,
  runDoctor,
  saveConfig,
  type Deployer,
} from "@smallcloud/control-plane";
import { parseCli, sanitizeAppName } from "./args.js";
import { scaffoldTemplate } from "./templates.js";

export const CLI_NAME = "smallcloud";

const USAGE = `Usage: smallcloud <command>

Commands:
  new <dir> [--template static|node|kv]
            Scaffold a ready-to-deploy app (kv = node + persistent storage)
  deploy [dir] [--name <app>] [--email <you@example.com>] [--allow-egress host1,host2]
            Deploy a static site or Node web app to your smallcloud
  status <app>
            Show an app's latest deployment
  logs <app> [--tail N]
            Show recent app logs
  delete <app>
            Stop the app and remove its URL
  share <app> [--role viewer|editor]
            Create a share link (viewer = read-only)
  unshare <app> <email>
            Revoke someone's access
  list      List all apps
  backup    Back up the control-plane DB and all app data now
  audit [--tail N]
            Show recent privileged actions (deploys, shares, logins…)
  doctor    Verify (and heal) the smallcloud installation
  help      Show this help

The first deploy needs --email (it identifies the app owner and is where
sign-in links are addressed); it is remembered afterwards.
`;

const out = (line: string) => process.stdout.write(`${line}\n`);
const err = (line: string) => process.stderr.write(`${line}\n`);

async function cmdDeploy(input: {
  dir: string;
  name?: string;
  email?: string;
  allowEgress?: string[];
}): Promise<number> {
  const config = loadConfig();
  const email = input.email ?? config.email;
  if (!email) {
    err("No owner email known. Run once with: smallcloud deploy --email you@example.com");
    return 1;
  }
  // Remember the first email for convenience; --email never overwrites the
  // stored default (a one-off deploy for another owner must not hijack it).
  if (input.email && !config.email) {
    saveConfig({ ...config, email: input.email });
  }

  const sourceDir = resolve(input.dir);
  const appName = input.name ?? sanitizeAppName(basename(sourceDir));

  const started = Date.now();
  out(`Deploying ${appName} from ${sourceDir}`);

  const { authProxyStarted } = await ensureEnvironment();
  out(authProxyStarted ? "• auth proxy started" : "• auth proxy running");

  const deployer = createLocalDeployer();
  out("• building image…");
  const result = await deployer.deploy({
    sourceDir,
    appName,
    ownerEmail: email,
    ...(input.allowEgress !== undefined ? { allowEgress: input.allowEgress } : {}),
  });
  const seconds = ((Date.now() - started) / 1000).toFixed(1);
  if (input.allowEgress?.length) out(`• egress allowed to: ${input.allowEgress.join(", ")}`);

  const { rawToken } = issueLoginToken(deployer.db, email);
  out("");
  out(`✓ Deployed ${result.appName} in ${seconds}s`);
  out(`  URL      ${result.url}`);
  out(`  Sign in  ${result.url}/_sc/auth?token=${rawToken}`);
  out("");
  out("The app is private: only signed-in users can reach it.");
  return 0;
}

const localDeployer = (): Deployer => createLocalDeployer();

function cmdStatus(name: string): number {
  const status = localDeployer().status(name);
  if (!status) {
    err(`No app named "${name}"`);
    return 1;
  }
  const dep = status.deployment;
  out(`${status.app.name}`);
  out(`  status   ${dep?.status ?? "never deployed"}`);
  if (dep?.url) out(`  URL      ${dep.url}`);
  if (dep) out(`  deployed ${dep.updatedAt}`);
  return 0;
}

async function cmdLogs(name: string, tail: number): Promise<number> {
  const logs = await localDeployer().logs(name, tail);
  if (logs === undefined) {
    err(`No running app named "${name}"`);
    return 1;
  }
  process.stdout.write(logs);
  return 0;
}

async function cmdDelete(name: string): Promise<number> {
  const deleted = await localDeployer().delete(name);
  if (!deleted) {
    err(`No app named "${name}"`);
    return 1;
  }
  out(`✓ Deleted ${name} — its URL no longer routes anywhere`);
  return 0;
}

function cmdShare(name: string, role: "viewer" | "editor"): number {
  const deployer = localDeployer();
  const status = deployer.status(name);
  if (!status?.deployment?.url) {
    err(`No deployed app named "${name}"`);
    return 1;
  }
  const { rawToken } = createShareLink(deployer.db, status.app.id, role);
  out(`Share link (${role}) for ${name}:`);
  out(`  ${status.deployment.url}/_sc/share?token=${rawToken}`);
  out("");
  out("Recipients sign in with a magic link first, then open this link once.");
  return 0;
}

function cmdUnshare(name: string, email: string): number {
  const deployer = localDeployer();
  const app = getAppByName(deployer.db, name);
  if (!app) {
    err(`No app named "${name}"`);
    return 1;
  }
  const user = getUserByEmail(deployer.db, email.trim().toLowerCase());
  const revoked = user ? revokeGrant(deployer.db, app.id, user.id) : false;
  if (!revoked) {
    err(`${email} has no active access to ${name}`);
    return 1;
  }
  out(`✓ Revoked ${email}'s access to ${name}`);
  return 0;
}

function cmdNew(dir: string, template: "static" | "node" | "kv"): number {
  const target = resolve(dir);
  const appName = sanitizeAppName(basename(target));
  const files = scaffoldTemplate(target, template, appName);
  out(`✓ Created ${template} app in ${dir}`);
  out(`  files: ${files.join(", ")}`);
  out("");
  out(`Deploy it:  cd ${dir} && smallcloud deploy`);
  return 0;
}

async function cmdBackup(): Promise<number> {
  const result = await runBackup(
    localDeployer().db,
    new DockerRuntime(),
    join(dataDir(), "backups"),
  );
  out(`✓ Backup written to ${result.dir}`);
  out(`  volumes: ${result.volumes.length ? result.volumes.join(", ") : "none"}`);
  if (result.pruned.length) out(`  pruned:  ${result.pruned.join(", ")}`);
  out("Restore with: node scripts/restore.mjs <YYYY-MM-DD> --yes");
  return 0;
}

function cmdAudit(tail: number): number {
  const events = listAudit(localDeployer().db, tail);
  if (events.length === 0) {
    out("No audit events yet.");
    return 0;
  }
  for (const event of events.reverse()) {
    const when = event.at.replace("T", " ").slice(0, 19);
    out(
      `${when}  ${event.action.padEnd(14)} ${event.actor.padEnd(28)} ${event.subject}${event.detail ? `  (${event.detail})` : ""}`,
    );
  }
  return 0;
}

async function cmdDoctor(): Promise<number> {
  const icons = { ok: "✓", healed: "✚", warn: "!", fail: "✗" } as const;
  const report = await runDoctor({
    db: localDeployer().db,
    dataDir: dataDir(),
    heal: () => ensureEnvironment(),
  });
  for (const check of report.checks) {
    out(`${icons[check.status]} ${check.name.padEnd(28)} ${check.message}`);
  }
  out("");
  out(report.healthy ? "Healthy." : "UNHEALTHY — see ✗ items above.");
  return report.healthy ? 0 : 1;
}

function cmdList(): number {
  const apps = localDeployer().list();
  if (apps.length === 0) {
    out("No apps yet. Deploy one with: smallcloud deploy");
    return 0;
  }
  for (const { app, deployment } of apps) {
    out(`${app.name.padEnd(24)} ${(deployment?.status ?? "-").padEnd(10)} ${deployment?.url ?? ""}`);
  }
  return 0;
}

export async function run(argv: string[]): Promise<number> {
  const command = parseCli(argv);
  try {
    switch (command.kind) {
      case "help":
        out(USAGE);
        return 0;
      case "error":
        err(command.message);
        err(USAGE);
        return 1;
      case "deploy":
        return await cmdDeploy(command);
      case "status":
        return cmdStatus(command.name);
      case "logs":
        return await cmdLogs(command.name, command.tail);
      case "delete":
        return await cmdDelete(command.name);
      case "share":
        return cmdShare(command.name, command.role);
      case "unshare":
        return cmdUnshare(command.name, command.email);
      case "list":
        return cmdList();
      case "new":
        return cmdNew(command.dir, command.template);
      case "backup":
        return await cmdBackup();
      case "audit":
        return cmdAudit(command.tail);
      case "doctor":
        return await cmdDoctor();
    }
  } catch (error) {
    if (error instanceof DetectionError) {
      err(`Cannot deploy: ${error.message}`);
    } else {
      err(`Error: ${(error as Error).message}`);
    }
    return 1;
  }
}

// realpath both sides: npm installs bins as symlinks, so argv[1] and the
// resolved module path differ until canonicalized.
const entrypoint = process.argv[1];
let isMain = false;
try {
  isMain =
    entrypoint !== undefined &&
    realpathSync(fileURLToPath(import.meta.url)) === realpathSync(entrypoint);
} catch {
  isMain = false;
}
if (isMain) {
  run(process.argv.slice(2)).then((code) => {
    process.exitCode = code;
  });
}
