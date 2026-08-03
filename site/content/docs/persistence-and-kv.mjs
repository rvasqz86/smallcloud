export default {
  slug: "docs/persistence-and-kv",
  title: "Persistence and the KV store on Smallcloud",
  description:
    "Every Smallcloud app gets a private persistent volume with SQLite support and a built-in key-value store. How /data works, quotas, backups, and the KV API.",
  body: `
<h1>Persistence &amp; KV</h1>
<p class="lede">Each app owns a private volume at <code>$DATA_DIR</code> (<code>/data</code>). It survives redeploys, is quota'd, backed up nightly, and removed when the app is deleted.</p>

<h2>Where should my app store data?</h2>
<p>Anywhere under <code>/data</code> — a plain SQLite file works great with Node 22's built-in <code>node:sqlite</code>:</p>
<pre><code>const { DatabaseSync } = require("node:sqlite");
const db = new DatabaseSync(process.env.DATA_DIR + "/app.sqlite");</code></pre>

<h2>The built-in key-value store</h2>
<p>Vendor <code>packages/app-kit/dist/index.js</code> into your app as <code>kv.js</code>:</p>
<pre><code>import { openKV } from "./kv.js";
const kv = openKV();                        // or { namespace: "sessions" }
kv.put("greeting", "hi");
kv.get("greeting");                          // "hi"
kv.putJSON("cfg", { theme: "dark" });
kv.getJSON("cfg");                           // { theme: "dark" }
kv.list("user:");                            // prefix scan, sorted
kv.delete("greeting");</code></pre>
<p>It's SQLite underneath (<code>/data/kv.sqlite</code>) — no server, no credentials, isolated per app because volumes are isolated per app.</p>

<h2>What are the limits?</h2>
<ul>
  <li><strong>256 MiB per app</strong> by default. A deploy over quota is refused with a clear error, and a background watchdog stops apps that blow past it at runtime.</li>
  <li>Data is <strong>deleted with the app</strong> (<code>smallcloud delete</code>) — deletion means deletion.</li>
</ul>

<h2>Backups</h2>
<p>Smallcloud backs up the control-plane database and every app volume daily, keeping seven days (<code>smallcloud backup</code> runs one on demand). Restore with <code>node scripts/restore.mjs &lt;date&gt; --yes</code>. See the <a href="/docs/security-model.html">security model</a> for the full operational picture.</p>
`,
};
