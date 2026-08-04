#!/usr/bin/env node
/**
 * Static site builder for smallcloud.osita.ai — deliberately tiny and
 * deterministic: content modules in site/content/ → HTML in site/dist/.
 * Run: node scripts/build-site.mjs
 */
import { copyFileSync, existsSync, mkdirSync, readdirSync, rmSync, writeFileSync } from "node:fs";
import { join } from "node:path";

const REPO = new URL("..", import.meta.url).pathname;
const CONTENT = join(REPO, "site/content");
const DIST = join(REPO, "site/dist");
export const SITE_ORIGIN = "https://onsmallcloud.com";

const CSS = `
:root { --ink: #16181d; --muted: #5a6270; --accent: #0b6bcb; --bg: #ffffff; --card: #f5f7fa; }
* { box-sizing: border-box; }
body { margin: 0; font: 16px/1.6 system-ui, -apple-system, sans-serif; color: var(--ink); background: var(--bg); }
header { border-bottom: 1px solid #e7eaee; }
header nav { max-width: 64rem; margin: 0 auto; padding: .9rem 1.25rem; display: flex; gap: 1.25rem; align-items: baseline; }
header a { color: var(--ink); text-decoration: none; }
header .brand { font-weight: 700; }
header a:hover { color: var(--accent); }
main { max-width: 64rem; margin: 0 auto; padding: 1.5rem 1.25rem 4rem; }
h1 { font-size: 2.2rem; line-height: 1.2; margin: 1.5rem 0 .5rem; }
h2 { margin-top: 2.5rem; }
.lede { font-size: 1.15rem; color: var(--muted); max-width: 44rem; }
pre { background: #101418; color: #e8edf2; padding: 1rem 1.25rem; border-radius: 8px; overflow-x: auto; }
code { font-family: ui-monospace, monospace; font-size: .95em; }
p code, li code { background: var(--card); padding: .1em .35em; border-radius: 4px; }
.grid { display: grid; grid-template-columns: repeat(auto-fit, minmax(17rem, 1fr)); gap: 1rem; }
.card { background: var(--card); border-radius: 10px; padding: 1rem 1.25rem; }
.card h3 { margin: .25rem 0 .5rem; }
.card p { margin: 0; color: var(--muted); }
a { color: var(--accent); }
footer { border-top: 1px solid #e7eaee; color: var(--muted); }
footer div { max-width: 64rem; margin: 0 auto; padding: 1.25rem; font-size: .9rem; }
`;

function layout(page) {
  const path = pagePath(page);
  const url = `${SITE_ORIGIN}${path}`;
  const jsonLd = page.jsonLd
    ? `\n<script type="application/ld+json">${JSON.stringify(page.jsonLd)}</script>`
    : "";
  return `<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>${page.title}</title>
<meta name="description" content="${page.description}">
<link rel="canonical" href="${url}">
<meta property="og:type" content="${page.slug === "index" ? "website" : "article"}">
<meta property="og:title" content="${page.title}">
<meta property="og:description" content="${page.description}">
<meta property="og:url" content="${url}">
<meta property="og:site_name" content="Smallcloud">
<meta property="og:image" content="${SITE_ORIGIN}/og.png">
<meta property="og:image:width" content="1200">
<meta property="og:image:height" content="630">
<meta name="twitter:card" content="summary_large_image">
<meta name="twitter:image" content="${SITE_ORIGIN}/og.png">${jsonLd}
<style>${CSS}</style>
</head>
<body>
<header><nav>
  <a class="brand" href="/">Smallcloud</a>
  <a href="/docs/quickstart.html">Docs</a>
  <a href="/faq.html">FAQ</a>
  <a href="/changelog.html">Changelog</a>
  <a href="https://github.com/rvasqz86/smallcloud">Source</a>
</nav></header>
<main>
${page.body.trim()}
</main>
<footer><div>Smallcloud — self-hosted cloud for small software. Private by default · sandboxed · agent-native.</div></footer>
</body>
</html>
`;
}

function pagePath(page) {
  return page.slug === "index" ? "/" : `/${page.slug}.html`;
}

/** Cross-links between guides, appended to every docs page. */
function moreGuides(page, pages) {
  const docs = pages.filter((p) => p.slug.startsWith("docs/") && p.slug !== page.slug);
  if (!page.slug.startsWith("docs/") || docs.length === 0) return "";
  const items = docs
    .map((p) => `<li><a href="${pagePath(p)}">${p.title.split("—")[0].trim()}</a></li>`)
    .join("\n");
  return `\n<section><h2>More guides</h2><ul>\n${items}\n</ul></section>`;
}

