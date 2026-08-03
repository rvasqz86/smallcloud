export const SERVICE_NAME = "smallcloud-auth-proxy";

export { hostToAppName, type HostConfig } from "./host.js";
export {
  SESSION_COOKIE,
  hashToken,
  parseCookies,
  type AuthenticatedSession,
  type SessionValidator,
} from "./session.js";
export { createAuthProxy, type AuthFlow, type AuthProxyOptions } from "./server.js";
export { clientIp, createRateLimiter, type RateLimiter } from "./ratelimit.js";
