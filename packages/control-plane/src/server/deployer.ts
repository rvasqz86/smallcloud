import { appSubdomain } from "@smallcloud/shared";
import type { Database } from "../db/database.js";
import {
  createApp,
  createDeployment,
  createUser,
  getAppByName,
  getUserByEmail,
  latestDeploymentForApp,
  listApps,
  softDeleteApp,
  updateDeployment,
  type App,
  type Deployment,
} from "../db/repos.js";
import { detectStack } from "../detect/detect.js";
import { ingressLabels } from "../ingress/labels.js";
import type { Runtime } from "../runtime/types.js";
import { recordAudit } from "./audit.js";
import { EGRESS_ORIGIN_HOST, getAppEgress, rotateEgressToken, setAppEgress } from "./egress.js";

export interface DeployerConfig {
  db: Database;
  runtime: Runtime;
  baseDomain: string;
  /** Internal app network, e.g. "smallcloud-apps". */
  network: string;
  /** Where the reverse proxy reaches the auth proxy, e.g. "http://sc-auth-proxy:7777". */
  authProxyOrigin: string;
  /** Per-app persistent-data quota in MiB. Default 256. */
  dataQuotaMb?: number;
}

export const DEFAULT_DATA_QUOTA_MB = 256;

export interface QuotaReport {
  appName: string;
  usedBytes: number;
  quotaBytes: number;
  overQuota: boolean;
  /** Set when the breach stopped the app. */
  stopped?: boolean;
}

export interface DeployInput {
  sourceDir: string;
  appName: string;
  ownerEmail: string;
  /** Hostnames the app may reach via the egress proxy. Omit = keep current; [] = revoke. */
  allowEgress?: string[];
}

export interface DeployResult {
  appName: string;
  deploymentId: string;
  url: string;
}

export interface AppStatus {
  app: App;
  deployment: Deployment | undefined;
}

export function appContainerName(appName: string): string {
  return `sc-app-${appName}`;
}

export function appVolumeName(appName: string): string {
  return `sc-data-${appName}`;
}

/** Always-on label carrier so the route survives the app container stopping. */
export function routeAnchorName(appName: string): string {
  return `sc-route-${appName}`;
}

/** The deploy pipeline: detect → build → sandboxed run behind ingress → record. */
export class Deployer {
  constructor(private readonly cfg: DeployerConfig) {}

  /** The control-plane database — shared with auth flows (magic links). */
  get db(): Database {
    return this.cfg.db;
  }

  async deploy(input: DeployInput): Promise<DeployResult> {
    const { db, runtime } = this.cfg;
    const detection = detectStack(input.sourceDir);

    const email = input.ownerEmail.trim().toLowerCase();
    const owner = getUserByEmail(db, email) ?? createUser(db, email);
    const app =
      getAppByName(db, input.appName) ??
      createApp(db, { name: input.appName, ownerUserId: owner.id });

    const deployment = createDeployment(db, app.id);
    const imageTag = `smallcloud/${app.name}:${deployment.id.slice(0, 8)}`;
    const url = `https://${appSubdomain(app.name, this.cfg.baseDomain)}`;

    const quotaBytes = (this.cfg.dataQuotaMb ?? DEFAULT_DATA_QUOTA_MB) * 1024 * 1024;
    const usedBytes = await runtime.volumeSizeBytes(appVolumeName(app.name));
    if (usedBytes > quotaBytes) {
      updateDeployment(db, deployment.id, { status: "failed" });
      throw new Error(
        `App "${app.name}" data volume is over quota (${Math.round(usedBytes / 1024 / 1024)} MiB used, ` +
          `${this.cfg.dataQuotaMb ?? DEFAULT_DATA_QUOTA_MB} MiB allowed) — free space in /data or delete the app`,
      );
    }

    try {
      await runtime.buildImage({ sourceDir: input.sourceDir, detection, imageTag });
      await runtime.ensureAppNetwork(this.cfg.network);
      await runtime.ensureRouteAnchor(
        routeAnchorName(app.name),
        ingressLabels(app.name, {
          baseDomain: this.cfg.baseDomain,
          authProxyOrigin: this.cfg.authProxyOrigin,
        }),
      );
      if (input.allowEgress !== undefined) {
        setAppEgress(db, app.id, input.allowEgress);
      }
      const egressHosts = getAppEgress(db, app.id);
      const env: Record<string, string> = {};
      if (egressHosts.length > 0) {
        const token = rotateEgressToken(db, app.id);
        const proxyUrl = `http://sc-${app.name}:${token}@${EGRESS_ORIGIN_HOST}`;
        env["HTTP_PROXY"] = proxyUrl;
        env["HTTPS_PROXY"] = proxyUrl;
        env["NO_PROXY"] = "localhost,127.0.0.1";
        env["SMALLCLOUD_EGRESS_ALLOW"] = egressHosts.join(",");
      }

      await runtime.stopContainer(appContainerName(app.name));
      const running = await runtime.runContainer({
        imageTag,
        name: appContainerName(app.name),
        network: this.cfg.network,
        labels: { "smallcloud.app": app.name },
        volume: { name: appVolumeName(app.name), mountPath: "/data" },
        env,
      });

      updateDeployment(db, deployment.id, {
        status: "running",
        imageRef: imageTag,
        containerId: running.containerId,
        url,
      });
      db.prepare(
        "UPDATE deployments SET status = 'stopped' WHERE app_id = ? AND id <> ? AND status = 'running'",
      ).run(app.id, deployment.id);

      recordAudit(db, {
        actor: email,
        action: "deploy",
        subject: app.name,
        detail: deployment.id,
      });
      return { appName: app.name, deploymentId: deployment.id, url };
    } catch (err) {
      updateDeployment(db, deployment.id, { status: "failed" });
      recordAudit(db, {
        actor: email,
        action: "deploy.failed",
        subject: app.name,
        detail: (err as Error).message.slice(0, 200),
      });
      throw err;
    }
  }

