const faqs = [
  {
    q: "What is Smallcloud?",
    a: "Smallcloud is a self-hosted platform that deploys static sites and Node.js apps to private, HTTPS, magic-link-protected URLs in about a second. Every app is sandboxed with no network egress, scales to zero when idle, and can be shared by link with viewer or editor roles.",
  },
  {
    q: "How is Smallcloud different from Vercel, Netlify, or Heroku?",
    a: "Smallcloud runs on your own hardware, so there is no usage bill and no data leaves your box. Apps are private by default rather than public by default, and AI agents are first-class deployers through a bundled MCP server. The tradeoff: it targets small software — one server, small resource caps, two supported stacks.",
  },
  {
    q: "Is Smallcloud free?",
    a: "Yes. Smallcloud is MIT-licensed self-hosted software; you pay only for the machine it runs on.",
  },
  {
    q: "What can I deploy on Smallcloud?",
    a: "Static sites (any directory with an index.html) and Node.js 22 web apps (any directory whose package.json has a start script or main entry). No Dockerfiles, no build pipelines.",
  },
  {
    q: "How fast are deploys and cold starts?",
    a: "Deploys typically complete in one to three seconds. Idle apps stop automatically and wake on the next request in roughly 400 milliseconds.",
  },
  {
    q: "How does authentication work?",
    a: "Passwordless magic links: a visitor enters their email, opens a single-use link (emailed when the operator configures a mail provider, otherwise delivered via the server log), and receives a 30-day session. Every app route is enforced by an auth proxy — there are no unauthenticated app URLs, and per-app roles (owner, editor, viewer) gate every request.",
  },
  {
    q: "Can AI agents like Claude use Smallcloud?",
    a: "Yes — that is a core design goal. The bundled MCP server exposes deploy, list, logs, and delete as tools, so Claude Code can build an app, ship it, read its logs, and hand you the sign-in link, all inside the sandbox with a structurally limited blast radius.",
  },
  {
    q: "Is app data persistent?",
    a: "Yes. Each app owns a private quota'd volume at /data with SQLite support and a built-in key-value store. Data survives redeploys, is backed up nightly with seven-day retention, and is removed when the app is deleted.",
  },
  {
    q: "Where do I get Smallcloud?",
    a: "Install it from npm: npm install -g @rvasqz86/smallcloud. That gives you the smallcloud CLI and the smallcloud-mcp server for AI agents. A public source repository is planned.",
  },
  {
    q: "What are the infrastructure requirements?",
    a: "One Linux server with Docker, a caddy-docker-proxy ingress (Coolify installs have this already), wildcard DNS for a domain, and Node.js 22 with pnpm.",
  },
  {
    q: "Is Smallcloud secure enough to expose to the internet?",
    a: "Its security model assumes internet exposure: apps run with all capabilities dropped, read-only filesystems, hard resource caps, and zero network egress; auth endpoints are rate limited; all privileged actions are audited; and strict security headers cover every response. Deployed apps are never publicly reachable — only this website is.",
  },
];

const body = `
<h1>Frequently asked questions</h1>
${faqs.map(({ q, a }) => `<h2>${q}</h2>\n<p>${a}</p>`).join("\n")}
<p>More detail in the <a href="/docs/quickstart.html">quickstart</a> and the <a href="/docs/security-model.html">security model</a>.</p>
`;

export default {
  slug: "faq",
  title: "Smallcloud FAQ — self-hosted app deployment questions answered",
  description:
    "Answers about Smallcloud: what it is, how it compares to Vercel and Heroku, deploy speed, magic-link auth, AI agent support via MCP, persistence, and security.",
  jsonLd: {
    "@context": "https://schema.org",
    "@type": "FAQPage",
    mainEntity: faqs.map(({ q, a }) => ({
      "@type": "Question",
      name: q,
      acceptedAnswer: { "@type": "Answer", text: a },
    })),
  },
  body,
};
