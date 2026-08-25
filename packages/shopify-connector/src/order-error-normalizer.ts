/**
 * Normalize Shopify GraphQL errors and userErrors to typed ConnectorError.
 *
 * Maps Shopify-specific error codes and patterns to the connector-sdk
 * ConnectorErrorCode vocabulary so that upstream consumers can make
 * routing decisions without Shopify knowledge.
 */

import { createConnectorError, type ConnectorError } from "@counter/connector-sdk";

import type { ShopifyGraphQLError, ShopifyGraphQLResponse, ShopifyThrottleStatus } from "./graphql-client.js";

// ─── User Error Shape ─────────────────────────────────────────────────────────

export interface ShopifyUserError {
  readonly field: readonly string[] | string | null;
  readonly message: string;
  readonly code?: string | undefined;
}

// ─── Throttle Detection ───────────────────────────────────────────────────────

export function isThrottled(response: ShopifyGraphQLResponse<unknown>): boolean {
  const status = response.extensions?.cost?.throttleStatus;
  if (status && status.currentlyAvailable <= 0) {
    return true;
  }
  if (response.errors) {
    return response.errors.some(
      (e) => e.message.includes("THROTTLED") || e.message.includes("Throttled"),
    );
  }
  return false;
}

export function computeRetryAfterMs(status: ShopifyThrottleStatus | undefined): number | undefined {
  if (!status || status.restoreRate <= 0) {
    return 1000;
  }
  const deficit = status.maximumAvailable - status.currentlyAvailable;
  if (deficit <= 0) return undefined;
  return Math.ceil((deficit / status.restoreRate) * 1000);
}

// ─── GraphQL Error Normalization ──────────────────────────────────────────────

export function normalizeGraphQLErrors(
  errors: readonly ShopifyGraphQLError[],
  response: ShopifyGraphQLResponse<unknown>,
): ConnectorError {
  const firstError = errors[0];
  if (!firstError) {
    return createConnectorError({
      code: "unavailable",
      message: "Unknown GraphQL error",
      retryable: true,
      source: "shopify",
    });
  }

  // Throttle detection
  if (isThrottled(response)) {
    const retryAfterMs = computeRetryAfterMs(response.extensions?.cost?.throttleStatus);
    return createConnectorError({
      code: "rate_limited",
      message: firstError.message,
      retryable: true,
      retryAfterMs,
      source: "shopify",
    });
  }

  const message = firstError.message.toLowerCase();

  // Authentication errors
  if (message.includes("access denied") || message.includes("unauthorized")) {
    return createConnectorError({
      code: "auth_failure",
      message: firstError.message,
      retryable: false,
      source: "shopify",
    });
  }

  // Permission errors
  if (message.includes("permission") || message.includes("forbidden")) {
    return createConnectorError({
      code: "permission_denied",
      message: firstError.message,
      retryable: false,
      source: "shopify",
    });
  }

  // Not found
  if (message.includes("not found") || message.includes("does not exist")) {
    return createConnectorError({
      code: "not_found",
      message: firstError.message,
      retryable: false,
      source: "shopify",
    });
  }

  // Default to unavailable (retryable)
  return createConnectorError({
    code: "unavailable",
    message: firstError.message,
    retryable: true,
    source: "shopify",
  });
}

// ─── User Error Normalization ─────────────────────────────────────────────────

export function normalizeUserErrors(
  userErrors: readonly ShopifyUserError[],
): ConnectorError {
  const firstError = userErrors[0];
  if (!firstError) {
    return createConnectorError({
      code: "validation_error",
      message: "Unknown user error",
      retryable: false,
      source: "shopify",
    });
  }

  const code = firstError.code?.toUpperCase() ?? "";
  const message = firstError.message.toLowerCase();

  // Throttle
  if (code === "THROTTLED" || message.includes("throttl")) {
    return createConnectorError({
      code: "rate_limited",
      message: firstError.message,
      retryable: true,
      retryAfterMs: 1000,
      source: "shopify",
    });
  }

  // Not found
  if (code === "NOT_FOUND" || message.includes("not found") || message.includes("does not exist")) {
    return createConnectorError({
      code: "not_found",
      message: firstError.message,
      retryable: false,
      source: "shopify",
    });
  }

  // Permission
  if (code === "ACCESS_DENIED" || message.includes("permission") || message.includes("denied")) {
    return createConnectorError({
      code: "permission_denied",
      message: firstError.message,
      retryable: false,
      source: "shopify",
    });
  }

  // Conflict / already-done state
  if (
    message.includes("already") ||
    message.includes("conflict") ||
    code === "ORDER_ALREADY_CANCELLED"
  ) {
    return createConnectorError({
      code: "conflict",
      message: firstError.message,
      retryable: false,
      source: "shopify",
    });
  }

  // Stale data
  if (message.includes("stale") || message.includes("version")) {
    return createConnectorError({
      code: "stale_data",
      message: firstError.message,
      retryable: true,
      source: "shopify",
    });
  }

  // Default validation error
  return createConnectorError({
    code: "validation_error",
    message: firstError.message,
    retryable: false,
    source: "shopify",
  });
}

// ─── Timeout Classification ───────────────────────────────────────────────────

/**
 * Classify a timeout based on whether a response was received.
 *
 * - If no response at all: timeout occurred before the effect (safe to retry).
 * - If a partial response was received: timeout occurred after the effect
 *   started (must query to determine actual outcome).
 */
export function classifyTimeout(responseReceived: boolean): ConnectorError {
  if (!responseReceived) {
    // Before effect: safe to retry
    return createConnectorError({
      code: "timeout",
      message: "Request timed out before effect was confirmed",
      retryable: true,
      source: "shopify",
    });
  }

  // After effect: must query, not safe to retry blindly
  return createConnectorError({
    code: "timeout",
    message: "Request timed out after effect may have been applied",
    retryable: false,
    source: "shopify",
  });
}
