import http from "node:http";
import net from "node:net";
import type { Duplex } from "node:stream";

export const EGRESS_PORT = 3128;

export interface EgressProxyOptions {
  /**
   * Proxy Basic-auth credentials → app name, or undefined to reject.
   * Apps receive HTTP_PROXY=http://sc-<app>:<token>@sc-egress:3128 — identity
   * travels in the standard Proxy-Authorization header, so the proxy needs
   * no docker introspection.
   */
  authenticate: (username: string, password: string) => string | undefined;
  /** Per-app hostname allowlist. Deny by default. */
  isAllowed: (appName: string, hostname: string) => boolean;
  /** Observability hook for denials. */
  onDeny?: (appName: string | undefined, hostname: string, kind: "http" | "connect") => void;
}

function parseProxyAuth(header: string | undefined): { user: string; pass: string } | undefined {
  if (!header?.startsWith("Basic ")) return undefined;
  try {
    const decoded = Buffer.from(header.slice(6), "base64").toString("utf8");
    const colon = decoded.indexOf(":");
    if (colon === -1) return undefined;
    return { user: decoded.slice(0, colon), pass: decoded.slice(colon + 1) };
  } catch {
    return undefined;
  }
}

function authRequired(res: http.ServerResponse): void {
  res.writeHead(407, {
    "proxy-authenticate": 'Basic realm="smallcloud-egress"',
    "content-type": "text/plain",
  });
  res.end("Proxy authentication required");
}

/**
 * The controlled hole in the sandbox: apps have zero direct egress; this
 * proxy forwards exactly the hostnames each app has been granted.
 */
export function createEgressProxy(options: EgressProxyOptions): http.Server {
  const server = http.createServer((req, res) => {
    const auth = parseProxyAuth(req.headers["proxy-authorization"]);
    const app = auth && options.authenticate(auth.user, auth.pass);
    if (!app) {
      authRequired(res);
      return;
    }

    // Forward-proxy requests arrive in absolute form: GET http://host/path
    let target: URL;
    try {
      target = new URL(req.url ?? "");
      if (target.protocol !== "http:") throw new Error("not http");
    } catch {
      res.writeHead(400, { "content-type": "text/plain" });
      res.end("Proxy requests must use absolute-form http:// URLs");
      return;
    }

    if (!options.isAllowed(app, target.hostname)) {
      options.onDeny?.(app, target.hostname, "http");
      res.writeHead(403, { "content-type": "text/plain" });
      res.end(`Egress to ${target.hostname} is not allowed for this app`);
      return;
    }

    const headers = { ...req.headers };
    delete headers["proxy-authorization"];
    delete headers["proxy-connection"];
    const upstream = http.request(
      target,
      { method: req.method, headers },
      (upstreamRes) => {
        res.writeHead(upstreamRes.statusCode ?? 502, upstreamRes.headers);
        upstreamRes.pipe(res);
      },
    );
    upstream.on("error", () => {
      if (!res.headersSent) res.writeHead(502, { "content-type": "text/plain" });
      res.end("Upstream unreachable");
    });
    req.pipe(upstream);
  });

  // HTTPS: CONNECT host:port → allowlist check → raw tunnel
  server.on("connect", (req: http.IncomingMessage, socket: Duplex, head: Buffer) => {
    const auth = parseProxyAuth(req.headers["proxy-authorization"]);
    const app = auth && options.authenticate(auth.user, auth.pass);
    if (!app) {
      socket.end('HTTP/1.1 407 Proxy Authentication Required\r\nProxy-Authenticate: Basic realm="smallcloud-egress"\r\n\r\n');
      return;
    }

    const [hostname, portRaw] = (req.url ?? "").split(":");
    const port = Number(portRaw ?? 443);
    if (!hostname || !Number.isInteger(port) || port <= 0 || port > 65535) {
      socket.end("HTTP/1.1 400 Bad Request\r\n\r\n");
      return;
    }
    if (!options.isAllowed(app, hostname)) {
      options.onDeny?.(app, hostname, "connect");
      socket.end("HTTP/1.1 403 Forbidden\r\n\r\n");
      return;
    }

    const upstream = net.connect(port, hostname, () => {
      socket.write("HTTP/1.1 200 Connection Established\r\n\r\n");
      if (head.length) upstream.write(head);
      upstream.pipe(socket);
      socket.pipe(upstream);
    });
    upstream.on("error", () => socket.end("HTTP/1.1 502 Bad Gateway\r\n\r\n"));
    socket.on("error", () => upstream.destroy());
  });

  return server;
}
