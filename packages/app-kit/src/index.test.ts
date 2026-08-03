import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { openKV, type KV } from "./index.js";

const dirs: string[] = [];
const stores: KV[] = [];

function freshKV(namespace?: string, reuseDir?: string): { kv: KV; dir: string } {
  const dir = reuseDir ?? mkdtempSync(join(tmpdir(), "sc-kv-"));
  if (!reuseDir) dirs.push(dir);
  const kv = openKV(namespace ? { dataDir: dir, namespace } : { dataDir: dir });
  stores.push(kv);
  return { kv, dir };
}

afterEach(() => {
  for (const kv of stores.splice(0)) kv.close();
  for (const dir of dirs.splice(0)) rmSync(dir, { recursive: true, force: true });
});

describe("openKV", () => {
  it("round-trips get/put/delete/list", () => {
    const { kv } = freshKV();
    expect(kv.get("missing")).toBeUndefined();

    kv.put("a", "1");
    kv.put("b", "2");
    kv.put("a", "1-updated");
    expect(kv.get("a")).toBe("1-updated");
    expect(kv.list()).toEqual(["a", "b"]);

    expect(kv.delete("a")).toBe(true);
    expect(kv.delete("a")).toBe(false);
    expect(kv.list()).toEqual(["b"]);
  });

  it("filters list by prefix", () => {
    const { kv } = freshKV();
    kv.put("user:1", "x");
    kv.put("user:2", "y");
    kv.put("post:1", "z");
    expect(kv.list("user:")).toEqual(["user:1", "user:2"]);
  });

  it("round-trips JSON", () => {
    const { kv } = freshKV();
    kv.putJSON("cfg", { theme: "dark", count: 3 });
    expect(kv.getJSON<{ theme: string; count: number }>("cfg")).toEqual({
      theme: "dark",
      count: 3,
    });
    expect(kv.getJSON("missing")).toBeUndefined();
  });

  it("separates namespaces within one data dir", () => {
    const { kv, dir } = freshKV("alpha");
    const { kv: beta } = freshKV("beta", dir);
    kv.put("shared-key", "from-alpha");
    expect(beta.get("shared-key")).toBeUndefined();
    beta.put("shared-key", "from-beta");
    expect(kv.get("shared-key")).toBe("from-alpha");
  });

  it("persists across reopen", () => {
    const { kv, dir } = freshKV();
    kv.put("durable", "yes");
    kv.close();

    const again = openKV({ dataDir: dir });
    stores.push(again);
    expect(again.get("durable")).toBe("yes");
  });
});
