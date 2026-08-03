import type { Database } from "../db/database.js";

export interface AuditEvent {
  id: number;
  at: string;
  actor: string;
  action: string;
  subject: string;
  detail: string | null;
}

/**
 * Best-effort audit trail of privileged actions. Recording must never break
 * the action being recorded — failures are swallowed by design.
 */
export function recordAudit(
  db: Database,
  event: { actor: string; action: string; subject: string; detail?: string },
): void {
  try {
    db.prepare("INSERT INTO audit_events (actor, action, subject, detail) VALUES (?, ?, ?, ?)").run(
      event.actor,
      event.action,
      event.subject,
      event.detail ?? null,
    );
  } catch {
    // audit is an observer, never a gate
  }
}

export function listAudit(db: Database, limit = 50): AuditEvent[] {
  return db
    .prepare("SELECT id, at, actor, action, subject, detail FROM audit_events ORDER BY id DESC LIMIT ?")
    .all(limit) as unknown as AuditEvent[];
}
