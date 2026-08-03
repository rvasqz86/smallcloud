#!/usr/bin/env node
import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import {
  DetectionError,
  createLocalDeployer,
  ensureEnvironment,
  issueLoginToken,
  loadConfig,
} from "@smallcloud/control-plane";
import { z } from "zod";

/**
 * Smallcloud MCP server: lets agents (Claude Code and friends) deploy, list,
 * inspect, and delete apps over stdio. Runs on the smallcloud host itself.
 */

const text = (value: unknown) => ({
  content: [{ type: "text" as const, text: JSON.stringify(value, null, 2) }],
});

const errorText = (message: string) => ({
  content: [{ type: "text" as const, text: message }],
  isError: true,
});

export function buildServer(): McpServer {
  const server = new McpServer({ name: "smallcloud", version: "0.1.0" });

  server.registerTool(
    "deploy",
    {
      description:
        "Deploy a static site or Node web app directory to smallcloud. Returns the public " +
        "auth-gated URL and a single-use sign-in link. Apps are private by default.",
      inputSchema: {
        sourceDir: z.string().describe("Absolute path to the app directory"),
        appName: z
          .string()
          .describe("App name (lowercase letters, digits, hyphens). Becomes sc-<name>.<domain>"),
        ownerEmail: z
          .string()
          .optional()
          .describe("Owner email; defaults to the configured smallcloud user"),
        allowEgress: z
          .array(z.string())
          .optional()
          .describe(
            "Hostnames the app may reach via the egress proxy (apps have zero egress otherwise). Omit to keep current; [] to revoke.",
          ),
      },
    },
    async ({ sourceDir, appName, ownerEmail, allowEgress }) => {
      const email = ownerEmail ?? loadConfig().email;
      if (!email) {
        return errorText(
          "No owner email: pass ownerEmail or set one via `smallcloud deploy --email you@example.com`",
        );
      }
      try {
        await ensureEnvironment();
        const deployer = createLocalDeployer();
        const result = await deployer.deploy({
          sourceDir,
          appName,
          ownerEmail: email,
          ...(allowEgress !== undefined ? { allowEgress } : {}),
        });
        const { rawToken } = issueLoginToken(deployer.db, email);
        return text({
          url: result.url,
          signInUrl: `${result.url}/_sc/auth?token=${rawToken}`,
          deploymentId: result.deploymentId,
          note: "The app is private: the URL requires sign-in. The sign-in link is single-use.",
        });
      } catch (err) {
        if (err instanceof DetectionError) return errorText(`Cannot deploy: ${err.message}`);
        throw err;
      }
    },
  );

  server.registerTool(
    "list",
    { description: "List all smallcloud apps with their latest deployment status and URL." },
    async () => {
      const apps = createLocalDeployer()
        .list()
        .map(({ app, deployment }) => ({
          name: app.name,
          status: deployment?.status ?? "never deployed",
          url: deployment?.url ?? null,
          updatedAt: deployment?.updatedAt ?? null,
        }));
      return text(apps);
    },
  );

  server.registerTool(
    "logs",
    {
      description: "Fetch recent logs for a running smallcloud app.",
      inputSchema: {
        appName: z.string(),
        tail: z.number().int().positive().optional().describe("Lines to fetch (default 100)"),
      },
    },
    async ({ appName, tail }) => {
      const logs = await createLocalDeployer().logs(appName, tail ?? 100);
      if (logs === undefined) return errorText(`No running app named "${appName}"`);
      return { content: [{ type: "text" as const, text: logs || "(no log output yet)" }] };
    },
  );

  server.registerTool(
    "delete",
    {
      description:
        "Delete a smallcloud app: stops its container and removes its public URL. Irreversible.",
      inputSchema: { appName: z.string() },
    },
    async ({ appName }) => {
      const deleted = await createLocalDeployer().delete(appName);
      if (!deleted) return errorText(`No app named "${appName}"`);
      return text({ deleted: true, appName });
    },
  );

  return server;
}

const entrypoint = process.argv[1];
let isMain = false;
try {
  const { realpathSync } = await import("node:fs");
  const { fileURLToPath } = await import("node:url");
  isMain =
    entrypoint !== undefined &&
    realpathSync(fileURLToPath(import.meta.url)) === realpathSync(entrypoint);
} catch {
  isMain = false;
}
if (isMain) {
  const server = buildServer();
  await server.connect(new StdioServerTransport());
}
