import { beforeEach, describe, expect, it } from "vitest";
import { openDatabase, type Database } from "./database.js";
import { migrate } from "./migrations.js";
import {
  createApp,
  createDeployment,
  createSession,
  createUser,
  deleteExpiredSessions,
  getAppByName,
  getUserByEmail,
  getValidSession,
  latestDeploymentForApp,
  listApps,
  softDeleteApp,
  updateDeployment,
} from "./repos.js";

let db: Database;

beforeEach(() => {
  db = openDatabase(":memory:");
  migrate(db);
});

describe("migrate", () => {
  it("is idempotent", () => {
    expect(migrate(db)).toBe(0);
  });

  it("applies to a fresh database", () => {
    const fresh = openDatabase(":memory:");
    expect(migrate(fresh)).toBeGreaterThan(0);
  });
});

describe("users", () => {
  it("creates and fetches by email", () => {
    const user = createUser(db, "a@example.com");
    expect(getUserByEmail(db, "a@example.com")).toEqual(user);
    expect(getUserByEmail(db, "missing@example.com")).toBeUndefined();
  });

  it("rejects duplicate emails", () => {
    createUser(db, "a@example.com");
    expect(() => createUser(db, "a@example.com")).toThrow();
  });
});

describe("apps", () => {
  it("creates, lists, and soft-deletes", () => {
    const user = createUser(db, "a@example.com");
    const app = createApp(db, { name: "todo", ownerUserId: user.id });
    expect(getAppByName(db, "todo")?.id).toBe(app.id);
    expect(listApps(db)).toHaveLength(1);

    softDeleteApp(db, app.id);
    expect(getAppByName(db, "todo")).toBeUndefined();
    expect(listApps(db)).toHaveLength(0);
  });

  it("frees the name for reuse after soft-delete", () => {
    const user = createUser(db, "a@example.com");
    const first = createApp(db, { name: "todo", ownerUserId: user.id });
    softDeleteApp(db, first.id);

    const second = createApp(db, { name: "todo", ownerUserId: user.id });
    expect(second.id).not.toBe(first.id);
    expect(getAppByName(db, "todo")?.id).toBe(second.id);
  });

  it("rejects invalid names and duplicate names", () => {
    const user = createUser(db, "a@example.com");
    expect(() => createApp(db, { name: "Bad Name", ownerUserId: user.id })).toThrow(
      /Invalid app name/,
    );
    createApp(db, { name: "todo", ownerUserId: user.id });
    expect(() => createApp(db, { name: "todo", ownerUserId: user.id })).toThrow();
  });

  it("rejects reserved names", () => {
    const user = createUser(db, "a@example.com");
    expect(() => createApp(db, { name: "home", ownerUserId: user.id })).toThrow(/reserved/);
    expect(() => createApp(db, { name: "www", ownerUserId: user.id })).toThrow(/reserved/);
  });

  it("enforces the owner foreign key", () => {
    expect(() => createApp(db, { name: "todo", ownerUserId: "nonexistent" })).toThrow();
  });
});

describe("deployments", () => {
  it("tracks lifecycle from building to running", () => {
    const user = createUser(db, "a@example.com");
    const app = createApp(db, { name: "todo", ownerUserId: user.id });
    const dep = createDeployment(db, app.id);
    expect(dep.status).toBe("building");

    const updated = updateDeployment(db, dep.id, {
      status: "running",
      containerId: "abc123",
      url: "https://sc-todo.osita.ai",
    });
    expect(updated?.status).toBe("running");
    expect(updated?.containerId).toBe("abc123");
    expect(latestDeploymentForApp(db, app.id)?.id).toBe(dep.id);
  });

  it("returns the newest deployment for an app", () => {
    const user = createUser(db, "a@example.com");
    const app = createApp(db, { name: "todo", ownerUserId: user.id });
    createDeployment(db, app.id);
    const second = createDeployment(db, app.id);
    expect(latestDeploymentForApp(db, app.id)?.id).toBe(second.id);
  });
});

describe("sessions", () => {
  it("validates against expiry", () => {
    const user = createUser(db, "a@example.com");
    const future = new Date(Date.now() + 60_000).toISOString();
    createSession(db, { tokenHash: "hash1", userId: user.id, expiresAt: future });

    expect(getValidSession(db, "hash1")?.userId).toBe(user.id);
    const afterExpiry = new Date(Date.now() + 120_000).toISOString();
    expect(getValidSession(db, "hash1", afterExpiry)).toBeUndefined();
  });

  it("purges expired sessions", () => {
    const user = createUser(db, "a@example.com");
    const past = new Date(Date.now() - 60_000).toISOString();
    const future = new Date(Date.now() + 60_000).toISOString();
    createSession(db, { tokenHash: "old", userId: user.id, expiresAt: past });
    createSession(db, { tokenHash: "new", userId: user.id, expiresAt: future });

    expect(deleteExpiredSessions(db)).toBe(1);
    expect(getValidSession(db, "new")).toBeDefined();
  });
});
