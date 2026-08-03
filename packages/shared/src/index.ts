/**
 * App names become subdomain labels (`sc-<app>.<base-domain>`), so they must
 * be valid DNS labels with room for the `sc-` prefix within the 63-char limit.
 */
export const APP_NAME_MAX_LENGTH = 40;

const APP_NAME_PATTERN = /^[a-z0-9](?:[a-z0-9-]*[a-z0-9])?$/;

export function isValidAppName(name: string): boolean {
  return (
    name.length > 0 &&
    name.length <= APP_NAME_MAX_LENGTH &&
    APP_NAME_PATTERN.test(name)
  );
}

import { createHash } from "node:crypto";

/** Canonical token digest: raw secrets never touch storage, only this does. */
export function sha256Hex(input: string): string {
  return createHash("sha256").update(input).digest("hex");
}

/** Hostnames Smallcloud claims for itself — user apps can never take them. */
export const RESERVED_APP_NAMES = new Set(["home", "www", "api", "admin", "mail", "auth", "smallcloud"]);

export function isReservedAppName(name: string): boolean {
  return RESERVED_APP_NAMES.has(name);
}

export function appSubdomain(name: string, baseDomain: string): string {
  if (!isValidAppName(name)) {
    throw new Error(
      `Invalid app name "${name}": lowercase letters, digits, and inner hyphens only, max ${APP_NAME_MAX_LENGTH} chars`,
    );
  }
  return `sc-${name}.${baseDomain}`;
}
