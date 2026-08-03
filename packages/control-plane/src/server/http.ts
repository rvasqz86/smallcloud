import http from "node:http";
import { DetectionError } from "../detect/detect.js";
import type { Deployer } from "./deployer.js";

/**
 * Localhost-only control-plane API (the CLI and MCP server are its clients).
 * Never expose beyond 127.0.0.1 — it deploys arbitrary local directories.
 */
export function createControlPlaneServer(deployer: Deployer): http.Server {
  return http.createServer((req, res) => {
    void route(req, res, deployer);
  });
}

function json(res: http.ServerResponse, status: number, body: unknown): void {
  res.writeHead(status, { "content-type": "application/json" });
  res.end(JSON.stringify(body));
}

async function route(
  req: http.IncomingMessage,
  res: http.ServerResponse,
  deployer: Deployer,
): Promise<void> {
  const url = new URL(req.url ?? "/", "http://localhost");

  try {
    if (req.method === "POST" && url.pathname === "/deploy") {
      const body = await readJson(req);
      const { sourceDir, appName, ownerEmail } = body as Record<string, unknown>;
      if (
        typeof sourceDir !== "string" ||
        typeof appName !== "string" ||
        typeof ownerEmail !== "string"
      ) {
        json(res, 400, { error: "sourceDir, appName, and ownerEmail are required" });
        return;
      }
      const result = await deployer.deploy({ sourceDir, appName, ownerEmail });
      json(res, 200, result);
      return;
    }

    if (req.method === "GET" && url.pathname === "/apps") {
      json(res, 200, deployer.list());
      return;
    }

    const logsMatch = /^\/apps\/([a-z0-9-]+)\/logs$/.exec(url.pathname);
    if (req.method === "GET" && logsMatch) {
      const tail = Number(url.searchParams.get("tail") ?? 100);
      const logs = await deployer.logs(logsMatch[1]!, tail);
      if (logs === undefined) {
        json(res, 404, { error: "app not found or not running" });
        return;
      }
      json(res, 200, { logs });
      return;
    }

    const appMatch = /^\/apps\/([a-z0-9-]+)$/.exec(url.pathname);
    if (req.method === "GET" && appMatch) {
      const status = deployer.status(appMatch[1]!);
      if (!status) {
        json(res, 404, { error: "app not found" });
        return;
      }
      json(res, 200, status);
      return;
    }
    if (req.method === "DELETE" && appMatch) {
      const deleted = await deployer.delete(appMatch[1]!);
      if (!deleted) {
        json(res, 404, { error: "app not found" });
        return;
      }
      json(res, 200, { deleted: true });
      return;
    }

    json(res, 404, { error: "not found" });
  } catch (err) {
    if (err instanceof DetectionError || err instanceof SyntaxError) {
      json(res, 400, { error: (err as Error).message });
      return;
    }
    json(res, 500, { error: (err as Error).message });
  }
}

function readJson(req: http.IncomingMessage): Promise<unknown> {
  return new Promise((resolve, reject) => {
    let body = "";
    req.on("data", (chunk: Buffer) => {
      body += chunk.toString();
      if (body.length > 1024 * 1024) {
        reject(new Error("Body too large"));
        req.destroy();
      }
    });
    req.on("end", () => {
      try {
        resolve(body ? JSON.parse(body) : {});
      } catch (err) {
        reject(err);
      }
    });
    req.on("error", reject);
  });
}
