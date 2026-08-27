/**
 * Production authorization policy for the worker money seam.
 *
 * The real lifecycle consults a {@link LifecyclePolicyPort} BEFORE any external
 * effect. Production previously wired NO policy, so the deployed seam fell back
 * to ALLOW_ALL and enforced none of the money predicates — the adversarial
 * proofs only exercised test-injected policies (review issues 2 and 5). This
 * module builds a REAL policy that enforces, in one place, the same predicates
 * the checkout-orchestrator enforces upstream, so the deployed worker path
 * itself denies:
 *
 *   - amount over the per-transaction ceiling and wallet rolling-24h limits, via
 *     the REAL {@link enforceTransactionLimits} from @counter/payment-sdk (not a
 *     re-implementation);
 *   - a REVOKED mandate            (authority.revokedAtMs <= now);
 *   - an EXPIRED mandate           (now > authority.mandateExpiresAtMs);
 *   - an EXPIRED authorization     (now > authority.authorizationExpiresAtMs);
 *   - a WRONG merchant scope       (authority.authorizedMerchantId != operator);
 *   - a TAMPERED amount            (request amount != authority.quotedAmountMinor).
 *
 * Each predicate is skipped when its authority field is absent, EXCEPT the
 * per-transaction / rolling limit which always applies. A deny returns `false`,
 * which the real lifecycle turns into a `declined` outcome with ZERO external
 * effect. The predicates are pure of I/O (except the injected ledger read), so
 * they run before the first Shopify/Razorpay call.
 *
 * SECURITY: reads amounts, timestamps, and scope ids only — never credentials.
 */

import {
  enforceTransactionLimits,
  InMemoryTransactionLedger,
  DEFAULT_LIMIT_CONFIG,
  type TransactionLedger,
  type TransactionLimitConfig,
} from "@counter/payment-sdk";
import {
  createCounterId,
  instantFromEpochMilliseconds,
  type Instant,
  type IsoCurrencyCode,
  type Money,
  type WalletId,
} from "@counter/domain";

import type { LifecyclePolicyPort } from "./real-lifecycle.js";
import type { PaymentAuthorizationRequest } from "./transaction-lifecycle.js";

// ─── Config ──────────────────────────────────────────────────────────────────

export interface ProductionPolicyConfig {
  /** The merchant this worker operates; a wrong authorized scope is denied. */
  readonly operatingMerchantId: string;
  /** Real limit config (defaults to the PILOT.md ceilings). */
  readonly limitConfig?: TransactionLimitConfig | undefined;
  /**
   * Wallet-scoped rolling ledger for the 24h attempt/total checks. Defaults to a
   * fresh in-memory ledger (structurally wires the real check; a deployment can
   * inject a durable, shared ledger). Injectable so tests can seed a window.
   */
  readonly ledger?: TransactionLedger | undefined;
  /** Clock, injectable for deterministic tests. */
  readonly now?: (() => Instant) | undefined;
}

// ─── Helpers ──────────────────────────────────────────────────────────────────

function nowInstant(): Instant {
  const result = instantFromEpochMilliseconds(Date.now());
  if (!result.ok) {
    throw new Error("Failed to derive current instant for policy");
  }
  return result.value;
}

/** Derives a stable WalletId from an opaque wallet reference for the ledger. */
function deriveWalletId(raw: string): WalletId {
  const entropy = new Uint8Array(16);
  for (let index = 0; index < raw.length; index += 1) {
    entropy[index % 16] = (entropy[index % 16]! + raw.charCodeAt(index)) & 0xff;
  }
  const result = createCounterId("wallet", entropy);
  if (!result.ok) {
    throw new Error("Failed to derive wallet id for policy");
  }
  return result.value;
}

function money(amountMinor: number, currency: string): Money {
  return Object.freeze({
    amountMinor: BigInt(amountMinor),
    currency: currency as IsoCurrencyCode,
  });
}

// ─── Policy ────────────────────────────────────────────────────────────────────

/**
 * Builds the production {@link LifecyclePolicyPort}. Every predicate a denial
 * gate; `allow` returns false as soon as one fails, so a tampered/expired/
 * revoked/over-scope/over-limit request is denied BEFORE any external effect.
 */
export function createProductionPolicy(config: ProductionPolicyConfig): LifecyclePolicyPort {
  const limitConfig = config.limitConfig ?? DEFAULT_LIMIT_CONFIG;
  const ledger = config.ledger ?? new InMemoryTransactionLedger();
  const clock = config.now ?? nowInstant;

  return {
    allow(request: PaymentAuthorizationRequest): Promise<boolean> {
      const authority = request.authority;
      const nowMs = Number(clock());

      // 1. Quote tamper: the requested amount MUST equal the quoted amount.
      if (
        authority?.quotedAmountMinor !== undefined &&
        request.amountMinor !== authority.quotedAmountMinor
      ) {
        return Promise.resolve(false);
      }

      // 2. Revocation: a mandate revoked at-or-before now blocks.
      if (authority?.revokedAtMs !== undefined && authority.revokedAtMs <= nowMs) {
        return Promise.resolve(false);
      }

      // 3. Mandate expiry.
      if (authority?.mandateExpiresAtMs !== undefined && nowMs > authority.mandateExpiresAtMs) {
        return Promise.resolve(false);
      }

      // 4. Authorization expiry.
      if (
        authority?.authorizationExpiresAtMs !== undefined &&
        nowMs > authority.authorizationExpiresAtMs
      ) {
        return Promise.resolve(false);
      }

      // 5. Wrong merchant scope.
      if (
        authority?.authorizedMerchantId !== undefined &&
        authority.authorizedMerchantId !== config.operatingMerchantId
      ) {
        return Promise.resolve(false);
      }

      // 6. Limits (per-transaction ceiling always; rolling window when a wallet
      //    is provided) via the REAL enforceTransactionLimits.
      const walletRef = authority?.walletId ?? request.idempotencyKey;
      const decision = enforceTransactionLimits(
        money(request.amountMinor, request.currency),
        deriveWalletId(walletRef),
        clock(),
        ledger,
        limitConfig,
      );
      if (!decision.allowed) {
        return Promise.resolve(false);
      }

      return Promise.resolve(true);
    },
  };
}

/** Test-only surface: the wallet-id derivation used for the rolling ledger. */
export const __testing = Object.freeze({ deriveWalletId });
