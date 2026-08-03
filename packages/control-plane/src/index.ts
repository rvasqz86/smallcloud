export const SERVICE_NAME = "smallcloud-control-plane";

export { openDatabase, type Database } from "./db/database.js";
export { migrate, MIGRATIONS, type Migration } from "./db/migrations.js";
export * from "./db/repos.js";
export { detectStack, DetectionError, type Detection, type StackKind } from "./detect/detect.js";
export {
  createShareLink,
  getRoleForUser,
  isAllowed,
  redeemShareLink,
  revokeGrant,
  revokeShareLinks,
  type AppRole,
  type ShareRole,
} from "./auth/sharing.js";
export {
  LOGIN_TOKEN_TTL_MS,
  SESSION_TTL_MS,
  issueLoginToken,
  purgeExpiredLoginTokens,
  redeemLoginToken,
  type IssuedLoginToken,
  type RedeemedSession,
} from "./auth/magiclink.js";
export { APP_PORT, generateDockerfile } from "./runtime/dockerfile.js";
export { ingressLabels, type IngressConfig } from "./ingress/labels.js";
export { containerIpOnNetwork, gatewayIpForProxy } from "./ingress/discover.js";
export {
  Deployer,
  appContainerName,
  type AppStatus,
  type DeployInput,
  type DeployResult,
  type DeployerConfig,
} from "./server/deployer.js";
export { createControlPlaneServer } from "./server/http.js";
export { routeAnchorName } from "./server/deployer.js";
export {
  DEFAULT_IDLE_MINUTES,
  lastActivity,
  selectIdleApps,
  touchAppActivity,
  type RunningApp,
} from "./server/idle.js";
export { ensureWakerRunning, type WakerRunConfig } from "./server/authproxy.js";
export {
  renderWorkspacePage,
  workspaceEntries,
  type WorkspaceEntry,
} from "./server/workspace.js";
export { listAudit, recordAudit, type AuditEvent } from "./server/audit.js";
export { runDoctor, type DoctorCheck, type DoctorOptions, type DoctorReport } from "./server/doctor.js";
export {
  EGRESS_CONTAINER,
  EGRESS_ORIGIN_HOST,
  authenticateEgress,
  getAppEgress,
  isEgressAllowed,
  rotateEgressToken,
  setAppEgress,
} from "./server/egress.js";
export { ensureEgressRunning, type EgressRunConfig } from "./server/authproxy.js";
export {
  createMailSender,
  deliverLoginLink,
  type LinkDelivery,
  type MailSender,
  type MailSettings,
} from "./server/mail.js";
export {
  BACKUP_KEEP_DAYS,
  backupDirName,
  expiredBackupDirs,
  restoreVolumesFromBackup,
  runBackup,
  type BackupResult,
  type RestoreResult,
} from "./server/backup.js";
export { ensureAuthProxyRunning, type AuthProxyRunConfig } from "./server/authproxy.js";
export {
  APP_NETWORK,
  AUTH_PROXY_CONTAINER,
  AUTH_PROXY_NETWORKS,
  AUTH_PROXY_ORIGIN,
  DEFAULT_BASE_DOMAIN,
  appKitFile,
  createLocalDeployer,
  dataDir,
  ensureEnvironment,
  loadConfig,
  repoDir,
  saveConfig,
  smallcloudHome,
  type LocalConfig,
} from "./server/composition.js";
export { DockerRuntime, DockerBuildError, DockerRunError, DEFAULT_LIMITS } from "./runtime/docker.js";
export type {
  BuildRequest,
  BuiltImage,
  RunRequest,
  RunningContainer,
  Runtime,
} from "./runtime/types.js";
