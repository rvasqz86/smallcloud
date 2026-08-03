import { sha256Hex } from "@smallcloud/shared";
import { beforeEach, describe, expect, it } from "vitest";
import { openDatabase, type Database } from "../db/database.js";
import { migrate } from "../db/migrations.js";
import { getUserByEmail, getValidSession } from "../db/repos.js";
import {
  LOGIN_TOKEN_TTL_MS,
  issueLoginToken,
  purgeExpiredLoginTokens,
  redeemLoginToken,
} from "./magiclink.js";

let db: Database;

beforeEach(() => {
  db = openDatabase(":memory:");
  migrate(db);
});

describe("magic link flow", () => {
  it("issues and redeems, creating the user and a valid session", () => {
    const { rawToken } = issueLoginToken(db, "new@example.com");
    const redeemed = redeemLoginToken(db, rawToken);

    expect(redeemed).toBeDefined();
    const user = getUserByEmail(db, "new@example.com");
    expect(user?.id).toBe(redeemed!.userId);
    expect(getValidSession(db, sha256Hex(redeemed!.sessionToken))?.userId).toBe(user!.id);
  });

  it("reuses the existing user on subsequent logins", () => {
    const first = redeemLoginToken(db, issueLoginToken(db, "a@example.com").rawToken);
    const second = redeemLoginToken(db, issueLoginToken(db, "a@example.com").rawToken);
    expect(second!.userId).toBe(first!.userId);
  });

  it("rejects reuse of a redeemed token", () => {
    const { rawToken } = issueLoginToken(db, "a@example.com");
    expect(redeemLoginToken(db, rawToken)).toBeDefined();
    expect(redeemLoginToken(db, rawToken)).toBeUndefined();
  });

  it("rejects expired and unknown tokens", () => {
    const issuedAt = Date.now();
    const { rawToken } = issueLoginToken(db, "a@example.com", issuedAt);
    expect(redeemLoginToken(db, rawToken, issuedAt + LOGIN_TOKEN_TTL_MS + 1)).toBeUndefined();
    expect(redeemLoginToken(db, "never-issued")).toBeUndefined();
  });

  it("purges used and expired tokens", () => {
    const now = Date.now();
    issueLoginToken(db, "old@example.com", now - LOGIN_TOKEN_TTL_MS - 1000);
    redeemLoginToken(db, issueLoginToken(db, "used@example.com", now).rawToken, now);
    issueLoginToken(db, "fresh@example.com", now);

    expect(purgeExpiredLoginTokens(db, now)).toBe(2);
  });
});
