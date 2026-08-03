export default {
  slug: "docs/sharing-and-roles",
  title: "Sharing apps and roles on Smallcloud",
  description:
    "How Smallcloud authentication and authorization work: magic-link sign-in, share links, owner/editor/viewer roles, revocation, and logout.",
  body: `
<h1>Sharing &amp; roles</h1>
<p class="lede">Every app is private until its owner explicitly shares it — and sharing is always revocable.</p>

<h2>How does sign-in work without passwords?</h2>
<p>Smallcloud uses single-use <strong>magic links</strong>. A visitor enters their email at the sign-in wall; a link is issued — emailed when the operator has configured an email provider (Resend), otherwise printed to the server log / CLI; opening it once sets a 30-day session cookie. Tokens live 15 minutes, work exactly once, and only their hashes are ever stored.</p>

<h2>How do I give someone access to an app?</h2>
<pre><code>smallcloud share notes                  # viewer (read-only) link
smallcloud share notes --role editor    # full-access link</code></pre>
<p>Send the printed link. The recipient signs in first, then opens it — from that point the app URL simply works for them.</p>

<h2>What can each role do?</h2>
<ul>
  <li><strong>Owner</strong> (the deployer): every HTTP method, plus share/unshare/delete via the CLI.</li>
  <li><strong>Editor</strong>: every HTTP method on the app.</li>
  <li><strong>Viewer</strong>: read-only — GET, HEAD, OPTIONS. Writes get a 403.</li>
  <li><strong>No role</strong>: a 403 page suggesting they ask the owner for a link. Signed-in ≠ authorized.</li>
</ul>
<p>Redeeming a newer link upgrades a role in place. Revoke anytime:</p>
<pre><code>smallcloud unshare notes &lt;their-email&gt;</code></pre>

<h2>The workspace directory</h2>
<p>Every team member sees all apps — owner, status, last-used, and their own role — at <code>https://sc-home.&lt;your-domain&gt;</code>. Apps they can open are links; the rest say "no access".</p>

<h2>Signing out</h2>
<p><code>/_sc/logout</code> on any app host kills the session server-side and clears the cookie. Sign-ins, share redemptions, revocations, and logouts all land in the <a href="/docs/security-model.html">audit trail</a>.</p>
`,
};
