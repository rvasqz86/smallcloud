export default {
  slug: "docs/quickstart",
  title: "Quickstart — deploy your first app on Smallcloud",
  description:
    "Install Smallcloud on your own Linux server and deploy a static site or Node.js app to a private HTTPS URL in under five minutes.",
  jsonLd: {
    "@context": "https://schema.org",
    "@type": "HowTo",
    name: "Deploy your first app on Smallcloud",
    description:
      "Install Smallcloud on a Linux server and deploy a static site or Node.js app to a private HTTPS URL.",
    step: [
      { "@type": "HowToStep", name: "Install", text: "Run npm install -g @rvasqz86/smallcloud on your server to get the smallcloud CLI." },
      { "@type": "HowToStep", name: "Configure", text: "Set your email and base domain in ~/.smallcloud/config.json." },
      { "@type": "HowToStep", name: "Deploy", text: "Run smallcloud deploy in any app directory. The first deploy boots Smallcloud's services automatically." },
      { "@type": "HowToStep", name: "Sign in", text: "Open the printed single-use sign-in link. Your app is live, private, and shareable." },
    ],
  },
  body: `
<h1>Quickstart</h1>
<p class="lede">From zero to a private, shareable app URL in about five minutes.</p>

<h2>What do I need before installing Smallcloud?</h2>
<ul>
  <li>A Linux server with <strong>Docker</strong> installed.</li>
  <li><a href="https://github.com/lucaslorentz/caddy-docker-proxy">caddy-docker-proxy</a> as the reverse proxy, discovering routes from container labels (Coolify installs ship this by default).</li>
  <li><strong>Wildcard DNS</strong> for a domain pointed at the server (e.g. <code>*.example.com</code> via Cloudflare).</li>
  <li><strong>Node.js 22</strong> and <strong>pnpm</strong> (<code>corepack enable pnpm</code>).</li>
</ul>

<h2>Install</h2>
<p>One command on your server:</p>
<pre><code>npm install -g @rvasqz86/smallcloud</code></pre>
<p>That installs the <code>smallcloud</code> CLI (and <code>smallcloud-mcp</code> for AI agents). This step sets up the <em>Smallcloud platform</em> on your server, once. Your own apps live anywhere else — you'll point <code>smallcloud deploy</code> at them in a moment.</p>
<p><strong>Permission error (EACCES)?</strong> You're installing into a root-owned system Node. Don't reach for sudo — use a user-owned Node 22 via <a href="https://github.com/nvm-sh/nvm">nvm</a> (<code>nvm install 22</code>), which also satisfies Smallcloud's Node&nbsp;22 requirement. System Node 20 fails at runtime even with sudo.</p>
<p>Set your domain once in <code>~/.smallcloud/config.json</code>:</p>
<pre><code>{ "email": "&lt;your-email&gt;", "baseDomain": "example.com" }</code></pre>

<h2>Deploy your first app</h2>
<pre><code>smallcloud new hello --template kv   # or: static, node
cd hello
smallcloud deploy --email &lt;your-email&gt;</code></pre>
<p>The first deploy boots Smallcloud's own services automatically. You get back two lines: the app's <strong>URL</strong> (private — visitors hit a sign-in wall) and a single-use <strong>sign-in link</strong>. Click the link, get a 30-day session, see your app.</p>

<h2>Check on it</h2>
<pre><code>smallcloud list          # every app, status, URL
smallcloud logs hello    # recent output
smallcloud doctor        # verify + heal the installation</code></pre>

<h2>Where to next?</h2>
<p>Deploy something real with the <a href="/docs/deploy-node-app.html">Node.js app guide</a>, give a teammate access with <a href="/docs/sharing-and-roles.html">sharing &amp; roles</a>, or let your AI agent do all of this via <a href="/docs/agents-mcp.html">MCP</a>.</p>
`,
};
