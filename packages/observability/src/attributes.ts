/**
 * Safe span and metric attribute helpers.
 *
 * Only safe, non-PII identifiers are emitted as telemetry attributes.
 * Raw secrets, credentials, and personal data are never included.
 */
import type { CorrelationId, Environment } from "@counter/domain";

/**
 * Canonical attribute name constants for consistent telemetry naming.
 */
export const ATTR = Object.freeze({
  /** Correlation ID propagated across service boundaries. */
  CORRELATION_ID: "counter.correlation_id",
  /** Deployment environment (local, test, sandbox, pilot, production). */
  ENVIRONMENT: "counter.environment",
  /** Service name emitting the telemetry. */
  SERVICE_NAME: "service.name",
  /** Scope kind (merchant, wallet, platform). */
  SCOPE_KIND: "counter.scope.kind",
  /** Actor kind (merchant_user, wallet_user, etc.). */
  ACTOR_KIND: "counter.actor.kind",
  /** Job type for workflow metrics. */
  JOB_TYPE: "counter.job.type",
  /** Event type for outbox/inbox metrics. */
  EVENT_TYPE: "counter.event.type",
  /** HTTP route for API metrics. */
  HTTP_ROUTE: "http.route",
  /** HTTP method for API metrics. */
  HTTP_METHOD: "http.request.method",
  /** HTTP status code for API metrics. */
  HTTP_STATUS_CODE: "http.response.status_code",
  /** Policy decision outcome. */
  POLICY_OUTCOME: "counter.policy.outcome",
  /** Authority failure reason. */
  AUTHORITY_FAILURE_REASON: "counter.authority.failure_reason",
  /** Transaction state (for state-count metrics). */
  TRANSACTION_STATE: "counter.transaction.state",
  /** Provider name for connector metrics. */
  PROVIDER_NAME: "counter.provider.name",
  /** Error class for provider error counters. */
  ERROR_CLASS: "counter.error.class",
  /** Finding severity level. */
  FINDING_SEVERITY: "counter.finding.severity",
  /** Finding status. */
  FINDING_STATUS: "counter.finding.status",
} as const);

export type AttributeName = (typeof ATTR)[keyof typeof ATTR];

/**
 * Context attributes safe for span and metric labels.
 * Contains only identifiers that are safe to propagate.
 */
export interface SafeAttributes {
  readonly [ATTR.CORRELATION_ID]?: string;
  readonly [ATTR.ENVIRONMENT]?: string;
  readonly [ATTR.SCOPE_KIND]?: string;
  readonly [ATTR.ACTOR_KIND]?: string;
  readonly [ATTR.JOB_TYPE]?: string;
  readonly [ATTR.EVENT_TYPE]?: string;
}

/**
 * Creates a safe attribute set from correlation context.
 * Never includes secrets, tokens, credentials, or PII.
 */
export function safeContextAttributes(context: {
  readonly correlationId?: CorrelationId;
  readonly environment?: Environment;
  readonly scopeKind?: string;
  readonly actorKind?: string;
}): Record<string, string> {
  const attrs: Record<string, string> = {};

  if (context.correlationId !== undefined) {
    attrs[ATTR.CORRELATION_ID] = context.correlationId;
  }
  if (context.environment !== undefined) {
    attrs[ATTR.ENVIRONMENT] = context.environment;
  }
  if (context.scopeKind !== undefined) {
    attrs[ATTR.SCOPE_KIND] = context.scopeKind;
  }
  if (context.actorKind !== undefined) {
    attrs[ATTR.ACTOR_KIND] = context.actorKind;
  }

  return attrs;
}
