/**
 * Retry utility with exponential backoff and jitter.
 *
 * Respects retryAfterMs from Shopify rate limit responses and
 * sends failures to the dead letter queue after exhausting retries.
 */

import { createCanonicalError, ok, err } from "@counter/domain";
import type { Result } from "@counter/domain";

// ─── Configuration ────────────────────────────────────────────────────────────

export interface RetryConfig {
  readonly maxRetries: number;
  readonly baseDelayMs: number;
  readonly maxDelayMs: number;
}

export const DEFAULT_RETRY_CONFIG: RetryConfig = Object.freeze({
  maxRetries: 3,
  baseDelayMs: 1000,
  maxDelayMs: 30000,
});

// ─── Retry Error ──────────────────────────────────────────────────────────────

export interface RetryExhaustedError {
  readonly kind: "retry_exhausted";
  readonly attempts: number;
  readonly lastError: unknown;
}

// ─── Rate Limit Context ───────────────────────────────────────────────────────

export interface RateLimitContext {
  readonly retryAfterMs: number | undefined;
}

// ─── Delay Calculation ────────────────────────────────────────────────────────

export function calculateDelay(
  attempt: number,
  config: RetryConfig,
  rateLimitContext: RateLimitContext | undefined,
): number {
  // If rate limit provides a retry-after, use it as the minimum
  if (rateLimitContext?.retryAfterMs !== undefined) {
    return Math.min(rateLimitContext.retryAfterMs, config.maxDelayMs);
  }

  // Exponential backoff: baseDelay * 2^attempt
  const exponentialDelay = config.baseDelayMs * Math.pow(2, attempt);
  // Add jitter: random 0-50% of the exponential delay
  const jitter = Math.random() * exponentialDelay * 0.5;
  const delay = exponentialDelay + jitter;

  return Math.min(delay, config.maxDelayMs);
}

// ─── Sleep Utility ────────────────────────────────────────────────────────────

export function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

// ─── Retry Execution ──────────────────────────────────────────────────────────

export async function withRetry<T>(
  operation: () => Promise<T>,
  config: RetryConfig = DEFAULT_RETRY_CONFIG,
  extractRateLimit?: (error: unknown) => RateLimitContext | undefined,
): Promise<Result<T, RetryExhaustedError>> {
  let lastError: unknown;

  for (let attempt = 0; attempt <= config.maxRetries; attempt++) {
    try {
      const result = await operation();
      return ok(result);
    } catch (error: unknown) {
      lastError = error;

      if (attempt >= config.maxRetries) {
        break;
      }

      const rateLimitContext = extractRateLimit?.(error);
      const delay = calculateDelay(attempt, config, rateLimitContext);
      await sleep(delay);
    }
  }

  return err({
    kind: "retry_exhausted",
    attempts: config.maxRetries + 1,
    lastError,
  });
}

// ─── Rate Limit Extraction ────────────────────────────────────────────────────

export function extractShopifyRateLimit(error: unknown): RateLimitContext | undefined {
  if (error instanceof Error && error.message.includes("Rate limited")) {
    const match = /Retry after (\d+)ms/u.exec(error.message);
    if (match?.[1]) {
      return { retryAfterMs: parseInt(match[1], 10) };
    }
    return { retryAfterMs: 1000 };
  }
  return undefined;
}

// ─── Result-Based Retry ───────────────────────────────────────────────────────

export async function withRetryResult<T>(
  operation: () => Promise<Result<T>>,
  config: RetryConfig = DEFAULT_RETRY_CONFIG,
  isRetryable?: (error: unknown) => boolean,
): Promise<Result<T>> {
  let lastResult: Result<T> | undefined;

  for (let attempt = 0; attempt <= config.maxRetries; attempt++) {
    const result = await operation();
    lastResult = result;

    if (result.ok) {
      return result;
    }

    if (attempt >= config.maxRetries) {
      break;
    }

    if (isRetryable && !isRetryable(result.error)) {
      return result;
    }

    const delay = calculateDelay(attempt, config, undefined);
    await sleep(delay);
  }

  return (
    lastResult ??
    err(
      createCanonicalError({
        category: "internal",
        code: "INTERNAL",
        message: "Retry exhausted with no result",
      }),
    )
  );
}
