export default {
  slug: "docs/agents-mcp",
  title: "AI agents on Smallcloud — MCP server for Claude Code",
  description:
    "Smallcloud ships an MCP server exposing deploy, list, logs, and delete as tools, so Claude Code and other AI agents can ship apps end to end.",
  body: `
<h1>AI agents &amp; MCP</h1>
<p class="lede">Smallcloud treats agents as first-class deployers. The bundled MCP server exposes the full app lifecycle as tools over stdio.</p>

<h2>How do I connect Claude Code to Smallcloud?</h2>
<p>Sessions started in the Smallcloud repo pick it up automatically from <code>.mcp.json</code>. For any other project, add:</p>
<pre><code>{
  "mcpServers": {
    "smallcloud": {
      "command": "node",
      "args": ["/path/to/smallcloud/packages/mcp-server/dist/index.js"]
    }
  }
}</code></pre>

<h2>What tools does the agent get?</h2>
<ul>
  <li><strong>deploy</strong>(sourceDir, appName, ownerEmail?) → the public URL plus a single-use sign-in link.</li>
  <li><strong>list</strong>() → every app with status and URL.</li>
  <li><strong>logs</strong>(appName, tail?) → recent app output.</li>
  <li><strong>delete</strong>(appName) → stops the app, removes its URL and data.</li>
</ul>

<h2>What does the flow look like in practice?</h2>
<p>You say: <em>"build a link-shortener and put it on smallcloud."</em> The agent writes the app, calls <code>deploy</code>, reads <code>logs</code> if something is off, fixes and redeploys, then hands you the URL and sign-in link. The app comes up inside the same sandbox as any human deploy: private, no egress, resource-capped.</p>

<h2>Why is this safer than giving an agent a cloud account?</h2>
<p>The blast radius is structural. The MCP tools can only deploy/list/log/delete sandboxed apps on your box — there is no billing to run up, no IAM to misconfigure, no public bucket to leak. Every action lands in the <a href="/docs/security-model.html">audit trail</a> with its actor.</p>
`,
};
