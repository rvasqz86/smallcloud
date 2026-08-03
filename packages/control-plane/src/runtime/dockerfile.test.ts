import { describe, expect, it } from "vitest";
import { APP_PORT, generateDockerfile } from "./dockerfile.js";

describe("generateDockerfile", () => {
  it("serves static apps with caddy as an unprivileged user", () => {
    const df = generateDockerfile({ kind: "static", reason: "" });
    expect(df).toContain("FROM caddy:2-alpine");
    expect(df).toContain("setcap -r /usr/bin/caddy");
    expect(df).toContain("USER 65534:65534");
    expect(df).toContain(`EXPOSE ${APP_PORT}`);
    expect(df).not.toContain("npm install");
  });

  it("runs node apps as the node user with the detected start command", () => {
    const df = generateDockerfile({
      kind: "node-web",
      reason: "",
      startCommand: "node server.js",
    });
    expect(df).toContain("FROM node:22-slim");
    expect(df).toContain("USER node");
    expect(df).toContain('CMD ["node","server.js"]');
    expect(df).not.toContain("RUN npm run build");
  });

  it("includes the build step only when the app has one", () => {
    const df = generateDockerfile({
      kind: "node-web",
      reason: "",
      startCommand: "npm run start",
      buildCommand: "npm run build",
    });
    expect(df).toContain("RUN npm run build");
    expect(df).toContain('CMD ["npm","run","start"]');
  });
});
