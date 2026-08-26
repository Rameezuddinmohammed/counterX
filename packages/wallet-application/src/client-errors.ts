/**
 * Structured error types for merchant runtime client operations.
 *
 * All errors are normalized to safe representations: no stack traces,
 * no raw response bodies, no internal details are leaked. Each error
 * carries a kind, human-readable message, retryable flag, and optional
 * correlation ID for tracing.
 */

// ---------------------------------------------------------------------------
// Client Error Kind
// ---------------------------------------------------------------------------

export const CLIENT_ERROR_KINDS = [
  "network",
  "timeout",
  "malformed_response",
  "manifest_verification",
  "stale_manifest",
  "unknown_extension",
  "server_error",
  "unauthorized",
  "indeterminate",
] as const;

export type ClientErrorKind = (typeof CLIENT_ERROR_KINDS)[number];

// ---------------------------------------------------------------------------
// Merchant Client Error
// ---------------------------------------------------------------------------

/**
 * Structured error for merchant client operations. Never leaks internal
 * details (no stack traces, no raw response bodies).
 */
export interface MerchantClientError {
  readonly kind: ClientErrorKind;
  readonly message: string;
  readonly retryable: boolean;
  readonly correlationId?: string | undefined;
}

// ---------------------------------------------------------------------------
// Type-Safe Error Factories
// ---------------------------------------------------------------------------

export function createNetworkError(correlationId?: string): MerchantClientError {
  return {
    kind: "network",
    message: "Network connection failed",
    retryable: true,
    correlationId,
  };
}

export function createTimeoutError(correlationId?: string): MerchantClientError {
  return {
    kind: "timeout",
    message: "Request timed out; outcome is indeterminate",
    retryable: true,
    correlationId,
  };
}

export function createMalformedResponseError(correlationId?: string): MerchantClientError {
  return {
    kind: "malformed_response",
    message: "Response did not conform to expected schema",
    retryable: false,
    correlationId,
  };
}

export function createManifestVerificationError(
  reason: string,
  correlationId?: string,
): MerchantClientError {
  return {
    kind: "manifest_verification",
    message: `Manifest verification failed: ${reason}`,
    retryable: false,
    correlationId,
  };
}

export function createStaleManifestError(correlationId?: string): MerchantClientError {
  return {
    kind: "stale_manifest",
    message: "Merchant manifest is stale or has been superseded",
    retryable: true,
    correlationId,
  };
}

export function createUnknownExtensionError(correlationId?: string): MerchantClientError {
  return {
    kind: "unknown_extension",
    message: "Response contains unknown extension fields",
    retryable: false,
    correlationId,
  };
}

export function createServerError(correlationId?: string): MerchantClientError {
  return {
    kind: "server_error",
    message: "Merchant server returned an error",
    retryable: true,
    correlationId,
  };
}

export function createUnauthorizedError(correlationId?: string): MerchantClientError {
  return {
    kind: "unauthorized",
    message: "Authentication failed or insufficient permissions",
    retryable: false,
    correlationId,
  };
}

export function createIndeterminateError(correlationId?: string): MerchantClientError {
  return {
    kind: "indeterminate",
    message: "Operation outcome is not yet authoritative; query before retry",
    retryable: true,
    correlationId,
  };
}
