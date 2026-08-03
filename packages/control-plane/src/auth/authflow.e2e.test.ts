import http from "node:http";
import type { AddressInfo } from "node:net";
import { SESSION_COOKIE, createAuthProxy } from "@smallcloud/auth-proxy";
import { sha256Hex } from "@smallcloud/shared";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { openDatabase, type Database } from "../db/database.js";
import { migrate } from "../db/migrations.js";
import { getValidSession } from "../db/repos.js";
import { issueLoginToken, redeemLoginToken } from "./magiclink.js";

/**
 * The M0-08 acceptance test: full loop against a real database —
 * 401 → request link → redeem → authenticated 200 through the proxy.
 */

let db: Database;
let upstream: http.Server;
let proxy: http.Server;
let proxyPort: number;
const deliveredLinks: string[] = [];

beforeAll(async () => {
  db = openDatabase(":memory:");
  migrate(db);

  upstream = http.createServer((_req, res) => res.end("private app content"));
  await new Promise<void>((r) => upstream.listen(0, "127.0.0.1", r));
  const upstreamPort = (upstream.address() as AddressInfo).port;

  proxy = createAuthProxy({
    baseDomain: "osita.ai",
    appPrefix: "sc-",
    validateSession: (tokenHash) => {
      const session = getValidSession(db, tokenHash);
      return session && { userId: session.userId };
    },
    resolveUpstream: () => `http://127.0.0.1:${upstreamPort}`,
    authorize: () => true, // role logic is covered by sharing tests
    auth: {
      requestLoginLink: (email, host) => {
        const { rawToken } = issueLoginToken(db, email);
        deliveredLinks.push(`https://${host}/_sc/auth?token=${rawToken}`);
      },
      redeemLoginToken: (rawToken) => {
        const redeemed = redeemLoginToken(db, rawToken);
        return redeemed && { sessionToken: redeemed.sessionToken, expiresAt: redeemed.expiresAt };
      },
    },
  });
  await new Promise<void>((r) => proxy.listen(0, "127.0.0.1", r));
  proxyPort = (proxy.address() as AddressInfo).port;
});

afterAll(async () => {
  await new Promise((r) => proxy.close(r));
  await new Promise((r) => upstream.close(r));
});

function request(
  path: string,
  extra: http.OutgoingHttpHeaders = {},
  method = "GET",
  body?: string,
): Promise<{ status: number; body: string; headers: http.IncomingHttpHeaders }> {
  return new Promise((resolve, reject) => {
    const req = http.request(
      {
        host: "127.0.0.1",
        port: proxyPort,
        path,
        method,
        headers: { host: "sc-notes.osita.ai", ...extra },
      },
      (res) => {
        let data = "";
        res.on("data", (c: Buffer) => (data += c.toString()));
        res.on("end", () =>
          resolve({ status: res.statusCode ?? 0, body: data, headers: res.headers }),
        );
      },
    );
    req.on("error", reject);
    req.end(body);
  });
}

describe("full magic-link auth flow", () => {
  it("walks 401 → link → session cookie → 200", async () => {
    const wall = await request("/");
    expect(wall.status).toBe(401);

    const post = await request(
      "/_sc/login",
      { "content-type": "application/x-www-form-urlencoded" },
      "POST",
      "email=builder@example.com",
    );
    expect(post.status).toBe(200);
    expect(deliveredLinks).toHaveLength(1);

    const token = new URL(deliveredLinks[0]!).searchParams.get("token")!;
    const redeem = await request(`/_sc/auth?token=${token}`);
    expect(redeem.status).toBe(302);
    const cookie = redeem.headers["set-cookie"]![0]!;
    const sessionToken = cookie.split(";")[0]!.split("=")[1]!;

    const app = await request("/", { cookie: `${SESSION_COOKIE}=${sessionToken}` });
    expect(app.status).toBe(200);
    expect(app.body).toBe("private app content");

    // and the session in the DB is the hash, never the raw token
    expect(getValidSession(db, sessionToken)).toBeUndefined();
    expect(getValidSession(db, sha256Hex(sessionToken))).toBeDefined();

    // the link is single-use
    const replay = await request(`/_sc/auth?token=${token}`);
    expect(replay.status).toBe(400);
  });
});
