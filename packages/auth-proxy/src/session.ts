import { sha256Hex } from "@smallcloud/shared";

export const SESSION_COOKIE = "sc_session";

/** Raw tokens never touch storage — only their SHA-256 hex digest does. */
export function hashToken(rawToken: string): string {
  return sha256Hex(rawToken);
}

export function parseCookies(cookieHeader: string | undefined): Record<string, string> {
  const cookies: Record<string, string> = {};
  if (!cookieHeader) return cookies;
  for (const part of cookieHeader.split(";")) {
    const eq = part.indexOf("=");
    if (eq === -1) continue;
    const name = part.slice(0, eq).trim();
    const value = part.slice(eq + 1).trim();
    if (name) cookies[name] = value;
  }
  return cookies;
}

export interface AuthenticatedSession {
  userId: string;
}

/** Injected by the composition root — backed by the control-plane sessions table. */
export type SessionValidator = (tokenHash: string) => AuthenticatedSession | undefined;
