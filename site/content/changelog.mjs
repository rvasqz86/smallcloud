export default {
  slug: "changelog",
  title: "Smallcloud changelog — what shipped and when",
  description:
    "Release history for Smallcloud: the v1 deploy platform, v2 enterprise hardening and public docs, and v3 controlled egress, templates, and social cards.",
  body: `
<h1>Changelog</h1>

<h2>v3.2 — Free subdomains <small>· 2026-08-04</small></h2>
<ul>
  <li><strong>smallcloud domain claim yourname</strong> — a free <code>yourname.onsmallcloud.com</code> pointed at your server, claimed and configured in one command. No domain purchase, no DNS knowledge.</li>
  <li><code>smallcloud domain update-ip</code> re-points your subdomain if your server's IP changes.</li>
  <li>No lock-in: switching to your own domain is one config line.</li>
</ul>

<h2>v3.1 — Public release on npm <small>· 2026-08-03</small></h2>
<ul>
  <li><strong>Smallcloud is installable</strong>: <code>npm install -g @rvasqz86/smallcloud</code> — the CLI and MCP server, MIT-licensed, self-contained.</li>
  <li>The platform no longer requires a source checkout: services run from the installed package.</li>
</ul>

<h2>v3 — Product depth <small>· 2026-08-02</small></h2>
<ul>
  <li><strong>Controlled egress</strong>: deploy with <code>--allow-egress api.example.com</code> and your app can reach exactly those hostnames through an authenticated forward proxy — deny-by-default, every refusal audited. Apps remain zero-egress unless granted.</li>
  <li><strong><code>smallcloud new</code></strong>: scaffold a ready-to-deploy static site, Node server, or persistent-KV guestbook in one command.</li>
  <li>Social cards (OG images) on every page of this site.</li>
  <li>This changelog.</li>
</ul>

<h2>v2 — Enterprise grade &amp; public presence <small>· 2026-08-02</small></h2>
<ul>
  <li>Automatic daily backups (database snapshot + per-app volumes, 7-day retention) with a tested restore path.</li>
  <li>Audit trail of every privileged action; <code>smallcloud audit</code>.</li>
  <li>Login rate limiting, logout, and strict security headers everywhere.</li>
  <li><code>smallcloud doctor</code>: verifies and heals the installation.</li>
  <li>This public site: docs, FAQ, sitemap/JSON-LD, and <a href="/llms.txt">llms.txt</a> for answer engines.</li>
</ul>

<h2>v1 — The platform <small>· 2026-08-01</small></h2>
<ul>
  <li>One-command deploys of static sites and Node.js apps to private HTTPS URLs (~1s).</li>
  <li>Magic-link auth on every route; share-by-link with owner/editor/viewer roles.</li>
  <li>Hardened sandboxes: capabilities dropped, read-only rootfs, resource caps, zero egress.</li>
  <li>Per-app persistent volumes with SQLite + KV; team workspace at <code>sc-home</code>.</li>
  <li>Scale-to-zero with ~400ms wake-on-request; MCP server so AI agents deploy end to end.</li>
</ul>
`,
};
