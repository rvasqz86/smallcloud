import { execFile } from "node:child_process";
import { promisify } from "node:util";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { DockerRuntime } from "./docker.js";

const exec = promisify(execFile);
const runtime = new DockerRuntime();

const NETWORK = "smallcloud-test-sandbox";
const CONTAINER = "sc-test-sandbox";

beforeAll(async () => {
  await runtime.ensureAppNetwork(NETWORK);
  await runtime.ensureAppNetwork(NETWORK); // idempotent
  await runtime.runContainer({
    imageTag: "node:22-slim",
    name: CONTAINER,
    network: NETWORK,
    labels: { "smallcloud.app": "sandbox-test" },
    command: ["node", "-e", "setInterval(() => {}, 1000)"],
  });
}, 120_000);

afterAll(async () => {
  await runtime.stopContainer(CONTAINER);
  await runtime.stopContainer(CONTAINER); // idempotent
  await exec("docker", ["network", "rm", NETWORK]).catch(() => undefined);
}, 60_000);

async function inspect(): Promise<{
  HostConfig: {
    CapDrop: string[] | null;
    SecurityOpt: string[] | null;
    ReadonlyRootfs: boolean;
    NanoCpus: number;
    Memory: number;
    MemorySwap: number;
    PidsLimit: number | null;
    Tmpfs: Record<string, string> | null;
  };
}> {
  const { stdout } = await exec("docker", ["inspect", CONTAINER]);
  return (JSON.parse(stdout) as Array<ReturnType<typeof JSON.parse>>)[0];
}

describe("sandboxed runContainer", () => {
  it("drops all capabilities and forbids privilege escalation", async () => {
    const info = await inspect();
    expect(info.HostConfig.CapDrop).toContain("ALL");
    expect(info.HostConfig.SecurityOpt).toContain("no-new-privileges");
  });

  it("enforces read-only rootfs with a size-capped tmpfs", async () => {
    const info = await inspect();
    expect(info.HostConfig.ReadonlyRootfs).toBe(true);
    expect(info.HostConfig.Tmpfs?.["/tmp"]).toContain("size=64m");
  });

  it("applies cpu, memory, and pid caps", async () => {
    const info = await inspect();
    expect(info.HostConfig.NanoCpus).toBe(500_000_000);
    expect(info.HostConfig.Memory).toBe(256 * 1024 * 1024);
    expect(info.HostConfig.MemorySwap).toBe(256 * 1024 * 1024); // no swap headroom
    expect(info.HostConfig.PidsLimit).toBe(256);
  });

  it("denies egress to the public internet", { timeout: 30_000 }, async () => {
    const probe = exec("docker", [
      "exec",
      CONTAINER,
      "node",
      "-e",
      `fetch("http://1.1.1.1", { signal: AbortSignal.timeout(5000) })
         .then(() => process.exit(0), () => process.exit(1));`,
    ]);
    await expect(probe).rejects.toMatchObject({ code: 1 });
  });

  it("denies DNS-based egress too", { timeout: 30_000 }, async () => {
    const probe = exec("docker", [
      "exec",
      CONTAINER,
      "node",
      "-e",
      `fetch("https://example.com", { signal: AbortSignal.timeout(5000) })
         .then(() => process.exit(0), () => process.exit(1));`,
    ]);
    await expect(probe).rejects.toMatchObject({ code: 1 });
  });

  it("cannot write outside tmpfs", async () => {
    const probe = exec("docker", [
      "exec",
      CONTAINER,
      "node",
      "-e",
      `require("node:fs").writeFileSync("/escape.txt", "x");`,
    ]);
    await expect(probe).rejects.toThrow(/read-only/);
  });
});
