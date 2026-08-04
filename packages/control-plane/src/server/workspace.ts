import { appSubdomain } from "@smallcloud/shared";
import type { Database } from "../db/database.js";
import { getRoleForUser, type AppRole } from "../auth/sharing.js";

export interface WorkspaceEntry {
  name: string;
  url: string;
  ownerEmail: string;
  status: string;
  lastUsed: string | undefined;
  /** The viewer's role on this app — undefined means "ask the owner". */
  role: AppRole | undefined;
}

/**
 * The team app directory: every live app with owner, status, and last use.
 * Visibility is team-wide by design (charter M2); per-app access is still
 * enforced by the auth proxy when a link is opened.
 */
export function workspaceEntries(db: Database, viewerUserId: string, baseDomain: string): WorkspaceEntry[] {
  const rows = db
    .prepare(
      `SELECT a.id, a.name, u.email AS owner_email,
              (SELECT d.status FROM deployments d WHERE d.app_id = a.id
               ORDER BY d.created_at DESC, d.rowid DESC LIMIT 1) AS status,
              (SELECT act.last_request_at FROM app_activity act WHERE act.app_name = a.name) AS last_used
       FROM apps a JOIN users u ON u.id = a.owner_user_id
       WHERE a.deleted_at IS NULL
       ORDER BY COALESCE(last_used, '') DESC, a.name`,
    )
    .all() as Array<{
    id: string;
    name: string;
    owner_email: string;
    status: string | null;
    last_used: string | null;
  }>;

  return rows.map((row) => ({
    name: row.name,
    url: `https://${appSubdomain(row.name, baseDomain)}`,
    ownerEmail: row.owner_email,
    status: row.status ?? "never deployed",
    lastUsed: row.last_used ?? undefined,
    role: getRoleForUser(db, row.id, viewerUserId),
  }));
}

const escapeHtml = (value: string) =>
  value.replace(/[&<>"']/g, (c) => `&#${c.charCodeAt(0)};`);

export function renderWorkspacePage(
  db: Database,
  viewerUserId: string,
  viewerEmail: string,
  baseDomain: string,
): string {
  const entries = workspaceEntries(db, viewerUserId, baseDomain);
  const rows = entries
    .map((entry) => {
      const link =
        entry.role !== undefined
          ? `<a href="${entry.url}">${escapeHtml(entry.name)}</a>`
          : escapeHtml(entry.name);
      const lastUsed = entry.lastUsed ? entry.lastUsed.replace("T", " ").slice(0, 16) : "—";
      const badge =
        entry.role !== undefined
          ? `<span class="badge">${entry.role}</span>`
          : `<span class="badge none">no access</span>`;
      return `<tr><td>${link}</td><td>${escapeHtml(entry.ownerEmail)}</td><td>${escapeHtml(entry.status)}</td><td>${lastUsed}</td><td>${badge}</td></tr>`;
    })
    .join("\n");

  return `<title>Smallcloud — workspace</title>
<style>
  body { font: 15px/1.5 system-ui, sans-serif; max-width: 60rem; margin: 3rem auto; padding: 0 1rem; color: #1a1a1a; }
  h1 { font-size: 1.4rem; } small { color: #666; }
  table { border-collapse: collapse; width: 100%; margin-top: 1.5rem; }
  th, td { text-align: left; padding: .5rem .75rem; border-bottom: 1px solid #e5e5e5; }
  th { font-size: .8rem; text-transform: uppercase; letter-spacing: .04em; color: #666; }
  a { color: #0a58ca; text-decoration: none; } a:hover { text-decoration: underline; }
  .topbar { display: flex; justify-content: space-between; align-items: baseline; gap: 1rem; }
  .badge { display: inline-block; padding: .1rem .5rem; border-radius: 99px; font-size: .8rem; background: #e8f0fb; color: #0a58ca; }
  .badge.none { background: #f0f0f0; color: #888; }
</style>
<div class="topbar">
  <h1>Smallcloud workspace <small>· signed in as ${escapeHtml(viewerEmail)}</small></h1>
  <a href="/_sc/logout">Sign out</a>
</div>
${
  entries.length === 0
    ? "<p>No apps yet. Deploy one with <code>smallcloud deploy</code>.</p>"
    : `<table>
<tr><th>App</th><th>Owner</th><th>Status</th><th>Last used</th><th>Your role</th></tr>
${rows}
</table>`
}
<p><small>Apps you have no role on need a share link from their owner. New here? Read the <a href="https://onsmallcloud.com/docs/quickstart.html">quickstart</a>.</small></p>`;
}
