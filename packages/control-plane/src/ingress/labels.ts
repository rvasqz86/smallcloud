import { appSubdomain } from "@smallcloud/shared";

export interface IngressConfig {
  baseDomain: string;
  /**
   * Where the reverse proxy reaches the Smallcloud auth proxy, e.g.
   * "http://10.0.1.1:7777" (docker-network gateway of the proxy → host process).
   */
  authProxyOrigin: string;
}

/**
 * Caddy labels for an app container. coolify-proxy (caddy-docker-proxy)
 * watches container labels and materializes a site block per app — we never
 * touch its config files or its container. Every site proxies to the
 * Smallcloud auth proxy, which is the only path to any app.
 */
export function ingressLabels(appName: string, config: IngressConfig): Record<string, string> {
  const host = appSubdomain(appName, config.baseDomain);
  return {
    caddy_0: `https://${host}`,
    "caddy_0.reverse_proxy": config.authProxyOrigin,
    "caddy_0.header": "-Server",
    "smallcloud.app": appName,
  };
}
