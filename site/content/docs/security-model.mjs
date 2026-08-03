export default {
  slug: "docs/security-model",
  title: "The Smallcloud security model",
  description:
    "How Smallcloud isolates apps and protects access: magic-link auth on every route, capability-dropped containers, zero egress, per-app roles, audit trail, backups.",
  body: `
<h1>Security model</h1>
<p class="lede">Smallcloud's core bet: small software becomes safe to ship constantly when the platform makes the safe path the only path.</p>

<h2>No unauthenticated app URLs</h2>
<p>An auth proxy fronts every app route. No session → sign-in wall; valid session but no role → 403. Magic-link tokens and session tokens are random 256-bit values, single-use where applicable, stored only as SHA-256 hashes, delivered over HTTPS with <code>HttpOnly; Secure; SameSite=Lax</code> cookies. Auth endpoints are rate-limited per client IP.</p>

<h2>Every app is sandboxed</h2>
<ul>
  <li>All Linux capabilities dropped; privilege escalation disabled (<code>no-new-privileges</code>).</li>
  <li>Read-only root filesystem; writes only to a 64 MiB noexec <code>/tmp</code> and the quota'd <code>/data</code> volume.</li>
  <li><strong>Zero network egress by default</strong>: apps run on an internal network with no route out — no DNS, no IP. Build-time installs are the only unrestricted network moment. Owners can grant an explicit per-app hostname allowlist, served through an authenticated forward proxy that refuses (and audits) everything else — deny-by-default even when egress is on.</li>
  <li>Hard caps: 0.5 CPU, 256 MiB memory (no swap), 256 processes.</li>
  <li>Non-root users inside every container, including Smallcloud's own services.</li>
</ul>

<h2>Isolation between apps</h2>
<p>Apps can't read each other's data (separate volumes), and per-app roles are enforced on every request: owners and editors get all methods, viewers get read-only, everyone else gets nothing.</p>

<h2>Platform hygiene</h2>
<ul>
  <li><strong>Audit trail</strong>: deploys, deletes, shares, sign-ins, and logouts recorded with actor and subject (<code>smallcloud audit</code>).</li>
  <li><strong>Security headers</strong>: HSTS on every response; strict CSP, frame denial, and nosniff on all Smallcloud pages.</li>
  <li><strong>Backups</strong>: nightly database snapshot + per-app volume archives, 7-day retention, tested restore path.</li>
  <li><strong>Self-verification</strong>: <code>smallcloud doctor</code> checks and heals the installation.</li>
</ul>

<h2>What about this website?</h2>
<p>This site is the one deliberately public surface — static marketing and docs with no user data, running in the same hardened container regime as everything else. Deployed <em>apps</em> are never public.</p>
`,
};
