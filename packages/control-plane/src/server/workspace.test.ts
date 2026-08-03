import { beforeEach, describe, expect, it } from "vitest";
import { createShareLink, redeemShareLink } from "../auth/sharing.js";
import { openDatabase, type Database } from "../db/database.js";
import { migrate } from "../db/migrations.js";
import { createApp, createDeployment, createUser, updateDeployment, type User } from "../db/repos.js";
import { touchAppActivity } from "./idle.js";
import { renderWorkspacePage, workspaceEntries } from "./workspace.js";

let db: Database;
let owner: User;
let teammate: User;

beforeEach(() => {
  db = openDatabase(":memory:");
  migrate(db);
  owner = createUser(db, "owner@example.com");
  teammate = createUser(db, "mate@example.com");

  const todo = createApp(db, { name: "todo", ownerUserId: owner.id });
  const dep = createDeployment(db, todo.id);
  updateDeployment(db, dep.id, { status: "running", url: "https://sc-todo.osita.ai" });
  touchAppActivity(db, "todo", "2026-08-01T10:00:00Z");

  createApp(db, { name: "notes", ownerUserId: teammate.id });
  redeemShareLink(db, createShareLink(db, todo.id, "viewer").rawToken, teammate.id);
});

describe("workspaceEntries", () => {
  it("lists every live app with owner, status, last-used, and the viewer's role", () => {
    const forTeammate = workspaceEntries(db, teammate.id, "osita.ai");
    expect(forTeammate).toEqual([
      {
        name: "todo",
        url: "https://sc-todo.osita.ai",
        ownerEmail: "owner@example.com",
        status: "running",
        lastUsed: "2026-08-01T10:00:00Z",
        role: "viewer",
      },
      {
        name: "notes",
        url: "https://sc-notes.osita.ai",
        ownerEmail: "mate@example.com",
        status: "never deployed",
        lastUsed: undefined,
        role: "owner",
      },
    ]);
  });

  it("shows no role for apps the viewer cannot open", () => {
    const forOwner = workspaceEntries(db, owner.id, "osita.ai");
    expect(forOwner.find((e) => e.name === "notes")?.role).toBeUndefined();
    expect(forOwner.find((e) => e.name === "todo")?.role).toBe("owner");
  });
});

describe("renderWorkspacePage", () => {
  it("renders accessible apps as links and inaccessible ones as text", () => {
    const page = renderWorkspacePage(db, teammate.id, "mate@example.com", "osita.ai");
    expect(page).toContain('signed in as mate@example.com');
    expect(page).toContain('href="/_sc/logout"');
    expect(page).toContain('class="badge"');
    expect(page).toContain("docs/quickstart.html");
    expect(page).toContain('<a href="https://sc-todo.osita.ai">todo</a>');
    expect(page).toContain('<a href="https://sc-notes.osita.ai">notes</a>');

    const ownerPage = renderWorkspacePage(db, owner.id, "owner@example.com", "osita.ai");
    expect(ownerPage).not.toContain('<a href="https://sc-notes.osita.ai">');
    expect(ownerPage).toContain("notes");
  });

  it("escapes HTML in user data", () => {
    const evil = createUser(db, '<script>alert(1)</script>@example.com');
    const app = createApp(db, { name: "evil", ownerUserId: evil.id });
    void app;
    const page = renderWorkspacePage(db, owner.id, "owner@example.com", "osita.ai");
    expect(page).not.toContain("<script>alert(1)</script>");
  });
});
