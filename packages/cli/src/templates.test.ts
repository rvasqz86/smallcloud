import { existsSync, mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { detectStack } from "@smallcloud/control-plane";
import { afterEach, describe, expect, it } from "vitest";
import { TEMPLATE_NAMES, scaffoldTemplate } from "./templates.js";
import { parseCli } from "./args.js";

const dirs: string[] = [];
const fresh = () => {
  const dir = mkdtempSync(join(tmpdir(), "sc-tpl-"));
  dirs.push(dir);
  return join(dir, "app");
};

afterEach(() => {
  for (const dir of dirs.splice(0)) rmSync(dir, { recursive: true, force: true });
});

describe("scaffoldTemplate", () => {
  it("produces deployable apps for every template", () => {
    for (const template of TEMPLATE_NAMES) {
      const dir = fresh();
      scaffoldTemplate(dir, template, "myapp");
      const detection = detectStack(dir);
      expect(detection.kind).toBe(template === "static" ? "static" : "node-web");
    }
  });

  it("vendors the KV library into the kv template", () => {
    const dir = fresh();
    const files = scaffoldTemplate(dir, "kv", "guestbook");
    expect(files).toContain("kv.js");
    expect(existsSync(join(dir, "kv.js"))).toBe(true);
  });

  it("refuses to scaffold over existing files", () => {
    const dir = fresh();
    scaffoldTemplate(dir, "static", "x");
    expect(() => scaffoldTemplate(dir, "node", "x")).toThrow(/not empty/);
  });
});

describe("parseCli new", () => {
  it("parses templates with a node default", () => {
    expect(parseCli(["new", "myapp"])).toEqual({ kind: "new", dir: "myapp", template: "node" });
    expect(parseCli(["new", "myapp", "--template", "kv"])).toEqual({
      kind: "new",
      dir: "myapp",
      template: "kv",
    });
    expect(parseCli(["new"]).kind).toBe("error");
    expect(parseCli(["new", "myapp", "--template", "rails"]).kind).toBe("error");
  });
});
