# Smallcloud — cloud for small software

Deploy a static site or a small Node web app from your terminal to a **private, HTTPS, magic-link-protected URL** in about a second — on hardware you already own:

<img src="https://onsmallcloud.com/demo.svg" width="700" alt="Terminal recording: smallcloud deploy, share, and scale-to-zero wake in about 20 seconds">

```
$ smallcloud deploy
✓ Deployed my-app in 0.9s
  URL      https://sc-my-app.osita.ai
  Sign in  https://sc-my-app.osita.ai/_sc/auth?token=…
```

Every app is sandboxed, private by default, shareable by link, persistent, and scales to zero when idle. Agents are first-class citizens: Claude Code can deploy, inspect, and delete apps through the bundled MCP server. Free and MIT-licensed forever — [Pro](https://onsmallcloud.com/pricing.html) is optional, for offsite backups and priority support.

## Security model (the short version)

- **No unauthenticated app URLs, ever.** An auth proxy fronts every route; visitors sign in with a single-use emailed-style magic link (v0: the link is printed to the CLI / server log).
- **Every app is sandboxed:** all Linux capabilities dropped, no privilege escalation, read-only rootfs, hard CPU/memory/pid caps, **zero network egress** (internal-only network).
- **Per-app authorization:** owners and editors get full access, viewers get read-only, everyone else gets a 403 until the owner shares a link.
- **Structural data isolation:** each app's only persistent storage is its own private volume.

## Prerequisites

Smallcloud v0 runs on a single self-hosted Linux box that already has:

- **Docker** (20+; tested on 28)
- **[caddy-docker-proxy](https://github.com/lucaslorentz/caddy-docker-proxy)** as the reverse proxy, discovering routes from container labels (Coolify installs ship this as `coolify-proxy`)
- **Wildcard DNS** for your base domain pointing at the box (e.g. `*.osita.ai` proxied through Cloudflare)
- **Node.js 22** and **pnpm** (`corepack enable pnpm`)

## Install

```bash
npm install -g @onsmallcloud/smallcloud
```

That's it — you get the `smallcloud` CLI and the `smallcloud-mcp` server. (Building from source instead: clone the repo, `pnpm install && pnpm build`, and alias `packages/cli/dist/index.js`.)

No domain? `smallcloud domain claim yourname` gets you a free `yourname.onsmallcloud.com` pointed at this server, config included. Bringing your own, set it once in `~/.smallcloud/config.json`:

```json
{
  "email": "you@example.com",
  "baseDomain": "your-domain.com",
  "resendApiKey": "re_xxx (optional — emails magic links via resend.com)",
  "mailFrom": "Smallcloud <signin@your-domain.com>"
}
```

## Deploy your first app

```bash
mkdir hello && cd hello
echo '<h1>hello, smallcloud</h1>' > index.html
smallcloud deploy --email you@example.com   # email needed once; remembered after
```

The first deploy also boots Smallcloud's own services (auth proxy + scale-to-zero waker) as containers. You get two lines back: the **URL** (private) and a **sign-in link** (single-use — click it, get a 30-day session cookie, see your app). Node apps work the same way: any directory with a `package.json` that has a `start` script or a `main` entry deploys as a Node 22 container; `index.html` alone deploys as a static site.

## Share an app

```bash
smallcloud share hello                    # read-only (viewer) link
smallcloud share hello --role editor      # full-access link
smallcloud unshare hello friend@example.com
```

Recipients sign in once (magic link), then open your share link — after that the app URL just works for them, with viewer/editor enforcement on every request. Your whole team can see the app directory at **`https://sc-home.<your-domain>`** — owner, status, last-used, and their own role for every app.

## CLI reference

| Command | What it does |
|---|---|
| `smallcloud domain claim <name>` | Free `<name>.onsmallcloud.com` pointed at this server, config written |
| `smallcloud domain update-ip` | Re-point your claimed subdomain after an IP change |
| `smallcloud deploy [dir] [--name x] [--email e]` | Build, sandbox, and serve an app at `https://sc-<name>.<domain>` |
| `smallcloud list` | All apps with status and URL |
| `smallcloud status <app>` | Latest deployment of one app |
| `smallcloud logs <app> [--tail N]` | Recent app output |
| `smallcloud share <app> [--role viewer\|editor]` | Print a share link |
| `smallcloud unshare <app> <email>` | Revoke someone's access |
| `smallcloud delete <app>` | Stop the app, drop its URL and its data |

## Claude Code / agents (MCP)

The repo ships an MCP server with `deploy`, `list`, `logs`, and `delete` tools. A `.mcp.json` at the repo root wires it up automatically for Claude Code sessions started in this directory; for other projects:

```json
{ "mcpServers": { "smallcloud": { "command": "node", "args": ["/path/to/smallcloud/packages/mcp-server/dist/index.js"] } } }
```

Then ask your agent to "deploy this directory with smallcloud" — it gets back the URL and sign-in link.

## Persistence

Every app has a private volume mounted at `/data` (`$DATA_DIR`), surviving redeploys — put a SQLite file there, or use the bundled KV:

```js
// vendor packages/app-kit/dist/index.js into your app as kv.js
import { openKV } from "./kv.js";
const kv = openKV();                      // or openKV({ namespace: "sessions" })
kv.put("greeting", "hi");
kv.get("greeting");                       // "hi"
kv.putJSON("cfg", { theme: "dark" });
kv.list("user:");                         // prefix scan
```

## Scale-to-zero

Apps idle for 15 minutes are stopped automatically. The next request wakes them transparently — measured cold start is **~400 ms** (budget: 2 s). Nothing to configure.

## Limits (per app)

| Resource | Default |
|---|---|
| CPU | 0.5 cores |
| Memory | 256 MiB (no swap) |
| Scratch disk (`/tmp`) | 64 MiB, noexec |
| Persistent data (`/data`) | 256 MiB (deploys refuse past quota) |
| Processes | 256 |
| Network egress | none (default-deny) |

## Troubleshooting

- **`EACCES` on install?** — you are on a root-owned system Node. Use a user-owned Node 22 via nvm (`nvm install 22`) instead of sudo; Node ≥22 is required at runtime anyway.
- **"Where's my magic link?"** — printed by whatever issued it: your `deploy` output, or `docker logs sc-auth-proxy` for links requested via an app's `/_sc/login` form.
- **403 "You don't have access"** — you're signed in but have no role on that app; ask the owner for a share link.
- **App misbehaving?** — `smallcloud logs <app>`; remember the sandbox: no egress, writable paths are only `/tmp` and `/data`.
- **Something systemic?** — `docker ps --filter name=sc-` should show `sc-auth-proxy` and `sc-waker` plus one `sc-app-*`/`sc-route-*` pair per app. Any deploy re-creates missing pieces.

## Development

```bash
pnpm test    # unit + integration suite (uses local docker)
pnpm smoke   # full end-to-end against the live environment, incl. wake test
```

Architecture and every significant decision live in [`DECISIONS.md`](DECISIONS.md), [`INFRA.md`](INFRA.md), and [`CHARTER.md`](CHARTER.md).

## License

[MIT](LICENSE)