  status(appName: string): AppStatus | undefined {
    const app = getAppByName(this.cfg.db, appName);
    if (!app) return undefined;
    return { app, deployment: latestDeploymentForApp(this.cfg.db, app.id) };
  }

  async logs(appName: string, tailLines = 100): Promise<string | undefined> {
    const status = this.status(appName);
    if (!status?.deployment?.containerId || status.deployment.status !== "running") {
      return undefined;
    }
    return this.cfg.runtime.containerLogs(appContainerName(appName), tailLines);
  }

  /**
   * Stops the container (its ingress label — and route — dies with it),
   * removes the image, and soft-deletes the app. History rows are kept.
   */
  async delete(appName: string): Promise<boolean> {
    const status = this.status(appName);
    if (!status) return false;

    await this.cfg.runtime.stopContainer(appContainerName(appName));
    await this.cfg.runtime.stopContainer(routeAnchorName(appName));
    if (status.deployment?.imageRef) {
      await this.cfg.runtime.removeImage(status.deployment.imageRef);
    }
    if (status.deployment && status.deployment.status === "running") {
      updateDeployment(this.cfg.db, status.deployment.id, { status: "deleted" });
    }
    await this.cfg.runtime.removeVolume(appVolumeName(appName));
    softDeleteApp(this.cfg.db, status.app.id);
    recordAudit(this.cfg.db, { actor: "operator", action: "delete", subject: appName });
    return true;
  }

  /**
   * Quota watchdog (DECISIONS.md D-009): measures the app's data volume and
   * stops the app on breach. Run at deploy time and from ops tooling.
   */
  async checkQuota(appName: string): Promise<QuotaReport | undefined> {
    const status = this.status(appName);
    if (!status) return undefined;

    const quotaBytes = (this.cfg.dataQuotaMb ?? DEFAULT_DATA_QUOTA_MB) * 1024 * 1024;
    const usedBytes = await this.cfg.runtime.volumeSizeBytes(appVolumeName(appName));
    const overQuota = usedBytes > quotaBytes;
    const report: QuotaReport = { appName, usedBytes, quotaBytes, overQuota };

    if (overQuota && status.deployment?.status === "running") {
      await this.cfg.runtime.stopContainer(appContainerName(appName));
      updateDeployment(this.cfg.db, status.deployment.id, { status: "stopped" });
      report.stopped = true;
    }
    return report;
  }

  list(): AppStatus[] {
    return listApps(this.cfg.db).map((app) => ({
      app,
      deployment: latestDeploymentForApp(this.cfg.db, app.id),
    }));
  }
}
