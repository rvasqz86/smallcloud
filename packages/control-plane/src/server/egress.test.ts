import { beforeEach, describe, expect, it } from "vitest";
import { openDatabase, type Database } from "../db/database.js";
import { migrate } from "../db/migrations.js";
import { createApp, createUser, type App } from "../db/repos.js";
import { listAudit } from "./audit.js";
import {
  authenticateEgress,
  getAppEgress,
  isEgressAllowed,
  rotateEgressToken,
  setAppEgress,
} from "./egress.js";

let db: Database;
let app: App;

beforeEach(() => {
  db = openDatabase(":memory:");
  migrate(db);
  const user = createUser(db, "owner@example.com");
  app = createApp(db, { name: "todo", ownerUserId: user.id });
});

describe("egress allowlist", () => {
  it("sets, normalizes, and replaces the allowlist (audited)", () => {
    expect(setAppEgress(db, app.id, ["API.Example.com", " api.example.com ", "cdn.example.com"])).toEqual([
      "api.example.com",
      "cdn.example.com",
    ]);
    expect(getAppEgress(db, app.id)).toEqual(["api.example.com", "cdn.example.com"]);

    setAppEgress(db, app.id, ["other.example.com"]);
    expect(getAppEgress(db, app.id)).toEqual(["other.example.com"]);
    expect(listAudit(db).filter((e) => e.action === "egress.allow")).toHaveLength(2);
  });

  it("rejects junk hostnames and supports revocation", () => {
    expect(() => setAppEgress(db, app.id, ["bad host!"])).toThrow(/Invalid egress hostname/);
    setAppEgress(db, app.id, ["api.example.com"]);
    setAppEgress(db, app.id, []);
    expect(getAppEgress(db, app.id)).toEqual([]);
  });

  it("answers isEgressAllowed per app + hostname", () => {
    setAppEgress(db, app.id, ["api.example.com"]);
    expect(isEgressAllowed(db, "todo", "api.example.com")).toBe(true);
    expect(isEgressAllowed(db, "todo", "API.EXAMPLE.COM")).toBe(true);
    expect(isEgressAllowed(db, "todo", "evil.example.com")).toBe(false);
    expect(isEgressAllowed(db, "ghost", "api.example.com")).toBe(false);
  });
});

describe("egress credentials", () => {
  it("rotating tokens invalidates old ones; auth checks hash", () => {
    const first = rotateEgressToken(db, app.id);
    expect(authenticateEgress(db, "sc-todo", first)).toBe("todo");
    expect(authenticateEgress(db, "sc-todo", "wrong")).toBeUndefined();
    expect(authenticateEgress(db, "todo", first)).toBeUndefined(); // missing sc- prefix
    expect(authenticateEgress(db, "sc-ghost", first)).toBeUndefined();

    const second = rotateEgressToken(db, app.id);
    expect(authenticateEgress(db, "sc-todo", first)).toBeUndefined();
    expect(authenticateEgress(db, "sc-todo", second)).toBe("todo");
  });

  it("apps with no token never authenticate", () => {
    expect(authenticateEgress(db, "sc-todo", "anything")).toBeUndefined();
  });
});
