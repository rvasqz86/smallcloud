#!/usr/bin/env node
/**
 * Container entrypoint for sc-egress: the sandbox's one controlled opening.
 * Apps authenticate with per-app proxy credentials; only their allowlisted
 * hostnames are forwarded. Denials land in the audit trail.
 */
import {
  authenticateEgress,
  isEgressAllowed,
  migrate,
  openDatabase,
  recordAudit,
} from "../packages/control-plane/dist/index.js";
import { EGRESS_PORT, createEgressProxy } from "../packages/egress-proxy/dist/index.js";

const db = openDatabase("/data/smallcloud.sqlite");
migrate(db);

const proxy = createEgressProxy({
  authenticate: (user, pass) => authenticateEgress(db, user, pass),
  isAllowed: (app, hostname) => isEgressAllowed(db, app, hostname),
  onDeny: (app, hostname, kind) => {
    recordAudit(db, {
      actor: app ?? "unknown",
      action: "egress.deny",
      subject: hostname,
      detail: kind,
    });
    console.log(`[egress] DENY ${app ?? "?"} → ${hostname} (${kind})`);
  },
});

proxy.listen(EGRESS_PORT, "0.0.0.0", () => {
  console.log(`smallcloud egress proxy listening on :${EGRESS_PORT}`);
});
