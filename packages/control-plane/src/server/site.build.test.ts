import { execFileSync } from "node:child_process";
import { createHash } from "node:crypto";
import { readFileSync, readdirSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";

const REPO = new URL("../../../..", import.meta.url).pathname;
const DIST = join(REPO, "site/dist");

function build(): string {
  execFileSync("node", [join(REPO, "scripts/build-site.mjs")], { encoding: "utf8" });
  const hash = createHash("sha256");
  for (const file of readdirSync(DIST, { recursive: true }).sort()) {
    const path = join(DIST, String(file));
    try {
      hash.update(String(file)).update(readFileSync(path));
    } catch {
      /* directory */
    }
  }
  return hash.digest("hex");
}

describe("public site build", () => {
  it("produces a deterministic landing page with SEO basics", { timeout: 60_000 }, () => {
    const first = build();
    const index = readFileSync(join(DIST, "index.html"), "utf8");

    expect(index).toContain("<title>Smallcloud — deploy small software");
    expect(index).toContain('meta name="description"');
    expect(index).toContain('rel="canonical" href="https://onsmallcloud.com/"');
    expect(index).toContain('lang="en"');
    expect(index).toContain("Private by default");

    const second = build();
    expect(second).toBe(first);
  });

  it("emits valid SEO furniture: sitemap, robots, 404, JSON-LD, OG", { timeout: 60_000 }, () => {
    build();
    const sitemap = readFileSync(join(DIST, "sitemap.xml"), "utf8");
    expect(sitemap).toContain("<loc>https://onsmallcloud.com/</loc>");
    expect(sitemap).toContain("<loc>https://onsmallcloud.com/docs/quickstart.html</loc>");

    expect(readFileSync(join(DIST, "robots.txt"), "utf8")).toContain("Sitemap: https://onsmallcloud.com/sitemap.xml");
    expect(readFileSync(join(DIST, "404.html"), "utf8")).toContain("404 — no such page");

    const index = readFileSync(join(DIST, "index.html"), "utf8");
    expect(index).toContain('property="og:title"');
    expect(index).toContain('property="og:image" content="https://onsmallcloud.com/og.png"');
    expect(index).toContain('name="twitter:card" content="summary_large_image"');
    const png = readFileSync(join(DIST, "og.png"));
    expect(png.subarray(1, 4).toString()).toBe("PNG");
    const ld = index.match(/<script type="application\/ld\+json">(.*?)<\/script>/s)![1]!;
    expect(JSON.parse(ld)["@type"]).toBe("SoftwareApplication");

    const quickstart = readFileSync(join(DIST, "docs/quickstart.html"), "utf8");
    const howTo = quickstart.match(/<script type="application\/ld\+json">(.*?)<\/script>/s)![1]!;
    expect(JSON.parse(howTo)["@type"]).toBe("HowTo");
  });

  it("emits AEO files and a schema-matched FAQ", { timeout: 60_000 }, () => {
    build();
    const faq = readFileSync(join(DIST, "faq.html"), "utf8");
    const ld = JSON.parse(
      faq.match(/<script type="application\/ld\+json">(.*?)<\/script>/s)![1]!,
    );
    expect(ld["@type"]).toBe("FAQPage");
    // every schema question appears as a visible heading with its answer text
    for (const entity of ld.mainEntity) {
      expect(faq).toContain(`<h2>${entity.name}</h2>`);
      expect(faq).toContain(entity.acceptedAnswer.text);
    }
    expect(ld.mainEntity.length).toBeGreaterThanOrEqual(8);

    const llms = readFileSync(join(DIST, "llms.txt"), "utf8");
    expect(llms).toContain("# Smallcloud");
    expect(llms).toContain("llms-full.txt");
    expect(llms).toContain("https://onsmallcloud.com/docs/quickstart.html");

    const full = readFileSync(join(DIST, "llms-full.txt"), "utf8");
    expect(full).toContain("Frequently asked questions");
    expect(full).toContain("smallcloud deploy");
    expect(full).not.toContain("<h2>"); // tags stripped
  });

  it("builds all docs pages with cross-links", { timeout: 60_000 }, () => {
    build();
    const guides = [
      "quickstart",
      "deploy-node-app",
      "sharing-and-roles",
      "persistence-and-kv",
      "agents-mcp",
      "security-model",
    ];
    for (const guide of guides) {
      const page = readFileSync(join(DIST, "docs", `${guide}.html`), "utf8");
      expect(page).toContain("<title>");
      expect(page).toContain("More guides");
    }
  });
});
