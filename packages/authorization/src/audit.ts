import type { Instant, SupportGrantId } from "@counter/domain";
import type { AuthorizedContext } from "./authorize.js";

export const SUPPORT_AUDIT_ACTIONS = ["issued", "used", "denied", "revoked"] as const;
export type SupportAuditAction = (typeof SUPPORT_AUDIT_ACTIONS)[number];

export interface SupportAuditEvent {
  readonly action: SupportAuditAction;
  readonly supportGrantId?: SupportGrantId;
  readonly context: AuthorizedContext;
  readonly occurredAt: Instant;
}

/**
 * Mandatory boundary for support lifecycle evidence. Task 12 supplies the
 * durable tamper-evident implementation; Task 5 callers must not silently
 * omit the event.
 */
export interface SupportAuditSink {
  record(event: SupportAuditEvent): Promise<void>;
}