/** Every internal href must resolve to a page we just built (or a generated asset). */
function checkLinks(pages) {
  const known = new Set([
    ...pages.map(pagePath),
    "/llms.txt",
    "/llms-full.txt",
    "/sitemap.xml",
    "/robots.txt",
    "/og.png",
  ]);
  for (const page of pages) {
    for (const match of page.body.matchAll(/href="(\/[^"]*)"/g)) {
      if (!known.has(match[1])) {
        throw new Error(`Broken internal link in ${page.slug}: ${match[1]}`);
      }
    }
  }
}

export async function buildSite() {
  rmSync(DIST, { recursive: true, force: true });
  mkdirSync(DIST, { recursive: true });

  const pages = [];
  for (const entry of readdirSync(CONTENT, { recursive: true }).sort()) {
    const name = String(entry);
    if (!name.endsWith(".mjs")) continue;
    const { default: page } = await import(join(CONTENT, name));
    pages.push(page);
  }
  checkLinks(pages);

  for (const page of pages) {
    const outPath =
      page.slug === "index" ? join(DIST, "index.html") : join(DIST, `${page.slug}.html`);
    mkdirSync(join(outPath, ".."), { recursive: true });
    writeFileSync(outPath, layout({ ...page, body: page.body + moreGuides(page, pages) }));
  }

  // Social card (regenerate with scripts/make-og.mjs when the design changes)
  const ogSource = join(REPO, "site/assets/og.png");
  if (existsSync(ogSource)) copyFileSync(ogSource, join(DIST, "og.png"));

  // SEO furniture: sitemap, robots, and a branded 404 (served via handle_errors)
  const sitemap = `<?xml version="1.0" encoding="UTF-8"?>
<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">
${pages.map((p) => `  <url><loc>${SITE_ORIGIN}${pagePath(p)}</loc></url>`).join("\n")}
</urlset>
`;
  writeFileSync(join(DIST, "sitemap.xml"), sitemap);
  writeFileSync(
    join(DIST, "robots.txt"),
    `User-agent: *\nAllow: /\n\nSitemap: ${SITE_ORIGIN}/sitemap.xml\n`,
  );
  writeFileSync(
    join(DIST, "404.html"),
    layout({
      slug: "404",
      title: "Page not found — Smallcloud",
      description: "That page does not exist on onsmallcloud.com.",
      body: `<h1>404 — no such page</h1><p>Try the <a href="/">homepage</a> or the <a href="/docs/quickstart.html">quickstart</a>.</p>`,
    }),
  );

  // AEO: llms.txt (concise, llmstxt.org shape) + llms-full.txt (docs corpus)
  const stripTags = (html) =>
    html
      .replace(/<pre><code>([\s\S]*?)<\/code><\/pre>/g, (_, code) => `\n${code}\n`)
      .replace(/<[^>]+>/g, "")
      .replace(/&lt;/g, "<")
      .replace(/&gt;/g, ">")
      .replace(/&amp;/g, "&")
      .replace(/\n{3,}/g, "\n\n")
      .trim();

  const docsPages = pages.filter((p) => p.slug !== "index");
  writeFileSync(
    join(DIST, "llms.txt"),
    `# Smallcloud

> Self-hosted platform that deploys static sites and Node.js apps to private, sandboxed, magic-link-protected HTTPS URLs in about a second. Agent-native (MCP), scale-to-zero, persistent per-app storage, share-by-link with roles. Free, runs on your own Linux server.

Key facts: deploys in ~1–3s; cold starts ~400ms; apps have zero network egress, hard CPU/memory caps, and private quota'd /data volumes; no unauthenticated app URLs ever; AI agents deploy via a bundled MCP server (deploy/list/logs/delete tools).

## Docs

${docsPages.map((p) => `- [${p.title}](${SITE_ORIGIN}${pagePath(p)}): ${p.description}`).join("\n")}

## Full content

- [llms-full.txt](${SITE_ORIGIN}/llms-full.txt): every page of this site as plain text
`,
  );
  writeFileSync(
    join(DIST, "llms-full.txt"),
    pages
      .map((p) => `# ${p.title}\n\n${p.description}\n\n${stripTags(p.body)}`)
      .join("\n\n---\n\n") + "\n",
  );

  return pages.map((p) => p.slug);
}

if (process.argv[1] && import.meta.url === `file://${process.argv[1]}`) {
  const slugs = await buildSite();
  console.log(`built ${slugs.length} page(s): ${slugs.join(", ")}`);
}
