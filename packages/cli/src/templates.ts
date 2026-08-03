import { copyFileSync, existsSync, mkdirSync, readdirSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { appKitFile } from "@smallcloud/control-plane";

export type TemplateName = "static" | "node" | "kv";
export const TEMPLATE_NAMES: TemplateName[] = ["static", "node", "kv"];

const STATIC_INDEX = (name: string) => `<!doctype html>
<html lang="en">
<head><meta charset="utf-8"><title>${name}</title>
<style>body{font:18px/1.6 system-ui;max-width:40rem;margin:4rem auto;padding:0 1rem}</style>
</head>
<body>
<h1>${name}</h1>
<p>Deployed with Smallcloud. Edit <code>index.html</code> and run <code>smallcloud deploy</code> again.</p>
</body>
</html>
`;

const NODE_SERVER = `const http = require("node:http");

http.createServer((req, res) => {
  if (req.url === "/health") {
    res.end("ok");
    return;
  }
  const user = req.headers["x-smallcloud-user"] ?? "someone";
  res.writeHead(200, { "content-type": "text/plain" });
  res.end("hello " + user + " — edit server.js and redeploy\\n");
}).listen(process.env.PORT || 8080);
`;

const KV_SERVER = `import http from "node:http";
import { openKV } from "./kv.js";

// Guestbook: persistent per-app storage via the Smallcloud KV (SQLite on /data)
const kv = openKV({ namespace: "guestbook" });

http.createServer((req, res) => {
  const url = new URL(req.url ?? "/", "http://local");
  if (url.pathname === "/sign") {
    const name = (url.searchParams.get("name") ?? "anonymous").slice(0, 60);
    kv.put(String(Date.now()), name);
    res.writeHead(302, { location: "/" });
    res.end();
    return;
  }
  const entries = kv.list().map((key) => kv.get(key));
  res.writeHead(200, { "content-type": "text/html; charset=utf-8" });
  res.end(\`<!doctype html><title>guestbook</title>
<h1>Guestbook (\${entries.length})</h1>
<form action="/sign"><input name="name" placeholder="your name"><button>Sign</button></form>
<ul>\${entries.map((e) => \`<li>\${String(e).replace(/[<>&]/g, "")}</li>\`).join("")}</ul>\`);
}).listen(process.env.PORT || 8080);
`;

/** Scaffolds a ready-to-deploy app. The directory must be empty or absent. */
export function scaffoldTemplate(dir: string, template: TemplateName, appName: string): string[] {
  if (existsSync(dir) && readdirSync(dir).length > 0) {
    throw new Error(`${dir} is not empty — refusing to scaffold over existing files`);
  }
  mkdirSync(dir, { recursive: true });

  if (template === "static") {
    writeFileSync(join(dir, "index.html"), STATIC_INDEX(appName));
    return ["index.html"];
  }

  if (template === "node") {
    writeFileSync(join(dir, "package.json"), `${JSON.stringify({ name: appName, main: "server.js" }, null, 2)}\n`);
    writeFileSync(join(dir, "server.js"), NODE_SERVER);
    return ["package.json", "server.js"];
  }

  // kv: node app with the app-kit library vendored in
  writeFileSync(
    join(dir, "package.json"),
    `${JSON.stringify({ name: appName, type: "module", main: "server.js" }, null, 2)}\n`,
  );
  writeFileSync(join(dir, "server.js"), KV_SERVER);
  copyFileSync(appKitFile(), join(dir, "kv.js"));
  return ["package.json", "server.js", "kv.js"];
}
