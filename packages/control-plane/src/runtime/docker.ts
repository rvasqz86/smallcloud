import { execFile } from "node:child_process";
import { cpSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { basename, join } from "node:path";
import { promisify } from "node:util";
import { APP_PORT, generateCaddyfile, generateDockerfile } from "./dockerfile.js";
import type {
  BuildRequest,
  BuiltImage,
  RunRequest,
  RunningContainer,
  Runtime,
} from "./types.js";

const exec = promisify(execFile);

/** Directories never copied into a build context. */
const CONTEXT_EXCLUDES = new Set(["node_modules", ".git"]);

export const DEFAULT_LIMITS = { cpus: 0.5, memoryMb: 256, tmpfsMb: 64 } as const;

export class DockerBuildError extends Error {}
export class DockerRunError extends Error {}

export class DockerRuntime implements Runtime {
  async buildImage(request: BuildRequest): Promise<BuiltImage> {
    const context = mkdtempSync(join(tmpdir(), "sc-build-"));
    try {
      cpSync(request.sourceDir, join(context, "app"), {
        recursive: true,
        filter: (src) => !CONTEXT_EXCLUDES.has(basename(src)),
      });
      writeFileSync(join(context, "Dockerfile"), generateDockerfile(request.detection));
      if (request.detection.kind === "static") {
        writeFileSync(join(context, "Caddyfile"), generateCaddyfile());
      }

      try {
        await exec("docker", ["build", "-t", request.imageTag, context], {
          maxBuffer: 16 * 1024 * 1024,
        });
      } catch (err) {
        const stderr = (err as { stderr?: string }).stderr ?? String(err);
        throw new DockerBuildError(`docker build failed for ${request.imageTag}:\n${stderr}`);
      }
      return { imageTag: request.imageTag, containerPort: APP_PORT };
    } finally {
      rmSync(context, { recursive: true, force: true });
    }
  }

  async removeImage(imageTag: string): Promise<void> {
    await exec("docker", ["rmi", "-f", imageTag]).catch(() => {
      // Best-effort: a missing image is already the desired end state.
    });
  }

  async ensureAppNetwork(name: string): Promise<void> {
    const { stdout } = await exec("docker", [
      "network",
      "ls",
      "--filter",
      `name=^${name}$`,
      "--format",
      "{{.Name}}",
    ]);
    if (stdout.trim() === name) return;
    // --internal = no route to the outside world: default-deny egress (D-007).
    await exec("docker", ["network", "create", "--internal", name]);
  }

  async runContainer(request: RunRequest): Promise<RunningContainer> {
    const cpus = request.cpus ?? DEFAULT_LIMITS.cpus;
    const memoryMb = request.memoryMb ?? DEFAULT_LIMITS.memoryMb;
    const tmpfsMb = request.tmpfsMb ?? DEFAULT_LIMITS.tmpfsMb;

    const args = [
      "run",
      "-d",
      "--name",
      request.name,
      "--network",
      request.network,
      "--cap-drop",
      "ALL",
      "--security-opt",
      "no-new-privileges",
      "--read-only",
      "--tmpfs",
      `/tmp:rw,noexec,nosuid,size=${tmpfsMb}m`,
      "--cpus",
      String(cpus),
      "--memory",
      `${memoryMb}m`,
      "--memory-swap",
      `${memoryMb}m`,
      "--pids-limit",
      "256",
      "--restart",
      request.restart ?? "no",
    ];
    for (const [key, value] of Object.entries(request.labels ?? {})) {
      args.push("--label", `${key}=${value}`);
    }
    for (const [key, value] of Object.entries(request.env ?? {})) {
      args.push("--env", `${key}=${value}`);
    }
    if (request.volume) {
      args.push("-v", `${request.volume.name}:${request.volume.mountPath}`);
    }
    args.push(request.imageTag);
    if (request.command) args.push(...request.command);

    try {
      const { stdout } = await exec("docker", args);
      return { containerId: stdout.trim(), name: request.name };
    } catch (err) {
      const stderr = (err as { stderr?: string }).stderr ?? String(err);
      throw new DockerRunError(`docker run failed for ${request.name}:\n${stderr}`);
    }
  }

  async stopContainer(nameOrId: string): Promise<void> {
    await exec("docker", ["rm", "-f", nameOrId]).catch(() => {
      // Idempotent: gone is gone.
    });
  }

  async containerLogs(nameOrId: string, tailLines = 100): Promise<string> {
    const { stdout, stderr } = await exec("docker", [
      "logs",
      "--tail",
      String(tailLines),
      nameOrId,
    ]);
    return stdout + stderr;
  }

  async ensureRouteAnchor(name: string, labels: Record<string, string>): Promise<void> {
    const state = await exec("docker", ["inspect", name, "--format", "{{.State.Status}}"]).then(
      ({ stdout }) => stdout.trim(),
      () => "missing",
    );
    if (state === "running") return;
    if (state !== "missing") {
      await exec("docker", ["start", name]);
      return;
    }
    const args = [
      "run",
      "-d",
      "--name",
      name,
      "--network",
      "none",
      "--memory",
      "16m",
      "--cpus",
      "0.05",
      "--cap-drop",
      "ALL",
      "--security-opt",
      "no-new-privileges",
      "--read-only",
      "--restart",
      "unless-stopped",
    ];
    for (const [key, value] of Object.entries(labels)) {
      args.push("--label", `${key}=${value}`);
    }
    args.push("busybox:stable", "sleep", "infinity");
    await exec("docker", args);
  }

  async startContainer(nameOrId: string): Promise<void> {
    await exec("docker", ["start", nameOrId]);
    for (let i = 0; i < 50; i++) {
      const { stdout } = await exec("docker", [
        "inspect",
        nameOrId,
        "--format",
        "{{.State.Status}}",
      ]);
      if (stdout.trim() === "running") return;
      await new Promise((r) => setTimeout(r, 100));
    }
    throw new DockerRunError(`Container ${nameOrId} did not reach running state`);
  }

  async volumeSizeBytes(name: string): Promise<number> {
    const { stdout } = await exec("docker", [
      "run",
      "--rm",
      "-v",
      `${name}:/vol:ro`,
      "alpine",
      "du",
      "-sk",
      "/vol",
    ]);
    const kb = Number(stdout.trim().split(/\s+/)[0]);
    return Number.isFinite(kb) ? kb * 1024 : 0;
  }

  async removeVolume(name: string): Promise<void> {
    await exec("docker", ["volume", "rm", "-f", name]).catch(() => {
      // Idempotent: gone is gone.
    });
  }

  async listVolumes(prefix: string): Promise<string[]> {
    const { stdout } = await exec("docker", ["volume", "ls", "-q"]);
    return stdout
      .split("\n")
      .filter(Boolean)
      .filter((name) => name.startsWith(prefix));
  }

  async backupVolume(name: string, destDir: string): Promise<void> {
    await exec("docker", [
      "run",
      "--rm",
      "-v",
      `${name}:/vol:ro`,
      "-v",
      `${destDir}:/backup`,
      "alpine",
      "tar",
      "czf",
      `/backup/${name}.tar.gz`,
      "-C",
      "/vol",
      ".",
    ]);
  }

  async restoreVolume(name: string, tarPath: string): Promise<void> {
    const dir = tarPath.slice(0, tarPath.lastIndexOf("/"));
    const file = tarPath.slice(tarPath.lastIndexOf("/") + 1);
    await exec("docker", [
      "run",
      "--rm",
      "-v",
      `${name}:/vol`,
      "-v",
      `${dir}:/backup:ro`,
      "alpine",
      "sh",
      "-c",
      `rm -rf /vol/* /vol/..?* /vol/.[!.]* 2>/dev/null; tar xzf /backup/${file} -C /vol`,
    ]);
  }
}
