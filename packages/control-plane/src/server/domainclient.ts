import { loadConfig, saveConfig } from "./composition.js";

/** The operator-run claim service (see scripts/domains-entry.mjs). */
export const DEFAULT_CLAIM_SERVICE = "https://claim.onsmallcloud.com";

export interface ClaimedDomain {
  domain: string;
  name: string;
}

/**
 * Claims a free subdomain from a Smallcloud Domains service and persists it
 * as this installation's baseDomain (plus the claim token for later IP
 * updates). The service infers the server's public IP from the caller.
 */
export async function claimDomain(
  name: string,
  service: string = DEFAULT_CLAIM_SERVICE,
  fetchImpl: typeof fetch = fetch,
): Promise<ClaimedDomain> {
  const res = await fetchImpl(`${service}/claim`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ name }),
  });
  const body = (await res.json()) as { domain?: string; token?: string; error?: string };
  if (!res.ok || !body.domain || !body.token) {
    throw new Error(body.error ?? `claim failed (HTTP ${res.status})`);
  }

  saveConfig({
    ...loadConfig(),
    baseDomain: body.domain,
    domainName: name,
    domainToken: body.token,
    domainService: service,
  });
  return { domain: body.domain, name };
}

/** Re-points the claimed records at this server's current public IP. */
export async function updateDomainIp(fetchImpl: typeof fetch = fetch): Promise<string> {
  const config = loadConfig();
  if (!config.domainName || !config.domainToken) {
    throw new Error("No claimed domain in config — claim one first: smallcloud domain claim <name>");
  }
  const service = config.domainService ?? DEFAULT_CLAIM_SERVICE;
  const res = await fetchImpl(`${service}/update`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ name: config.domainName, token: config.domainToken }),
  });
  const body = (await res.json()) as { domain?: string; error?: string };
  if (!res.ok || !body.domain) throw new Error(body.error ?? `update failed (HTTP ${res.status})`);
  return body.domain;
}
