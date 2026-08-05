export default {
  slug: "index",
  title: "Smallcloud — deploy small software to your own cloud in seconds",
  description:
    "Smallcloud is a self-hosted platform that deploys static sites and Node.js apps to private, HTTPS, magic-link-protected URLs in about a second. Sandboxed, agent-native, scale-to-zero.",
  jsonLd: {
    "@context": "https://schema.org",
    "@type": "SoftwareApplication",
    name: "Smallcloud",
    applicationCategory: "DeveloperApplication",
    operatingSystem: "Linux",
    description:
      "Self-hosted platform that deploys static sites and Node.js apps to private, sandboxed, HTTPS URLs in about a second. Agent-native via MCP, scale-to-zero, persistent storage, share-by-link.",
    url: "https://onsmallcloud.com",
    offers: { "@type": "Offer", price: "0", priceCurrency: "USD" },
  },
  body: `
<section class="hero">
  <h1>Your own cloud, for small software</h1>
  <p class="lede">Deploy a static site or Node.js app from your terminal to a <strong>private HTTPS URL</strong> in about a second — on hardware you already own. No YAML, no build pipelines, no public-by-accident.</p>
  <img src="/demo.svg" width="860" height="494" alt="Terminal recording: smallcloud deploy, share, and scale-to-zero wake in about 20 seconds" style="max-width:100%;border-radius:8px;">
  <pre><code>$ smallcloud deploy
✓ Deployed my-app in 0.9s
  URL      https://sc-my-app.example.com
  Sign in  https://sc-my-app.example.com/_sc/auth?token=…</code></pre>
</section>

<section>
  <h2>What makes Smallcloud different?</h2>
  <div class="grid">
    <div class="card"><h3>Private by default</h3><p>Every app sits behind a magic-link auth wall. There are no unauthenticated app URLs — sharing is an explicit, revocable act with viewer and editor roles.</p></div>
    <div class="card"><h3>Sandboxed for real</h3><p>All Linux capabilities dropped, read-only rootfs, hard CPU/memory caps, and <em>zero network egress</em>. A misbehaving app can't reach the internet or your host.</p></div>
    <div class="card"><h3>Agent-native</h3><p>A bundled MCP server gives Claude Code and other AI agents deploy, list, logs, and delete as first-class tools. Your agent ships an app and hands you the sign-in link.</p></div>
    <div class="card"><h3>Scale-to-zero</h3><p>Idle apps stop automatically and wake on the next request in under half a second. A hundred experiments cost nothing while nobody looks at them.</p></div>
    <div class="card"><h3>Data that persists</h3><p>Each app owns a private volume with SQLite and a built-in key-value store. Redeploys keep data; deletes remove it; nightly backups cover all of it.</p></div>
    <div class="card"><h3>Operable</h3><p>Audit trail, login rate limiting, security headers, automated backups with tested restore, and a <code>doctor</code> command that heals the installation.</p></div>
  </div>
</section>

<section>
  <h2>How do I deploy an app with Smallcloud?</h2>
  <ol>
    <li>On a Linux box running Docker and a caddy-docker-proxy ingress: <code>npm install -g @onsmallcloud/smallcloud</code></li>
    <li>Run <code>smallcloud new my-app</code> to scaffold, or use any existing app directory of yours.</li>
    <li>Run <code>smallcloud deploy --email &lt;your-email&gt;</code> in that directory.</li>
    <li>Open the printed sign-in link — your app is live, private, and shareable.</li>
  </ol>
  <p>The full walkthrough lives in the <a href="/docs/quickstart.html">quickstart guide</a>.</p>
</section>

<section>
  <h2>Who is Smallcloud for?</h2>
  <p>Builders and small teams who want the deploy-in-seconds feel of a modern PaaS with the privacy, cost, and control of self-hosting — and who increasingly let AI agents write and ship the software itself.</p>
</section>
`,
};
