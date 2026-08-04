import { mkdtempSync, rmSync } from "node:fs";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { parseCli, sanitizeAppName } from "./args.js";
import { requireBaseDomain } from "@smallcloud/control-plane";
import { loadConfig, saveConfig, smallcloudHome } from "./config.js";
import { run } from "./index.js";

describe("run", () => {
  it("exits 0 on help", async () => {
    expect(await run(["help"])).toBe(0);
  });

  it("exits 1 on unknown command", async () => {
    expect(await run(["frobnicate"])).toBe(1);
  });
});

describe("parseCli", () => {
  it("parses deploy with defaults", () => {
    expect(parseCli(["deploy"])).toEqual({ kind: "deploy", dir: "." });
  });

  it("parses deploy with dir and flags", () => {
    expect(parseCli(["deploy", "./site", "--name", "todo", "--email", "a@b.c"])).toEqual({
      kind: "deploy",
      dir: "./site",
      name: "todo",
      email: "a@b.c",
    });
  });

  it("parses --allow-egress", () => {
    expect(parseCli(["deploy", "--allow-egress", "api.example.com, cdn.example.com"])).toEqual({
      kind: "deploy",
      dir: ".",
      allowEgress: ["api.example.com", "cdn.example.com"],
    });
    expect(parseCli(["deploy", "--allow-egress"]).kind).toBe("error");
  });

  it("rejects flags without values and unknown flags", () => {
    expect(parseCli(["deploy", "--name"]).kind).toBe("error");
    expect(parseCli(["deploy", "--frob"]).kind).toBe("error");
  });

  it("parses status and list", () => {
    expect(parseCli(["status", "todo"])).toEqual({ kind: "status", name: "todo" });
    expect(parseCli(["list"])).toEqual({ kind: "list" });
    expect(parseCli(["status"]).kind).toBe("error");
  });

  it("parses share and unshare", () => {
    expect(parseCli(["share", "todo"])).toEqual({ kind: "share", name: "todo", role: "viewer" });
    expect(parseCli(["share", "todo", "--role", "editor"])).toEqual({
      kind: "share",
      name: "todo",
      role: "editor",
    });
    expect(parseCli(["share", "todo", "--role", "admin"]).kind).toBe("error");
    expect(parseCli(["share"]).kind).toBe("error");
    expect(parseCli(["unshare", "todo", "a@b.c"])).toEqual({
      kind: "unshare",
      name: "todo",
      email: "a@b.c",
    });
    expect(parseCli(["unshare", "todo"]).kind).toBe("error");
  });

  it("parses domain claim and update-ip", () => {
    expect(parseCli(["domain", "claim", "alice"])).toEqual({ kind: "domain-claim", name: "alice" });
    expect(parseCli(["domain", "claim", "alice", "--service", "https://x.y"])).toEqual({
      kind: "domain-claim",
      name: "alice",
      service: "https://x.y",
    });
    expect(parseCli(["domain", "update-ip"])).toEqual({ kind: "domain-update-ip" });
    expect(parseCli(["domain"]).kind).toBe("error");
    expect(parseCli(["domain", "claim"]).kind).toBe("error");
  });

  it("parses backup and audit", () => {
    expect(parseCli(["backup"])).toEqual({ kind: "backup" });
    expect(parseCli(["audit"])).toEqual({ kind: "audit", tail: 50 });
    expect(parseCli(["audit", "--tail", "10"])).toEqual({ kind: "audit", tail: 10 });
    expect(parseCli(["audit", "--tail", "nope"]).kind).toBe("error");
  });

  it("parses logs and delete", () => {
    expect(parseCli(["logs", "todo"])).toEqual({ kind: "logs", name: "todo", tail: 100 });
    expect(parseCli(["logs", "todo", "--tail", "25"])).toEqual({
      kind: "logs",
      name: "todo",
      tail: 25,
    });
    expect(parseCli(["logs"]).kind).toBe("error");
    expect(parseCli(["logs", "todo", "--tail", "zero"]).kind).toBe("error");
    expect(parseCli(["delete", "todo"])).toEqual({ kind: "delete", name: "todo" });
    expect(parseCli(["delete"]).kind).toBe("error");
  });
});

describe("sanitizeAppName", () => {
  it("normalizes typical directory names", () => {
    expect(sanitizeAppName("My Cool App")).toBe("my-cool-app");
    expect(sanitizeAppName("video_cms")).toBe("video-cms");
    expect(sanitizeAppName("todo")).toBe("todo");
  });

  it("throws when nothing usable remains", () => {
    expect(() => sanitizeAppName("___")).toThrow(/--name/);
  });
});

describe("config", () => {
  const originalHome = process.env["SMALLCLOUD_HOME"];
  let tempHome: string;

  afterEach(() => {
    rmSync(tempHome, { recursive: true, force: true });
    if (originalHome === undefined) delete process.env["SMALLCLOUD_HOME"];
    else process.env["SMALLCLOUD_HOME"] = originalHome;
  });

  it("round-trips config under SMALLCLOUD_HOME", () => {
    tempHome = mkdtempSync(join(process.cwd(), ".sc-test-home-"));
    process.env["SMALLCLOUD_HOME"] = tempHome;

    expect(smallcloudHome()).toBe(tempHome);
    expect(loadConfig()).toEqual({});
    saveConfig({ email: "a@b.c" });
    expect(loadConfig()).toEqual({ email: "a@b.c" });
  });

  it("refuses to operate without a configured baseDomain, with a recipe", () => {
    tempHome = mkdtempSync(join(process.cwd(), ".sc-test-home-"));
    process.env["SMALLCLOUD_HOME"] = tempHome;

    expect(() => requireBaseDomain()).toThrow(/duckdns/);
    saveConfig({ baseDomain: "example.com" });
    expect(requireBaseDomain()).toBe("example.com");
  });
});
