import { beforeEach, describe, expect, it } from "vitest";
import {
  handleClaim,
  handleUpdate,
  openDomainsDb,
  validateSubdomain,
  type DnsClient,
} from "./domains.js";
import type { Database } from "../db/database.js";

let db: Database;
let records: Map<string, string>;
let dns: DnsClient;

beforeEach(() => {
  db = openDomainsDb(":memory:");
  records = new Map();
  dns = {
    async createRecord(name, ip) {
      records.set(name, ip);
    },
    async updateRecords(name, ip) {
      if (!records.has(name)) return 0;
      records.set(name, ip);
      return 1;
    },
  };
});

describe("validateSubdomain", () => {
  it("enforces length, charset, and the reserved list", () => {
    expect(validateSubdomain("alice")).toBeUndefined();
    expect(validateSubdomain("my-app-2")).toBeUndefined();
    expect(validateSubdomain("ab")).toMatch(/at least 3/);
    expect(validateSubdomain("Bad Name")).toMatch(/lowercase/);
    expect(validateSubdomain("api")).toMatch(/reserved/);
    expect(validateSubdomain("claim")).toMatch(/reserved/);
  });
});

describe("handleClaim", () => {
  it("claims a name: two DNS records + a claim token", async () => {
    const result = await handleClaim(db, dns, "onsmallcloud.com", { name: "Alice", ip: "203.0.113.9" });
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.domain).toBe("alice.onsmallcloud.com");
    expect(result.token).toHaveLength(64);
    expect(records.get("alice.onsmallcloud.com")).toBe("203.0.113.9");
    expect(records.get("*.alice.onsmallcloud.com")).toBe("203.0.113.9");
  });

  it("refuses duplicates, reserved, and missing ip", async () => {
    await handleClaim(db, dns, "x.com", { name: "alice", ip: "203.0.113.9" });
    expect(await handleClaim(db, dns, "x.com", { name: "alice", ip: "203.0.113.10" })).toMatchObject({
      ok: false,
      status: 409,
    });
    expect(await handleClaim(db, dns, "x.com", { name: "api", ip: "1.2.3.4" })).toMatchObject({
      ok: false,
      status: 400,
    });
    expect(await handleClaim(db, dns, "x.com", { name: "bob", ip: "" })).toMatchObject({
      ok: false,
      status: 400,
    });
  });

  it("rolls back the claim row when DNS provisioning fails", async () => {
    const failing: DnsClient = {
      createRecord: async () => {
        throw new Error("cf down");
      },
      updateRecords: async () => 0,
    };
    const result = await handleClaim(db, failing, "x.com", { name: "carol", ip: "1.2.3.4" });
    expect(result).toMatchObject({ ok: false, status: 502 });
    // the name is claimable again
    const retry = await handleClaim(db, dns, "x.com", { name: "carol", ip: "1.2.3.4" });
    expect(retry.ok).toBe(true);
  });
});

describe("handleUpdate", () => {
  it("re-points records with the right token, refuses the wrong one", async () => {
    const claim = await handleClaim(db, dns, "x.com", { name: "dave", ip: "1.2.3.4" });
    if (!claim.ok) throw new Error("claim failed");

    const good = await handleUpdate(db, dns, "x.com", { name: "dave", token: claim.token, ip: "5.6.7.8" });
    expect(good.ok).toBe(true);
    expect(records.get("dave.x.com")).toBe("5.6.7.8");
    expect(records.get("*.dave.x.com")).toBe("5.6.7.8");

    const bad = await handleUpdate(db, dns, "x.com", { name: "dave", token: "wrong", ip: "9.9.9.9" });
    expect(bad).toMatchObject({ ok: false, status: 403 });
    expect(records.get("dave.x.com")).toBe("5.6.7.8");
  });
});
