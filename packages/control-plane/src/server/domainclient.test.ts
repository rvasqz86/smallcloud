import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { loadConfig, saveConfig } from "./composition.js";
import { claimDomain, updateDomainIp } from "./domainclient.js";

let tempHome: string;
const originalHome = process.env["SMALLCLOUD_HOME"];

beforeEach(() => {
  tempHome = mkdtempSync(join(tmpdir(), "sc-domclient-"));
  process.env["SMALLCLOUD_HOME"] = tempHome;
});

afterEach(() => {
  rmSync(tempHome, { recursive: true, force: true });
  if (originalHome === undefined) delete process.env["SMALLCLOUD_HOME"];
  else process.env["SMALLCLOUD_HOME"] = originalHome;
});

const jsonResponse = (status: number, body: unknown) =>
  new Response(JSON.stringify(body), { status, headers: { "content-type": "application/json" } });

describe("claimDomain", () => {
  it("claims and persists baseDomain + token to config", async () => {
    const fetchImpl = (async (url: string | URL, init?: RequestInit) => {
      expect(String(url)).toBe("https://svc.example/claim");
      expect(JSON.parse(init!.body as string)).toEqual({ name: "alice" });
      return jsonResponse(200, { name: "alice", domain: "alice.onsmallcloud.com", token: "tok123" });
    }) as typeof fetch;

    const claimed = await claimDomain("alice", "https://svc.example", fetchImpl);
    expect(claimed.domain).toBe("alice.onsmallcloud.com");
    expect(loadConfig()).toMatchObject({
      baseDomain: "alice.onsmallcloud.com",
      domainName: "alice",
      domainToken: "tok123",
      domainService: "https://svc.example",
    });
  });

  it("surfaces service errors without touching config", async () => {
    const fetchImpl = (async () => jsonResponse(409, { error: "alice is already claimed" })) as typeof fetch;
    await expect(claimDomain("alice", "https://svc.example", fetchImpl)).rejects.toThrow(/already claimed/);
    expect(loadConfig().baseDomain).toBeUndefined();
  });
});

describe("updateDomainIp", () => {
  it("posts name+token from config", async () => {
    saveConfig({ domainName: "alice", domainToken: "tok123", domainService: "https://svc.example" });
    const fetchImpl = (async (url: string | URL, init?: RequestInit) => {
      expect(String(url)).toBe("https://svc.example/update");
      expect(JSON.parse(init!.body as string)).toEqual({ name: "alice", token: "tok123" });
      return jsonResponse(200, { ok: true, domain: "alice.onsmallcloud.com" });
    }) as typeof fetch;
    expect(await updateDomainIp(fetchImpl)).toBe("alice.onsmallcloud.com");
  });

  it("refuses without a claimed domain in config", async () => {
    await expect(updateDomainIp()).rejects.toThrow(/claim one first/);
  });
});
