import { execFileSync } from "node:child_process";
import { mkdirSync, rmSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { StdioClientTransport } from "@modelcontextprotocol/sdk/client/stdio.js";
import { afterAll, beforeAll, describe, expect, it } from "vitest";

/**
 * The M1-02 acceptance, minus the LLM: a real MCP client connects to the
 * built server over stdio and walks deploy → list → logs → delete against
 * the real environment (docker + sc-auth-proxy). What Claude Code does with
 * these tools is exactly this sequence.
 */

const REPO = new URL("../../..", import.meta.url).pathname;
const SERVER = join(REPO, "packages/mcp-server/dist/index.js");
const FIXTURE = join(REPO, ".mcp-test-fixture");
const APP = "mcptest";

let client: Client;

beforeAll(async () => {
  rmSync(FIXTURE, { recursive: true, force: true });
  mkdirSync(FIXTURE, { recursive: true });
  writeFileSync(join(FIXTURE, "index.html"), "<h1>mcp fixture ok</h1>");

  client = new Client({ name: "smallcloud-test-client", version: "0.0.1" });
  await client.connect(
    new StdioClientTransport({ command: "node", args: [SERVER], stderr: "ignore" }),
  );
}, 60_000);

afterAll(async () => {
  await client.close();
  try {
    execFileSync("docker", ["rm", "-f", `sc-app-${APP}`], { stdio: "ignore" });
  } catch {
    /* already gone */
  }
  rmSync(FIXTURE, { recursive: true, force: true });
}, 60_000);

function firstText(result: any): string {
  return result.content?.[0]?.text ?? "";
}

describe("smallcloud MCP server", () => {
  it("exposes the four tools", async () => {
    const { tools } = await client.listTools();
    expect(tools.map((t) => t.name).sort()).toEqual(["delete", "deploy", "list", "logs"]);
  });

  it("deploys, lists, reads logs, and deletes", { timeout: 180_000 }, async () => {
    const deploy = await client.callTool({
      name: "deploy",
      arguments: { sourceDir: FIXTURE, appName: APP, ownerEmail: "mcp@example.com" },
    });
    expect(deploy.isError).toBeFalsy();
    const deployed = JSON.parse(firstText(deploy));
    expect(deployed.url).toBe(`https://sc-${APP}.osita.ai`);
    expect(deployed.signInUrl).toContain("/_sc/auth?token=");

    const list = await client.callTool({ name: "list", arguments: {} });
    const apps = JSON.parse(firstText(list));
    expect(apps.find((a: any) => a.name === APP)?.status).toBe("running");

    const logs = await client.callTool({ name: "logs", arguments: { appName: APP, tail: 20 } });
    expect(logs.isError).toBeFalsy();
    expect(typeof firstText(logs)).toBe("string");

    const del = await client.callTool({ name: "delete", arguments: { appName: APP } });
    expect(JSON.parse(firstText(del)).deleted).toBe(true);

    const after = await client.callTool({ name: "list", arguments: {} });
    expect(JSON.parse(firstText(after)).map((a: any) => a.name)).not.toContain(APP);
  });

  it("returns a tool error for a bad deploy", async () => {
    const res = await client.callTool({
      name: "deploy",
      arguments: { sourceDir: "/nonexistent", appName: "ghost", ownerEmail: "x@y.z" },
    });
    expect(res.isError).toBe(true);
  });
});
