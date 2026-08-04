import { randomBytes } from "node:crypto";
import { isValidAppName, sha256Hex } from "@smallcloud/shared";
import { openDatabase, type Database } from "../db/database.js";

/**
 * "Smallcloud Domains" — free user subdomains on an operator-owned zone
 * (ngrok-style). A claim creates NAME.<base> and *.NAME.<base> pointing at
 * the claimant's server; a claim token allows re-pointing later (dynamic IP).
 * DNS-only records (not proxied): each user's own caddy terminates TLS.
 */

/** Names Smallcloud Domains will never hand out. */
export const RESERVED_SUBDOMAINS = new Set([
  "www", "api", "claim", "mail", "smtp", "ns", "ns1", "ns2", "admin", "auth",
  "smallcloud", "app", "apps", "home", "docs", "blog", "status", "dashboard",
]);

export function validateSubdomain(name: string): string | undefined {
  if (name.length < 3) return "name must be at least 3 characters";
  if (name.length > 40) return "name must be at most 40 characters";
  if (!isValidAppName(name)) return "lowercase letters, digits, and inner hyphens only";
  if (RESERVED_SUBDOMAINS.has(name)) return "that name is reserved";
  return undefined;
}

/** Minimal Cloudflare DNS client — injectable fetch for tests. */
export interface DnsClient {
  createRecord(name: string, ip: string): Promise<void>;
  /** Re-points every record whose name matches exactly. */
  updateRecords(name: string, ip: string): Promise<number>;
}

export function createCloudflareDns(
  token: string,
  zoneId: string,
  fetchImpl: typeof fetch = fetch,
): DnsClient {
  const api = async (path: string, init?: RequestInit): Promise<any> => {
    const res = await fetchImpl(`https://api.cloudflare.com/client/v4/zones/${zoneId}${path}`, {
      ...init,
      headers: { authorization: `Bearer ${token}`, "content-type": "application/json" },
    });
    const body = (await res.json()) as { success: boolean; result?: unknown; errors?: unknown };
    if (!body.success) throw new Error(`cloudflare: ${JSON.stringify(body.errors).slice(0, 300)}`);
    return body.result;
  };

  return {
    async createRecord(name, ip) {
      await api("/dns_records", {
        method: "POST",
        body: JSON.stringify({
          type: ip.includes(":") ? "AAAA" : "A",
          name,
          content: ip,
          proxied: false,
          ttl: 300,
          comment: "smallcloud-domains claim",
        }),
      });
    },
    async updateRecords(name, ip) {
      const records = (await api(`/dns_records?name=${encodeURIComponent(name)}`)) as Array<{
        id: string;
      }>;
      for (const record of records) {
        await api(`/dns_records/${record.id}`, {
          method: "PATCH",
          body: JSON.stringify({ type: ip.includes(":") ? "AAAA" : "A", content: ip }),
        });
      }
      return records.length;
    },
  };
}

export function openDomainsDb(path: string): Database {
  const db = openDatabase(path);
  db.exec(`
    CREATE TABLE IF NOT EXISTS claims (
      name TEXT PRIMARY KEY,
      token_hash TEXT NOT NULL,
      ip TEXT NOT NULL,
      created_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now')),
      updated_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now'))
    );
  `);
  return db;
}

export type ClaimResult =
  | { ok: true; name: string; domain: string; token: string }
  | { ok: false; status: number; error: string };

export async function handleClaim(
  db: Database,
  dns: DnsClient,
  baseDomain: string,
  input: { name: string; ip: string },
): Promise<ClaimResult> {
  const name = input.name.trim().toLowerCase();
  const invalid = validateSubdomain(name);
  if (invalid) return { ok: false, status: 400, error: invalid };
  if (!input.ip) return { ok: false, status: 400, error: "could not determine your server's IP" };

  const taken = db.prepare("SELECT 1 FROM claims WHERE name = ?").get(name);
  if (taken) return { ok: false, status: 409, error: `${name} is already claimed` };

  const token = randomBytes(32).toString("hex");
  db.prepare("INSERT INTO claims (name, token_hash, ip) VALUES (?, ?, ?)").run(
    name,
    sha256Hex(token),
    input.ip,
  );
  try {
    await dns.createRecord(`${name}.${baseDomain}`, input.ip);
    await dns.createRecord(`*.${name}.${baseDomain}`, input.ip);
  } catch (err) {
    db.prepare("DELETE FROM claims WHERE name = ?").run(name);
    return { ok: false, status: 502, error: `DNS provisioning failed: ${(err as Error).message}` };
  }
  return { ok: true, name, domain: `${name}.${baseDomain}`, token };
}

export async function handleUpdate(
  db: Database,
  dns: DnsClient,
  baseDomain: string,
  input: { name: string; token: string; ip: string },
): Promise<ClaimResult> {
  const name = input.name.trim().toLowerCase();
  const row = db.prepare("SELECT token_hash FROM claims WHERE name = ?").get(name) as
    | { token_hash: string }
    | undefined;
  if (!row || row.token_hash !== sha256Hex(input.token ?? "")) {
    return { ok: false, status: 403, error: "unknown name or wrong claim token" };
  }
  if (!input.ip) return { ok: false, status: 400, error: "could not determine your server's IP" };

  await dns.updateRecords(`${name}.${baseDomain}`, input.ip);
  await dns.updateRecords(`*.${name}.${baseDomain}`, input.ip);
  db.prepare(
    "UPDATE claims SET ip = ?, updated_at = strftime('%Y-%m-%dT%H:%M:%fZ','now') WHERE name = ?",
  ).run(input.ip, name);
  return { ok: true, name, domain: `${name}.${baseDomain}`, token: input.token };
}
