const ANNUAL_URL = "https://buy.polar.sh/polar_cl_w4E2m2n4PptU6xYGYcYciZyqSlboHsAApjodx0DcBH7";
const LIFETIME_URL = "https://buy.polar.sh/polar_cl_wEC6SqUIduhqYw6o486yyRMVJeug593WXwM3u1EXox5";
const SETUP_MAILTO = "mailto:pro@onsmallcloud.com?subject=Smallcloud%20setup%20service";

export default {
  slug: "pricing",
  title: "Smallcloud Pricing — free core, optional Pro",
  description:
    "Smallcloud's core is free and MIT-licensed forever. Pro adds offsite backups and priority support for $49/yr early-bird, or $199 as a founding lifetime member.",
  jsonLd: {
    "@context": "https://schema.org",
    "@type": "Product",
    name: "Smallcloud Pro",
    description: "Offsite backups, priority support, and a roadmap vote for Smallcloud operators.",
    brand: { "@type": "Brand", name: "Smallcloud" },
    offers: [
      { "@type": "Offer", name: "Pro — Annual (early-bird)", price: "49", priceCurrency: "USD", url: ANNUAL_URL, availability: "https://schema.org/InStock" },
      { "@type": "Offer", name: "Pro — Founding (Lifetime)", price: "199", priceCurrency: "USD", url: LIFETIME_URL, availability: "https://schema.org/InStock" },
    ],
  },
  body: `
<section class="hero">
  <h1>Pricing</h1>
  <p class="lede">Smallcloud is free, MIT-licensed, self-hosted software — that never changes. Pro doesn't unlock features; it adds assurance for people running it in production.</p>
</section>

<section>
  <div class="grid">
    <div class="card">
      <h3>Free</h3>
      <p class="price">$0</p>
      <ul>
        <li>Deploy static sites &amp; Node.js apps</li>
        <li>Magic-link auth, sharing, roles</li>
        <li>Scale-to-zero, persistent storage</li>
        <li>MCP server for AI agents</li>
        <li>MIT-licensed, source available</li>
      </ul>
      <a class="btn secondary" href="/docs/quickstart.html">Get started</a>
    </div>
    <div class="card highlight">
      <h3>Pro — Annual</h3>
      <p class="price">$49<span style="font-size:1rem;font-weight:400;color:var(--muted)">/yr, early-bird</span></p>
      <ul>
        <li>Everything in Free</li>
        <li>Nightly encrypted offsite backups (your own S3-compatible bucket) with tested restore</li>
        <li>Priority support — 48-hour response</li>
        <li>Early access &amp; a vote on the roadmap</li>
      </ul>
      <a class="btn" href="${ANNUAL_URL}">Subscribe — $49/yr</a>
      <p><small>Rises to $99/yr after launch month.</small></p>
    </div>
    <div class="card">
      <h3>Pro — Founding</h3>
      <p class="price">$199<span style="font-size:1rem;font-weight:400;color:var(--muted)"> once, lifetime</span></p>
      <ul>
        <li>Everything in Pro, forever</li>
        <li>Price locked — never increases</li>
        <li>Limited to the first 25 buyers</li>
      </ul>
      <a class="btn" href="${LIFETIME_URL}">Become a founder — $199</a>
    </div>
  </div>
</section>

<section>
  <h2>Done-for-you setup — $99</h2>
  <p>Don't want to run the quickstart yourself? I'll install Smallcloud on your own server, claim your free subdomain, and deploy your first app with you over a screenshare — about 45 minutes. Limited to a couple of bookings a week.</p>
  <a class="btn secondary" href="${SETUP_MAILTO}">Book a setup session</a>
</section>

<section>
  <h2>Questions?</h2>
  <p>See the <a href="/faq.html">FAQ</a>, or email <a href="mailto:pro@onsmallcloud.com">pro@onsmallcloud.com</a>.</p>
</section>
`,
};
