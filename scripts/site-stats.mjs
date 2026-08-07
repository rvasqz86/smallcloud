#!/usr/bin/env node
/**
 * site-stats: first-party analytics report for the public site (sc-www).
 * Reads the Caddy JSON access logs from the sc-www-logs volume and prints an
 * aggregate report. No client-side JS, no third parties; raw logs stay on the
 * box and only aggregates are displayed.
 *
 *   node scripts/site-stats.mjs [--days 30] [--json]
 */
import { execFileSync } from "node:child_process";

const BOT_RE =
  /bot|crawl|spider|slurp|preview|headless|python-requests|curl|wget|gptbot|claude|anthropic|openai|perplexity|bytespider|undici|^node$|go-http-client|okhttp|libwww|java\/|^ruby|axios|node-fetch|postman|insomnia|scrapy|httpclient|winhttp/i;

const header = (req, name) => {
  const headers = req?.headers ?? {};
  for (const key of Object.keys(headers)) {
    if (key.toLowerCase() === name) return headers[key]?.[0];
  }
  return undefined;
};

const isPage = (uri) => {
  const path = uri.split("?")[0];
  return path === "/" || path.endsWith(".html") || path.endsWith(".txt") || path.endsWith(".xml");
};

/** Aggregate parsed Caddy JSON access-log lines into a report object. */
export function aggregate(lines, { days = 30, now = Date.now() } = {}) {
  const cutoff = now / 1000 - days * 86400;
  const byDay = new Map();
  const pages = new Map();
  const referrers = new Map();
  const countries = new Map();
  const crawlers = new Map();
  const bump = (map, key, n = 1) => map.set(key, (map.get(key) ?? 0) + n);

  let pageViews = 0;
  for (const line of lines) {
    let entry;
    try {
      entry = JSON.parse(line);
    } catch {
      continue;
    }
    if (entry.msg !== "handled request" || entry.ts < cutoff) continue;
    const req = entry.request ?? {};
    const uri = req.uri ?? "";
    if (req.method !== "GET" || entry.status >= 400 || !isPage(uri)) continue;

    const ua = header(req, "user-agent") ?? "";
    if (BOT_RE.test(ua)) {
      const family = ua.match(BOT_RE)?.[0].toLowerCase() ?? "bot";
      bump(crawlers, family);
      continue;
    }

    pageViews += 1;
    const day = new Date(entry.ts * 1000).toISOString().slice(0, 10);
    const visitor = header(req, "cf-connecting-ip") ?? req.client_ip ?? req.remote_ip ?? "?";
    if (!byDay.has(day)) byDay.set(day, { views: 0, visitors: new Set() });
    byDay.get(day).views += 1;
    byDay.get(day).visitors.add(visitor);
    bump(pages, uri.split("?")[0]);
    bump(countries, header(req, "cf-ipcountry") ?? "??");
    const ref = header(req, "referer");
    if (ref && !ref.includes("onsmallcloud.com")) {
      try {
        bump(referrers, new URL(ref).hostname);
      } catch {
        bump(referrers, ref.slice(0, 60));
      }
    }
  }

  const top = (map, n = 10) => [...map.entries()].sort((a, b) => b[1] - a[1]).slice(0, n);
  return {
    days,
    pageViews,
    uniqueVisitors: new Set([...byDay.values()].flatMap((d) => [...d.visitors])).size,
    byDay: [...byDay.entries()]
      .sort()
      .map(([day, d]) => ({ day, views: d.views, visitors: d.visitors.size })),
    topPages: top(pages),
    topReferrers: top(referrers),
    topCountries: top(countries),
    crawlers: top(crawlers),
  };
}

function main() {
  const args = process.argv.slice(2);
  const days = Number(args[args.indexOf("--days") + 1]) || 30;
  const raw = execFileSync(
    "docker",
    ["run", "--rm", "-v", "sc-www-logs:/data:ro", "alpine:3", "sh", "-c", "cat /data/access.log* 2>/dev/null"],
    { encoding: "utf8", maxBuffer: 256 * 1024 * 1024 },
  );
  const report = aggregate(raw.split("\n").filter(Boolean), { days });

  if (args.includes("--json")) {
    console.log(JSON.stringify(report, null, 2));
    return;
  }
  console.log(`Site analytics — last ${report.days} days (humans only)\n`);
  console.log(`  Page views       ${report.pageViews}`);
  console.log(`  Unique visitors  ${report.uniqueVisitors}\n`);
  const table = (title, rows, fmt = (k) => k) => {
    if (rows.length === 0) return;
    console.log(title);
    for (const [key, count] of rows) console.log(`  ${String(count).padStart(6)}  ${fmt(key)}`);
    console.log("");
  };
  table(
    "By day",
    report.byDay.map((d) => [`${d.day}  (${d.visitors} visitors)`, d.views]),
  );
  table("Top pages", report.topPages);
  table("Referrers", report.topReferrers);
  table("Countries", report.topCountries);
  table("Crawlers (excluded above)", report.crawlers);
}

if (process.argv[1] && import.meta.url.endsWith("site-stats.mjs") && process.argv[1].endsWith("site-stats.mjs")) {
  main();
}
