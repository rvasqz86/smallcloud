import { beforeEach, describe, expect, it } from "vitest";
import { issueLoginToken, redeemLoginToken } from "../auth/magiclink.js";
import { createShareLink, redeemShareLink, revokeGrant } from "../auth/sharing.js";
import { openDatabase, type Database } from "../db/database.js";
import { migrate } from "../db/migrations.js";
import { createApp, createUser } from "../db/repos.js";
import { listAudit, recordAudit } from "./audit.js";

let db: Database;

beforeEach(() => {
  db = openDatabase(":memory:");
  migrate(db);
});

describe("audit trail", () => {
  it("records the auth and sharing lifecycle in order", () => {
    const owner = createUser(db, "owner@example.com");
    const app = createApp(db, { name: "todo", ownerUserId: owner.id });

    const { rawToken } = issueLoginToken(db, "visitor@example.com");
    redeemLoginToken(db, rawToken);
    const visitor = db.prepare("SELECT id FROM users WHERE email = 'visitor@example.com'").get() as {
      id: string;
    };
    const share = createShareLink(db, app.id, "viewer");
    redeemShareLink(db, share.rawToken, visitor.id);
    revokeGrant(db, app.id, visitor.id);

    const actions = listAudit(db)
      .reverse()
      .map((e) => `${e.action}:${e.actor}:${e.subject}`);
    expect(actions).toEqual([
      "login.issue:visitor@example.com:magic-link",
      "login.redeem:visitor@example.com:session",
      "share.create:owner:todo",
      "share.redeem:visitor@example.com:todo",
      "share.revoke:owner:todo",
    ]);
  });

  it("respects the tail limit and never throws on a broken table", () => {
    for (let i = 0; i < 5; i++) {
      recordAudit(db, { actor: "a", action: "x", subject: String(i) });
    }
    expect(listAudit(db, 2).map((e) => e.subject)).toEqual(["4", "3"]);

    db.exec("DROP TABLE audit_events");
    expect(() => recordAudit(db, { actor: "a", action: "x", subject: "y" })).not.toThrow();
  });
});
