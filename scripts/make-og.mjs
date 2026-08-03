#!/usr/bin/env node
/**
 * Generates site/assets/og.png (1200×630) from an inline SVG using a one-shot
 * docker rsvg container. Run only when the design changes — the PNG is
 * committed and buildSite() just copies it (keeps builds fast + deterministic).
 */
import { execFileSync } from "node:child_process";
import { mkdirSync, writeFileSync } from "node:fs";
import { join } from "node:path";

const REPO = new URL("..", import.meta.url).pathname;
const ASSETS = join(REPO, "site/assets");
mkdirSync(ASSETS, { recursive: true });

const SVG = `<svg xmlns="http://www.w3.org/2000/svg" width="1200" height="630" viewBox="0 0 1200 630">
  <rect width="1200" height="630" fill="#101418"/>
  <rect x="0" y="0" width="1200" height="6" fill="#0b6bcb"/>
  <text x="80" y="240" font-family="DejaVu Sans, sans-serif" font-size="88" font-weight="700" fill="#ffffff">Smallcloud</text>
  <text x="80" y="330" font-family="DejaVu Sans, sans-serif" font-size="40" fill="#aeb6c2">Your own cloud, for small software.</text>
  <text x="80" y="440" font-family="DejaVu Sans Mono, monospace" font-size="30" fill="#7ee787">$ smallcloud deploy</text>
  <text x="80" y="490" font-family="DejaVu Sans Mono, monospace" font-size="30" fill="#e8edf2">&#10003; Deployed my-app in 0.9s &#8594; private HTTPS URL</text>
  <text x="80" y="570" font-family="DejaVu Sans, sans-serif" font-size="26" fill="#5a6270">sandboxed &#183; private by default &#183; agent-native &#183; scale-to-zero</text>
</svg>`;

writeFileSync(join(ASSETS, "og.svg"), SVG);

execFileSync("docker", [
  "run", "--rm",
  "-v", `${ASSETS}:/work`,
  "alpine",
  "sh", "-c",
  "apk add --no-cache rsvg-convert font-dejavu >/dev/null && rsvg-convert -w 1200 -h 630 -o /work/og.png /work/og.svg && chown 1000:1000 /work/og.png",
], { stdio: "inherit" });

console.log("wrote site/assets/og.png");
