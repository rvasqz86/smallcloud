import { beforeEach, describe, expect, it } from "vitest";
import { openDatabase, type Database } from "../db/database.js";
import { migrate } from "../db/migrations.js";
import { createApp, createUser, type App, type User } from "../db/repos.js";
import {
  createShareLink,
  getRoleForUser,
  isAllowed,
  redeemShareLink,
  revokeGrant,
  revokeShareLinks,
} from "./sharing.js";

let db: Database;
let owner: User;
let visitor: User;
let app: App;

beforeEach(() => {
  db = openDatabase(":memory:");
  migrate(db);
  owner = createUser(db, "owner@example.com");
  visitor = createUser(db, "visitor@example.com");
  app = createApp(db, { name: "todo", ownerUserId: owner.id });
});

describe("share links and roles", () => {
  it("gives the owner full access with no grant", () => {
    expect(getRoleForUser(db, app.id, owner.id)).toBe("owner");
    expect(isAllowed(db, "todo", owner.id, "POST")).toBe(true);
  });

  it("denies a signed-in user with no grant", () => {
    expect(getRoleForUser(db, app.id, visitor.id)).toBeUndefined();
    expect(isAllowed(db, "todo", visitor.id, "GET")).toBe(false);
  });

  it("viewer link grants read-only access", () => {
    const { rawToken } = createShareLink(db, app.id, "viewer");
    expect(redeemShareLink(db, rawToken, visitor.id)).toBe(true);

    expect(getRoleForUser(db, app.id, visitor.id)).toBe("viewer");
    expect(isAllowed(db, "todo", visitor.id, "GET")).toBe(true);
    expect(isAllowed(db, "todo", visitor.id, "POST")).toBe(false);
  });

  it("editor link grants write access, and re-redemption upgrades a viewer", () => {
    redeemShareLink(db, createShareLink(db, app.id, "viewer").rawToken, visitor.id);
    redeemShareLink(db, createShareLink(db, app.id, "editor").rawToken, visitor.id);

    expect(getRoleForUser(db, app.id, visitor.id)).toBe("editor");
    expect(isAllowed(db, "todo", visitor.id, "POST")).toBe(true);
  });

  it("rejects unknown and revoked links", () => {
    expect(redeemShareLink(db, "never-issued", visitor.id)).toBe(false);

    const { rawToken } = createShareLink(db, app.id, "viewer");
    expect(revokeShareLinks(db, app.id)).toBe(1);
    expect(redeemShareLink(db, rawToken, visitor.id)).toBe(false);
  });

  it("owner can revoke a grant", () => {
    redeemShareLink(db, createShareLink(db, app.id, "editor").rawToken, visitor.id);
    expect(isAllowed(db, "todo", visitor.id, "GET")).toBe(true);

    expect(revokeGrant(db, app.id, visitor.id)).toBe(true);
    expect(isAllowed(db, "todo", visitor.id, "GET")).toBe(false);
    expect(revokeGrant(db, app.id, visitor.id)).toBe(false);
  });

  it("denies everything for unknown apps", () => {
    expect(isAllowed(db, "ghost", owner.id, "GET")).toBe(false);
  });
});
