import { mkdtempSync, mkdirSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { DetectionError, detectStack } from "./detect.js";

const created: string[] = [];

function fixture(files: Record<string, string>): string {
  const dir = mkdtempSync(join(tmpdir(), "sc-detect-"));
  created.push(dir);
  for (const [path, content] of Object.entries(files)) {
    const full = join(dir, path);
    mkdirSync(join(full, ".."), { recursive: true });
    writeFileSync(full, content);
  }
  return dir;
}

afterEach(() => {
  for (const dir of created.splice(0)) rmSync(dir, { recursive: true, force: true });
});

describe("detectStack", () => {
  it("detects a plain static site", () => {
    const dir = fixture({ "index.html": "<h1>hi</h1>", "style.css": "" });
    expect(detectStack(dir).kind).toBe("static");
  });

  it("detects a Node app with a start script", () => {
    const dir = fixture({
      "package.json": JSON.stringify({ scripts: { start: "node server.js" } }),
      "server.js": "",
    });
    const d = detectStack(dir);
    expect(d.kind).toBe("node-web");
    expect(d.startCommand).toBe("npm run start");
    expect(d.buildCommand).toBeUndefined();
  });

  it("captures the build command when present", () => {
    const dir = fixture({
      "package.json": JSON.stringify({
        scripts: { start: "node dist/server.js", build: "tsc" },
      }),
    });
    expect(detectStack(dir).buildCommand).toBe("npm run build");
  });

  it("falls back to main as the entrypoint", () => {
    const dir = fixture({
      "package.json": JSON.stringify({ main: "server.js" }),
      "server.js": "",
    });
    const d = detectStack(dir);
    expect(d.kind).toBe("node-web");
    expect(d.startCommand).toBe("node server.js");
  });

  it("treats package.json without entrypoints plus index.html as static", () => {
    const dir = fixture({
      "package.json": JSON.stringify({ devDependencies: { vite: "^7.0.0" } }),
      "index.html": "<h1>hi</h1>",
    });
    expect(detectStack(dir).kind).toBe("static");
  });

  it("rejects an empty directory", () => {
    const dir = fixture({});
    expect(() => detectStack(dir)).toThrow(DetectionError);
    expect(() => detectStack(dir)).toThrow(/Unsupported app/);
  });

  it("rejects an ambiguous package.json-only app", () => {
    const dir = fixture({ "package.json": JSON.stringify({ name: "x" }) });
    expect(() => detectStack(dir)).toThrow(/Ambiguous app/);
  });

  it("rejects invalid package.json", () => {
    const dir = fixture({ "package.json": "{not json" });
    expect(() => detectStack(dir)).toThrow(/not valid JSON/);
  });

  it("rejects a missing directory", () => {
    expect(() => detectStack("/nonexistent/path/xyz")).toThrow(/does not exist/);
  });
});
