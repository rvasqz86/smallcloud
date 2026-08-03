import http from "node:http";
import net from "node:net";
import type { AddressInfo } from "node:net";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { createEgressProxy } from "./server.js";

const TOKEN = "app-egress-token";
const AUTH = `Basic ${Buffer.from(`sc-todo:${TOKEN}`).toString("base64")}`;
const BAD_AUTH = `Basic ${Buffer.from("sc-todo:wrong").toString("base64")}`;

let upstream: http.Server;
let upstreamPort: number;
let proxy: http.Server;
let proxyPort: number;
const denials: Array<{ app: string | undefined; host: string; kind: string }> = [];

beforeAll(async () => {
  upstream = http.createServer((req, res) => {
    res.writeHead(200, { "content-type": "text/plain" });
    res.end(`upstream saw ${req.url}`);
  });
  await new Promise<void>((r) => upstream.listen(0, "127.0.0.1", r));
  upstreamPort = (upstream.address() as AddressInfo).port;

  proxy = createEgressProxy({
    authenticate: (user, pass) =>
      user === "sc-todo" && pass === TOKEN ? "todo" : undefined,
    isAllowed: (app, hostname) => app === "todo" && hostname === "127.0.0.1",
    onDeny: (app, host, kind) => denials.push({ app, host, kind }),
  });
  await new Promise<void>((r) => proxy.listen(0, "127.0.0.1", r));
  proxyPort = (proxy.address() as AddressInfo).port;
});

afterAll(async () => {
  await new Promise((r) => proxy.close(r));
  await new Promise((r) => upstream.close(r));
});

function proxyRequest(
  targetUrl: string,
  auth: string | undefined,
): Promise<{ status: number; body: string }> {
  return new Promise((resolve, reject) => {
    const req = http.request(
      {
        host: "127.0.0.1",
        port: proxyPort,
        path: targetUrl, // absolute-form, as HTTP_PROXY clients send
        headers: auth ? { "proxy-authorization": auth } : {},
      },
      (res) => {
        let body = "";
        res.on("data", (c: Buffer) => (body += c.toString()));
        res.on("end", () => resolve({ status: res.statusCode ?? 0, body }));
      },
    );
    req.on("error", reject);
    req.end();
  });
}

function connectTunnel(target: string, auth: string | undefined): Promise<string> {
  return new Promise((resolve, reject) => {
    const socket = net.connect(proxyPort, "127.0.0.1", () => {
      socket.write(
        `CONNECT ${target} HTTP/1.1\r\nHost: ${target}\r\n${auth ? `Proxy-Authorization: ${auth}\r\n` : ""}\r\n`,
      );
    });
    let response = "";
    socket.on("data", (chunk) => {
      response += chunk.toString();
      // after the tunnel is established, speak plain HTTP through it
      if (response.includes("200 Connection Established") && !response.includes("upstream saw")) {
        socket.write(`GET /tunneled HTTP/1.1\r\nHost: 127.0.0.1\r\nConnection: close\r\n\r\n`);
      }
      if (response.includes("upstream saw") || /HTTP\/1\.1 (4|5)\d\d/.test(response.slice(0, 20))) {
        socket.end();
      }
    });
    socket.on("close", () => resolve(response));
    socket.on("error", reject);
    setTimeout(() => socket.destroy(new Error("tunnel timeout")), 5000);
  });
}

describe("egress proxy — plain HTTP", () => {
  it("forwards allowlisted requests and strips proxy auth", async () => {
    const res = await proxyRequest(`http://127.0.0.1:${upstreamPort}/data?x=1`, AUTH);
    expect(res.status).toBe(200);
    expect(res.body).toBe("upstream saw /data?x=1");
  });

  it("407s without or with bad credentials", async () => {
    expect((await proxyRequest(`http://127.0.0.1:${upstreamPort}/`, undefined)).status).toBe(407);
    expect((await proxyRequest(`http://127.0.0.1:${upstreamPort}/`, BAD_AUTH)).status).toBe(407);
  });

  it("403s non-allowlisted hosts without contacting them", async () => {
    const res = await proxyRequest("http://blocked.example.com/steal", AUTH);
    expect(res.status).toBe(403);
    expect(denials.at(-1)).toEqual({ app: "todo", host: "blocked.example.com", kind: "http" });
  });

  it("400s non-absolute requests", async () => {
    const res = await proxyRequest("/relative-path", AUTH);
    expect(res.status).toBe(400);
  });
});

describe("egress proxy — CONNECT tunnels", () => {
  it("tunnels to allowlisted hosts", async () => {
    const response = await connectTunnel(`127.0.0.1:${upstreamPort}`, AUTH);
    expect(response).toContain("200 Connection Established");
    expect(response).toContain("upstream saw /tunneled");
  });

  it("refuses tunnels without auth or to blocked hosts", async () => {
    expect(await connectTunnel(`127.0.0.1:${upstreamPort}`, undefined)).toContain("407");
    const blocked = await connectTunnel("blocked.example.com:443", AUTH);
    expect(blocked).toContain("403");
    expect(denials.at(-1)).toEqual({ app: "todo", host: "blocked.example.com", kind: "connect" });
  });
});
