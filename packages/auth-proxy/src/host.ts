export interface HostConfig {
  baseDomain: string;
  /** Subdomain prefix namespacing Smallcloud apps, per DECISIONS.md D-003. */
  appPrefix: string;
}

/**
 * Maps a request Host header to an app name.
 * `sc-todo.osita.ai` → `todo`; anything else → undefined.
 */
export function hostToAppName(hostHeader: string | undefined, config: HostConfig): string | undefined {
  if (!hostHeader) return undefined;
  const host = hostHeader.split(":")[0]!.toLowerCase();
  const suffix = `.${config.baseDomain}`;
  if (!host.endsWith(suffix)) return undefined;
  const label = host.slice(0, -suffix.length);
  if (!label.startsWith(config.appPrefix) || label.includes(".")) return undefined;
  const app = label.slice(config.appPrefix.length);
  return app.length > 0 ? app : undefined;
}
