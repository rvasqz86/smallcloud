import type { Detection } from "../detect/detect.js";

export interface BuildRequest {
  /** Absolute path to the app source directory. */
  sourceDir: string;
  detection: Detection;
  /** Full image tag to produce, e.g. "smallcloud/todo:dep-abc123". */
  imageTag: string;
}

export interface BuiltImage {
  imageTag: string;
  /** Port the app listens on inside the container. */
  containerPort: number;
}

export interface RunRequest {
  imageTag: string;
  /** Container name, e.g. "sc-app-todo". */
  name: string;
  /** Docker network to attach to (created with ensureAppNetwork). */
  network: string;
  /** Fractional CPUs. Default 0.5. */
  cpus?: number;
  /** Memory cap in MiB. Default 256. */
  memoryMb?: number;
  /** Writable tmpfs size in MiB — the app's only writable disk. Default 64. */
  tmpfsMb?: number;
  labels?: Record<string, string>;
  env?: Record<string, string>;
  /** Override the image CMD (used by tests and utility containers). */
  command?: string[];
  /** Persistent named volume, e.g. { name: "sc-data-todo", mountPath: "/data" }. */
  volume?: { name: string; mountPath: string };
  /** Docker restart policy. Apps default to "no" (the waker revives them). */
  restart?: "no" | "unless-stopped";
}

export interface RunningContainer {
  containerId: string;
  name: string;
}

/**
 * Isolation backend seam (DECISIONS.md D-004): Docker today, microVMs later.
 * Callers never talk to a concrete backend directly.
 */
export interface Runtime {
  buildImage(request: BuildRequest): Promise<BuiltImage>;
  removeImage(imageTag: string): Promise<void>;
  /** Creates the default-deny (internal) app network if missing. Idempotent. */
  ensureAppNetwork(name: string): Promise<void>;
  runContainer(request: RunRequest): Promise<RunningContainer>;
  /** Stops and removes the container. Idempotent — missing container is fine. */
  stopContainer(nameOrId: string): Promise<void>;
  /** Recent combined stdout/stderr of a container. */
  containerLogs(nameOrId: string, tailLines?: number): Promise<string>;
  /**
   * Ensures a tiny always-on container exists to carry ingress labels.
   * Routes must survive app containers stopping (scale-to-zero), and the
   * reverse proxy drops label-config of stopped containers.
   */
  ensureRouteAnchor(name: string, labels: Record<string, string>): Promise<void>;
  /** Starts a stopped container. Resolves once it reports running. */
  startContainer(nameOrId: string): Promise<void>;
  /** Bytes used inside a named volume (0 for a fresh/missing volume). */
  volumeSizeBytes(name: string): Promise<number>;
  /** Removes a named volume and its data. Idempotent. */
  removeVolume(name: string): Promise<void>;
  /** Names of volumes starting with the prefix. */
  listVolumes(prefix: string): Promise<string[]>;
  /** Tars a volume's contents into destDir/<name>.tar.gz (host path). */
  backupVolume(name: string, destDir: string): Promise<void>;
  /** Restores a volume from a tarball produced by backupVolume. */
  restoreVolume(name: string, tarPath: string): Promise<void>;
}
