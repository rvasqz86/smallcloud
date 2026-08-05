import { describe, expect, it } from "vitest";
import { aggregate } from "../../../../scripts/site-stats.mjs";

const NOW = 1_800_000_000_000; // fixed clock for determinism
const ts = NOW / 1000 - 3600;

function line(over: Record<string, unknown> = {}, headers: Record<string, string[]> = {}) {
  return JSON.stringify({
    msg: "handled request",
    ts,
    status: 200,
    request: {
      method: "GET",
      uri: "/",
      client_ip: "10.0.0.1",
      headers: {
        "User-Agent": ["Mozilla/5.0"],
        "Cf-Connecting-Ip": ["203.0.113.7"],
        "Cf-Ipcountry": ["US"],
        ...headers,
      },
    },
    ...over,
  });
}

describe("site-stats aggregate", () => {
  it("counts page views and unique visitors from CF headers", () => {
    const report = aggregate(
      [
        line(),
        line({}, { "Cf-Connecting-Ip": ["203.0.113.7"] }),
        line({}, { "Cf-Connecting-Ip": ["198.51.100.2"], "Cf-Ipcountry": ["DE"] }),
      ],
      { now: NOW },
    );
    expect(report.pageViews).toBe(3);
    expect(report.uniqueVisitors).toBe(2);
    expect(Object.fromEntries(report.topCountries)).toEqual({ US: 2, DE: 1 });
  });

  it("excludes bots into a crawlers bucket and skips assets/errors/POSTs", () => {
    const report = aggregate(
      [
        line({}, { "User-Agent": ["GPTBot/1.0"] }),
        line({ request: { method: "GET", uri: "/og.png", headers: {} } }),
        line({ status: 404 }),
        line({ request: { method: "POST", uri: "/", headers: {} } }),
        line(),
      ],
      { now: NOW },
    );
    expect(report.pageViews).toBe(1);
    expect(report.crawlers).toEqual([["gptbot", 1]]);
  });

  it("aggregates external referrers by hostname and ignores self-referrals", () => {
    const report = aggregate(
      [
        line({}, { Referer: ["https://news.ycombinator.com/item?id=1"] }),
        line({}, { Referer: ["https://onsmallcloud.com/docs/quickstart.html"] }),
      ],
      { now: NOW },
    );
    expect(report.topReferrers).toEqual([["news.ycombinator.com", 1]]);
  });

  it("drops lines older than the window and unparseable lines", () => {
    const report = aggregate(["not json", line({ ts: ts - 40 * 86400 }), line()], {
      now: NOW,
      days: 30,
    });
    expect(report.pageViews).toBe(1);
  });
});
