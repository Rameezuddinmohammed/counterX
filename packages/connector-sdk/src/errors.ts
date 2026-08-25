/**
 * Typed connector error types.
 *
 * Connector errors represent failures encountered when communicating
 * with external systems. They are distinct from domain canonical errors.
 */

// ─── Error Codes ──────────────────────────────────────────────────────────────

export const CONNECTOR_ERROR_CODES = [
  "auth_failure",
  "rate_limited",
  "timeout",
  "stale_data",
  "conflict",
  "unavailable",
  "validation_error",
  "not_found",
  "permission_denied",
] as const;
export type ConnectorErrorCode = (typeof CONNECTOR_ERROR_CODES)[number];

const connectorErrorCodeSet: ReadonlySet<string> = new Set(CONNECTOR_ERROR_CODES);

// ─── Error Interface ──────────────────────────────────────────────────────────

export interface ConnectorError {
  readonly code: ConnectorErrorCode;
  readonly message: string;
  readonly retryable: boolean;
  readonly retryAfterMs: number | undefined;
  readonly source: string;
}

// ─── Type Guard ───────────────────────────────────────────────────────────────

export function isConnectorError(value: unknown): value is ConnectorError {
  if (typeof value !== "object" || value === null) {
    return false;
  }
  const candidate = value as Record<string, unknown>;
  return (
    typeof candidate["code"] === "string" &&
    connectorErrorCodeSet.has(candidate["code"]) &&
    typeof candidate["message"] === "string" &&
    typeof candidate["retryable"] === "boolean" &&
    (candidate["retryAfterMs"] === undefined || typeof candidate["retryAfterMs"] === "number") &&
    typeof candidate["source"] === "string"
  );
}

// ─── Factory ──────────────────────────────────────────────────────────────────

export interface CreateConnectorErrorInput {
  readonly code: ConnectorErrorCode;
  readonly message: string;
  readonly retryable: boolean;
  readonly retryAfterMs?: number | undefined;
  readonly source: string;
}

export function createConnectorError(input: CreateConnectorErrorInput): ConnectorError {
  return Object.freeze({
    code: input.code,
    message: input.message,
    retryable: input.retryable,
    retryAfterMs: input.retryAfterMs,
    source: input.source,
  });
}
