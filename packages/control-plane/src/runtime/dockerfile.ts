import type { Detection } from "../detect/detect.js";

/** Every Smallcloud app listens on this port inside its container. */
export const APP_PORT = 8080;

/**
 * Static apps are served by Caddy running as nobody. Caddy needs writable
 * config/data homes, which live on a tmpfs at runtime.
 */
const STATIC_CADDYFILE = `:${APP_PORT} {
\troot * /srv
\tfile_server
\thandle_errors {
\t\t@notfound expression {err.status_code} == 404
\t\trewrite @notfound /404.html
\t\tfile_server
\t}
}
`;

export function generateCaddyfile(): string {
  return STATIC_CADDYFILE;
}

export function generateDockerfile(detection: Detection): string {
  if (detection.kind === "static") {
    // The stock caddy binary carries cap_net_bind_service file capabilities;
    // under no-new-privileges + cap-drop ALL the kernel refuses to exec such a
    // binary. We bind an unprivileged port, so strip them.
    return `FROM caddy:2-alpine
RUN apk add --no-cache libcap && setcap -r /usr/bin/caddy && mkdir -p /data && chown 65534:65534 /data
COPY Caddyfile /etc/caddy/Caddyfile
COPY app/ /srv/
ENV XDG_CONFIG_HOME=/tmp XDG_DATA_HOME=/tmp
USER 65534:65534
EXPOSE ${APP_PORT}
CMD ["caddy", "run", "--config", "/etc/caddy/Caddyfile"]
`;
  }

  const buildStep = detection.buildCommand ? `RUN ${detection.buildCommand}\n` : "";
  const start = detection.startCommand ?? "npm run start";
  const startJson = JSON.stringify(start.split(" "));
  return `FROM node:22-slim
WORKDIR /app
COPY app/ .
RUN npm install --omit=dev && mkdir -p /data && chown node:node /data
${buildStep}ENV NODE_ENV=production PORT=${APP_PORT} DATA_DIR=/data
USER node
EXPOSE ${APP_PORT}
CMD ${startJson}
`;
}
