#!/usr/bin/env node
/**
 * sc-domains: the public claim service for Smallcloud Domains
 * (claim.onsmallcloud.com). Operator-run — needs a Cloudflare token; this is
 * NOT part of a normal Smallcloud install.
 *
 *   POST /claim  {name, ip?}         → {name, domain, token}   (ip defaults to caller)
 *   POST /update {name, token, ip?}  → re-points the records
 *   GET  /                           → service info
 */
import http from "node:http";
import {
  createCloudflareDns,
  handleClaim,
  handleUpdate,
  openDomainsDb,
} from "../packages/control-plane/dist/index.js";
import { clientIp, createRateLimiter } from "../packages/auth-proxy/dist/index.js";

const TOKEN = process.env.SMALLCLOUD_CF_TOKEN;
const ZONE = process.env.SMALLCLOUD_CF_ZONE;
const BASE = process.env.SC_DOMAINS_BASE ?? "onsmallcloud.com";
if (!TOKEN || !ZONE) {
  console.error("SMALLCLOUD_CF_TOKEN and SMALLCLOUD_CF_ZONE are required");
  process.exit(1);
}

const db = openDomainsDb("/data/domains.sqlite");
const dns = createCloudflareDns(TOKEN, ZONE);
// claims are rare and abusable: 3 burst, ~3/hour refill, per client IP
const claimLimiter = createRateLimiter({ capacity: 3, refillPerSec: 3 / 3600 });
const updateLimiter = createRateLimiter({ capacity: 10, refillPerSec: 10 / 60 });

const json = (res, status, body) => {
  res.writeHead(status, { "content-type": "application/json" });
  res.end(JSON.stringify(body));
};

const readJson = (req) =>
  new Promise((resolve) => {
    let body = "";
    req.on("data", (c) => {
      body += c;
      if (body.length > 4096) req.destroy();
    });
    req.on("end", () => {
      try {
        resolve(JSON.parse(body || "{}"));
      } catch {
        resolve({});
      }
    });
  });

http
  .createServer(async (req, res) => {
    const ip = clientIp(req.headers, req.socket.remoteAddress);

    if (req.method === "GET") {
      json(res, 200, {
        service: "smallcloud-domains",
        base: BASE,
        claim: `POST /claim {"name":"yourname"} → free yourname.${BASE} pointing at your server`,
        docs: "https://smallcloud.osita.ai/docs/quickstart.html",
      });
      return;
    }

    if (req.method === "POST" && req.url === "/claim") {
      if (!claimLimiter(ip)) {
        json(res, 429, { error: "too many claims from your address — try again later" });
        return;
      }
      const body = await readJson(req);
      const result = await handleClaim(db, dns, BASE, {
        name: String(body.name ?? ""),
        ip: String(body.ip ?? ip),
      });
      console.log(`[domains] claim ${body.name} from ${ip} → ${result.ok ? "OK" : result.error}`);
      json(res, result.ok ? 200 : result.status, result.ok ? result : { error: result.error });
      return;
    }

    if (req.method === "POST" && req.url === "/update") {
      if (!updateLimiter(ip)) {
        json(res, 429, { error: "slow down" });
        return;
      }
      const body = await readJson(req);
      const result = await handleUpdate(db, dns, BASE, {
        name: String(body.name ?? ""),
        token: String(body.token ?? ""),
        ip: String(body.ip ?? ip),
      });
      console.log(`[domains] update ${body.name} from ${ip} → ${result.ok ? "OK" : result.error}`);
      json(res, result.ok ? 200 : result.status, result.ok ? { ok: true, domain: result.domain } : { error: result.error });
      return;
    }

    json(res, 404, { error: "not found" });
  })
  .listen(8080, "0.0.0.0", () => console.log(`smallcloud-domains for ${BASE} on :8080`));
