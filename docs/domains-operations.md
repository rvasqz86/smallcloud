# Smallcloud Domains — operations & policy

The claim service (`sc-domains`, claim.onsmallcloud.com) hands out free
`NAME.onsmallcloud.com` subdomains that point at claimants' own servers.
This document is the operator-side posture.

## Abuse posture

- **Rate limits:** 3 claims per IP burst, refilling ~3/hour; updates 10/min.
- **Name rules:** 3–40 chars, app-name charset, reserved list in
  `packages/control-plane/src/server/domains.ts` (`RESERVED_SUBDOMAINS`).
- **DNS-only records:** claimed names are never proxied — claimants terminate
  their own TLS; nothing transits our infrastructure after the claim.
- **Audit:** every claim/update/denial is logged by the service (docker logs
  sc-domains); the SQLite claims DB lives in the `sc-domains-data` volume
  (covered by the nightly volume backups when named `sc-data-*`; note:
  `sc-domains-data` is intentionally separate — back it up by renaming or add
  it to the backup allowlist if claims become precious).

## Dormant-name policy (v1: documented, not automated)

Claims are first-come-first-served and free, so squatting is expected.
Policy: names whose DNS records have pointed at an unreachable server for
**6+ months** may be reclaimed by the operator. No automation yet — reclaim =
delete the two DNS records + the `claims` row. Revisit when claim volume
justifies a reaper.

## Public Suffix List (submit when user count grows)

Why: Let's Encrypt allows ~50 new certificates/week per registered domain.
Today every claimant shares onsmallcloud.com's quota; once the domain is on
the PSL, **each `NAME.onsmallcloud.com` gets its own quota** (this is how
DuckDNS and github.io work). Cookies also become properly scoped per claimant.

How (operator actions, ~15 min + review wait):

1. Create the validation record (Cloudflare, zone onsmallcloud.com):
   `_psl.onsmallcloud.com TXT "<link to the PSL pull request>"` (added after
   opening the PR — the PR template says exactly this).
2. Fork https://github.com/publicsuffix/list, add under the
   **PRIVATE DOMAINS** section (alphabetical):

   ```
   // Smallcloud : https://smallcloud.osita.ai
   // Submitted by <operator email>
   onsmallcloud.com
   ```

3. Open the PR following `.github/pull_request_template.md`; add the `_psl`
   TXT record with the PR URL; wait for review (weeks; renewals meanwhile are
   exempt from LE limits, so existing users keep working).

Threshold to actually submit: ~20 active claimants, or the first LE
rate-limit report — whichever comes first.
