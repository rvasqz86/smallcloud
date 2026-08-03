export default {
  slug: "docs/deploy-node-app",
  title: "Deploying Node.js apps on Smallcloud",
  description:
    "How Smallcloud detects, builds, and sandboxes Node.js web apps: package.json requirements, the PORT and DATA_DIR environment, and what the sandbox allows.",
  body: `
<h1>Deploying a Node.js app</h1>
<p class="lede">Any directory with a <code>package.json</code> that has a <code>start</code> script (or a <code>main</code> entry) deploys as a Node.js 22 container. No Dockerfile.</p>

<h2>What does a deployable app look like?</h2>
<pre><code>// package.json
{ "name": "notes", "main": "server.js" }

// server.js
const http = require("node:http");
http.createServer((req, res) =&gt; {
  res.end("hello from " + (process.env.SMALLCLOUD_APP ?? "smallcloud"));
}).listen(process.env.PORT || 8080);</code></pre>
<p>Then: <code>smallcloud deploy --name notes</code>. Smallcloud runs <code>npm install --omit=dev</code> at build time (network is available <em>during build only</em>), runs your <code>build</code> script if you have one, and starts the app with your start command.</p>

<h2>The contract your app runs under</h2>
<ul>
  <li><strong>Listen on <code>$PORT</code></strong> (8080). The auth proxy fronts every request; authenticated users arrive with an <code>x-smallcloud-user</code> header.</li>
  <li><strong>Write only to <code>$DATA_DIR</code></strong> (<code>/data</code>, persistent, quota'd) and <code>/tmp</code> (64 MiB scratch). The rest of the filesystem is read-only.</li>
  <li><strong>No network egress at runtime — unless granted.</strong> By default the app cannot call external APIs. Deploy with <code>--allow-egress api.example.com</code> and the app receives <code>HTTP_PROXY</code>/<code>HTTPS_PROXY</code> credentials for a forward proxy that permits exactly those hostnames (use an env-aware proxy agent, e.g. undici's <code>EnvHttpProxyAgent</code>). Everything else is refused and audited.</li>
  <li><strong>Resource caps:</strong> 0.5 CPU, 256 MiB memory, 256 processes.</li>
  <li><strong>Scale-to-zero:</strong> after 15 idle minutes the container stops; the next request restarts it transparently in under half a second. Keep startup fast and state in <code>/data</code>.</li>
</ul>

<h2>How do I debug a misbehaving app?</h2>
<pre><code>smallcloud logs notes --tail 200</code></pre>
<p>Crashes on boot usually mean the app tried to write outside <code>/data</code>, bind a port other than <code>$PORT</code>, or reach the network. The <a href="/docs/security-model.html">security model</a> explains exactly what the sandbox enforces.</p>

<h2>Storing data</h2>
<p>Use SQLite or the built-in key-value store on your app's private volume — see <a href="/docs/persistence-and-kv.html">persistence &amp; KV</a>.</p>
`,
};
