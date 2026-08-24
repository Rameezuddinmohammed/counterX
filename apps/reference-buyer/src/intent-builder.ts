/**
 * Builds signed purchase intents for testing.
 *
 * Intents follow PILOT.md constraints:
 * - 15-minute maximum validity
 * - Never valid beyond quote expiry
 * - Bound to a specific quote digest
 */

import type { Instant, IsoCurrencyCode } from "@counter/domain";
import { instantFromEpochMilliseconds } from "@counter/domain";

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export interface TestIntent {
  readonly ref: string;
  readonly mandateRef: string;
  readonly quoteDigest: string;
  readonly amountMinor: bigint;
  readonly currency: IsoCurrencyCode;
  readonly validFrom: Instant;
  readonly validUntil: Instant;
}

export interface BuildIntentOptions {
  readonly mandateRef: string;
  readonly quoteDigest: string;
  readonly amountMinor: bigint;
  readonly currency?: IsoCurrencyCode;
  readonly validFrom?: Instant;
  readonly validityDurationMs?: number;
  readonly quoteExpiresAt?: Instant;
}

// ---------------------------------------------------------------------------
// Constants (PILOT.md constraints)
// ---------------------------------------------------------------------------

/** Maximum intent validity: 15 minutes */
const MAX_INTENT_VALIDITY_MS = 15 * 60 * 1000;

/** Default currency for pilot */
const DEFAULT_CURRENCY = "INR" as IsoCurrencyCode;

/** Default validity: 10 minutes */
const DEFAULT_VALIDITY_MS = 10 * 60 * 1000;

// ---------------------------------------------------------------------------
// Builder
// ---------------------------------------------------------------------------

let intentCounter = 0;

/**
 * Builds a deterministic test intent with PILOT.md constraints.
 *
 * - Validity capped at 15 minutes
 * - Never extends beyond quote expiry
 * - Bound to a specific quote digest for provenance
 */
export function buildTestIntent(options: BuildIntentOptions): TestIntent {
  intentCounter += 1;
  const ref = `ctr_intent_test-${intentCounter.toString().padStart(5, "0")}`;

  const currency = options.currency ?? DEFAULT_CURRENCY;
  const now = Date.now();

  const validFromResult = options.validFrom !== undefined
    ? { ok: true as const, value: options.validFrom }
    : instantFromEpochMilliseconds(now);

  if (!validFromResult.ok) {
    throw new TypeError("Failed to compute validFrom instant");
  }
  const validFrom = validFromResult.value;

  // Compute validity: cap at MAX and never beyond quote expiry
  const requestedDuration = options.validityDurationMs ?? DEFAULT_VALIDITY_MS;
  let effectiveDuration = Math.min(requestedDuration, MAX_INTENT_VALIDITY_MS);

  if (options.quoteExpiresAt !== undefined) {
    const maxDurationByQuote = options.quoteExpiresAt - validFrom;
    if (maxDurationByQuote > 0) {
      effectiveDuration = Math.min(effectiveDuration, maxDurationByQuote);
    } else {
      throw new Error("Quote has already expired; cannot create intent");
    }
  }

  const validUntilResult = instantFromEpochMilliseconds(validFrom + effectiveDuration);
  if (!validUntilResult.ok) {
    throw new TypeError("Failed to compute validUntil instant");
  }
  const validUntil = validUntilResult.value;

  return Object.freeze({
    ref,
    mandateRef: options.mandateRef,
    quoteDigest: options.quoteDigest,
    amountMinor: options.amountMinor,
    currency,
    validFrom,
    validUntil,
  });
}

/**
 * Resets the internal intent counter. Use in tests for deterministic output.
 */
export function resetIntentCounter(): void {
  intentCounter = 0;
}
