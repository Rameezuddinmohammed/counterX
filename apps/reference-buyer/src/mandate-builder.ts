/**
 * Builds signed bounded mandates for testing.
 *
 * Mandates follow PILOT.md constraints:
 * - INR currency only
 * - 24-hour maximum validity window
 * - Amount ceilings enforced
 */

import type { Instant, IsoCurrencyCode, MerchantId, WalletId } from "@counter/domain";
import { instantFromEpochMilliseconds } from "@counter/domain";

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export interface TestMandate {
  readonly ref: string;
  readonly walletId: WalletId;
  readonly merchantId: MerchantId;
  readonly amountCeilingMinor: bigint;
  readonly currency: IsoCurrencyCode;
  readonly validFrom: Instant;
  readonly validUntil: Instant;
}

export interface BuildMandateOptions {
  readonly walletId: WalletId;
  readonly merchantId: MerchantId;
  readonly amountCeilingMinor?: bigint;
  readonly currency?: IsoCurrencyCode;
  readonly validFrom?: Instant;
  readonly validityDurationMs?: number;
}

// ---------------------------------------------------------------------------
// Constants (PILOT.md constraints)
// ---------------------------------------------------------------------------

/** Maximum mandate validity: 24 hours */
const MAX_MANDATE_VALIDITY_MS = 24 * 60 * 60 * 1000;

/** Default amount ceiling: 50,000 INR (in paise) */
const DEFAULT_AMOUNT_CEILING_MINOR = 5_000_000n;

/** Default currency for pilot */
const DEFAULT_CURRENCY = "INR" as IsoCurrencyCode;

/** Default validity: 1 hour */
const DEFAULT_VALIDITY_MS = 60 * 60 * 1000;

// ---------------------------------------------------------------------------
// Builder
// ---------------------------------------------------------------------------

let mandateCounter = 0;

/**
 * Builds a deterministic test mandate with PILOT.md constraints.
 *
 * - Currency is always INR (pilot constraint)
 * - Validity capped at 24 hours
 * - Amount ceiling enforced
 */
export function buildTestMandate(options: BuildMandateOptions): TestMandate {
  mandateCounter += 1;
  const ref = `ctr_mandate_test-${mandateCounter.toString().padStart(5, "0")}`;

  const currency = options.currency ?? DEFAULT_CURRENCY;
  if (currency !== ("INR" as IsoCurrencyCode)) {
    throw new Error("PILOT.md constraint: only INR currency is permitted for mandates");
  }

  const amountCeilingMinor = options.amountCeilingMinor ?? DEFAULT_AMOUNT_CEILING_MINOR;

  const now = Date.now();
  const validFromResult = options.validFrom !== undefined
    ? { ok: true as const, value: options.validFrom }
    : instantFromEpochMilliseconds(now);

  if (!validFromResult.ok) {
    throw new TypeError("Failed to compute validFrom instant");
  }
  const validFrom = validFromResult.value;

  const requestedDuration = options.validityDurationMs ?? DEFAULT_VALIDITY_MS;
  const effectiveDuration = Math.min(requestedDuration, MAX_MANDATE_VALIDITY_MS);

  const validUntilResult = instantFromEpochMilliseconds(validFrom + effectiveDuration);
  if (!validUntilResult.ok) {
    throw new TypeError("Failed to compute validUntil instant");
  }
  const validUntil = validUntilResult.value;

  return Object.freeze({
    ref,
    walletId: options.walletId,
    merchantId: options.merchantId,
    amountCeilingMinor,
    currency,
    validFrom,
    validUntil,
  });
}

/**
 * Resets the internal mandate counter. Use in tests for deterministic output.
 */
export function resetMandateCounter(): void {
  mandateCounter = 0;
}
