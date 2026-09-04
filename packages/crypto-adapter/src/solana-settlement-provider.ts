/**
 * Implements `PaymentProvider` (@counter/payment-sdk) for the Solana devnet
 * settlement rail, backed by an injected `SolanaSettlementPort` — mirrors
 * razorpay-adapter's `RazorpayTestProvider` taking an `RazorpayHttpPort`:
 * this class never talks to the network directly, so unit tests inject a
 * hand-written mock port and never touch real devnet RPC.
 *
 * LIFECYCLE: `capabilities().lifecycleType` is `"direct_capture"` — a
 * `transferFixed` call is a single atomic on-chain instruction, there is no
 * separate authorize/capture step on this rail. This class deliberately
 * does NOT implement the optional `authorize`/`capture` methods on
 * `PaymentProvider` (leaving them `undefined`), which makes
 * apps/worker/src/real-lifecycle.ts's `authorizeCapture` helper correctly
 * fall through to `createInstruction` (confirmed by reading that helper
 * directly: it only takes the authorize+capture branch when
 * `payments.authorize !== undefined && payments.capture !== undefined`).
 *
 * DELIBERATE SIMPLIFICATION (stated plainly, not a silent bug):
 * `command.amount.amountMinor` — INR paise, per this system's Money
 * convention — is passed straight through to `SolanaSettlementPort
 * .transferFixed` as the smallest on-chain unit of `coordinates.tokenMint`,
 * with NO currency conversion and NO decimals adjustment. A real production
 * integration would need an FX + decimals layer between INR paise and
 * whatever stablecoin is actually used on-chain. This is a documented
 * hackathon shortcut scoped to this package, not something a caller should
 * assume is safe to rely on for real value.
 *
 * WHY NO CTP-SIGNED EVIDENCE ENVELOPE HERE (see types.ts's
 * `SolanaSettlementResult.signature` doc, which points back at this
 * paragraph): unlike CounterTestPaymentProvider, this provider's
 * `ProviderPaymentEvidence.providerData` carries a bare transaction
 * signature, not a CTP-signed envelope. A Solana devnet transaction
 * signature is independently, publicly verifiable against the chain itself
 * (any party can look it up on a devnet explorer or via `getSignatureStatus`)
 * — the ledger IS the evidence. A CTP envelope's job is to let a receiver
 * trust a claim from a party they can't independently verify; that
 * trust-bootstrapping problem does not exist here, so layering CTP signing
 * on top would add ceremony without adding trust. This is a deliberate
 * choice for this rail, not an oversight — a future rail without an
 * independently-verifiable ledger should NOT copy this omission without
 * re-deriving whether the same reasoning applies.
 *
 * NO RAW SIGNING KEYS: coordinates threaded through `command.metadata`
 * (via `decodeSolanaMetadata`) are exclusively public addresses/PDAs —
 * never a private key. The delegate signer that actually authorizes
 * `transferFixed` lives inside the injected `SolanaSettlementPort`
 * implementation (see real-solana-port.ts), not in this class or in
 * anything that crosses this class's public surface.
 */
import type { Instant, IsoCurrencyCode } from "@counter/domain";
import { createCanonicalError, instantFromEpochMilliseconds } from "@counter/domain";

import type {
  CreatePaymentInstruction,
  PaymentOperationResult,
  ProviderCapabilities,
  ProviderContext,
  ProviderPaymentEvidence,
  ProviderReference,
  ProviderRefundEvidence,
  ProviderRefundReference,
  RawClientReturn,
  RawWebhook,
  RefundCommand,
  UntrustedOrVerifiedReturn,
  VerifiedProviderEvent,
} from "@counter/payment-sdk";
import type { PaymentProvider } from "@counter/payment-sdk";

import type { SolanaSettlementPort } from "./solana-port.js";
import { decodeSolanaMetadata } from "./metadata-codec.js";

// ─── Constants ───────────────────────────────────────────────────────────────

// Devnet transactions typically confirm within a couple of seconds; this is
// a short re-query window, unlike Razorpay's 30s RETRY_AFTER_MS (a hosted
// checkout round trip is a much slower human-in-the-loop flow).
const QUERY_RETRY_AFTER_MS = 5_000;

// ─── Helpers ─────────────────────────────────────────────────────────────────

function nowInstant(clock: () => number): Instant {
  const result = instantFromEpochMilliseconds(clock());
  if (!result.ok) {
    throw new TypeError("Clock produced invalid instant");
  }
  return result.value;
}

function futureInstant(clock: () => number, offsetMs: number): Instant {
  const result = instantFromEpochMilliseconds(clock() + offsetMs);
  if (!result.ok) {
    throw new TypeError("Clock produced invalid future instant");
  }
  return result.value;
}

function notSupported(message: string): never {
  // Mirrors razorpay-provider.ts's authorize/capture/void-unsupported
  // pattern: a lifecycle operation this rail genuinely does not have, not a
  // transient failure — never retryable, never a payment outcome.
  throw createCanonicalError({
    code: "UNSUPPORTED_VALUE",
    category: "validation",
    message,
  });
}

// ─── SolanaSettlementProvider ────────────────────────────────────────────────

export interface SolanaSettlementProviderConfig {
  readonly port: SolanaSettlementPort;
  readonly clock?: () => number;
}

export class SolanaSettlementProvider implements PaymentProvider {
  readonly #port: SolanaSettlementPort;
  readonly #clock: () => number;

  public constructor(config: SolanaSettlementProviderConfig) {
    this.#port = config.port;
    this.#clock = config.clock ?? (() => Date.now());
  }

  public async capabilities(_context: ProviderContext): Promise<ProviderCapabilities> {
    return Object.freeze({
      methods: Object.freeze(["solana_fixed_delegation"]),
      currencies: Object.freeze(["INR" as IsoCurrencyCode]),
      lifecycleType: "direct_capture" as const,
      idempotency: true,
      webhookVerification: false,
      refundSupported: false,
    });
  }

  /**
   * Core settlement call. `command.metadata` must carry the
   * `FixedDelegationCoordinates` + receiver ATA produced at mandate-issuance
   * time (mandate-delegation.ts) via `encodeSolanaMetadata` — see this
   * file's header for the INR-paise-as-token-minor-units simplification.
   */
  public async createInstruction(
    command: CreatePaymentInstruction,
  ): Promise<PaymentOperationResult> {
    // Missing/malformed metadata is a genuine caller error (the worker
    // didn't thread through issuance-time coordinates), never a payment
    // outcome — decodeSolanaMetadata throws a canonical validation error.
    const { coordinates, receiverAta } = decodeSolanaMetadata(command.metadata);

    const outcome = await this.#port.transferFixed({
      coordinates,
      receiverAta,
      amountMinor: command.amount.amountMinor,
    });

    switch (outcome.kind) {
      case "landed": {
        const now = nowInstant(this.#clock);
        const evidence: ProviderPaymentEvidence = Object.freeze({
          reference: outcome.signature as ProviderReference,
          status: "confirmed" as const,
          confirmedAt: now,
          providerData: Object.freeze({
            signature: outcome.signature,
            chain: "solana-devnet",
            subscriptionAuthorityPda: coordinates.subscriptionAuthorityPda,
            fixedDelegationPda: coordinates.fixedDelegationPda,
            tokenMint: coordinates.tokenMint,
            delegateeAddress: coordinates.delegateeAddress,
            ...(outcome.remainingCapMinor !== undefined
              ? { remainingCapMinor: outcome.remainingCapMinor.toString() }
              : {}),
          }),
        });
        return Object.freeze({ kind: "confirmed" as const, evidence });
      }

      case "declined": {
        return Object.freeze({
          kind: "declined" as const,
          reason: Object.freeze({
            code: "SOLANA_TRANSFER_DECLINED",
            reason: outcome.reason,
            retryable: false,
          }),
        });
      }

      case "indeterminate": {
        // The transaction MAY have landed (a transport-level failure, per
        // solana-port.ts's SolanaTransferOutcome doc) — never a hard
        // failure. Re-query later via query() using the idempotency key as
        // a correlation reference (mirrors razorpay-provider.ts's identical
        // convention for its own transport-timeout branch).
        const queryAfter = futureInstant(this.#clock, QUERY_RETRY_AFTER_MS);
        return Object.freeze({
          kind: "indeterminate" as const,
          reference: command.idempotencyKey as ProviderReference,
          queryAfter,
        });
      }
    }
  }

  /**
   * The reference IS the on-chain transaction signature for this rail
   * (there is no separate provider-assigned order/payment id to look up).
   */
  public async query(reference: ProviderReference): Promise<ProviderPaymentEvidence> {
    const status = await this.#port.getSignatureStatus(reference);
    const now = nowInstant(this.#clock);

    switch (status) {
      case "confirmed":
      case "finalized":
        return Object.freeze({
          reference,
          status: "confirmed" as const,
          confirmedAt: now,
          providerData: Object.freeze({ signature: reference, chain: "solana-devnet" }),
        });
      case "not_found":
        // Not yet observed on-chain — not necessarily lost, just not
        // landed (or not landed YET). Never declared declined from absence
        // alone.
        return Object.freeze({ reference, status: "pending" as const });
      case "failed":
        return Object.freeze({ reference, status: "declined" as const });
    }
  }

  /**
   * This rail is unattended and atomic (see this file's header) — there is
   * no hosted checkout page for a buyer's browser to return from, so there
   * is no trustworthy client-side correlation signal to verify. Always
   * untrusted; callers rely on `createInstruction`'s/`query`'s own
   * authoritative evidence instead (same "correlation evidence only" rule
   * `UntrustedOrVerifiedReturn` documents for every provider).
   */
  public async verifyClientReturn(input: RawClientReturn): Promise<UntrustedOrVerifiedReturn> {
    const correlationId =
      input.queryParams["reference"] ?? input.queryParams["signature"] ?? "unknown";
    return Object.freeze({ kind: "untrusted" as const, correlationId });
  }

  /**
   * Not supported: a Solana transfer has no provider-side refund action. A
   * refund on this rail would be a NEW transfer in the opposite direction
   * (delegatee -> delegator, or merchant -> buyer, depending on who's
   * refunding whom) — out of scope for this settlement provider, which only
   * knows how to move funds along the direction its `FixedDelegation`
   * authorizes. A future refund flow should be its own explicit operation,
   * not a variant of this one.
   */
  public async refund(_command: RefundCommand): Promise<PaymentOperationResult> {
    return notSupported(
      "Solana settlement has no provider-side refund; a refund is a new transfer, not supported by this provider",
    );
  }

  public async queryRefund(_reference: ProviderRefundReference): Promise<ProviderRefundEvidence> {
    return notSupported("Solana settlement has no provider-side refund to query");
  }

  /**
   * Not supported: there is no webhook concept for a chain. On-chain state
   * is observed by polling (`query`/`getSignatureStatus`), not pushed to
   * this service by a provider.
   */
  public async verifyWebhook(_input: RawWebhook): Promise<VerifiedProviderEvent> {
    return notSupported("Solana settlement has no webhook concept; state is observed via query()");
  }

  // authorize/capture/void are intentionally NOT implemented (left
  // undefined) — see this file's header on why that is correct for a
  // direct_capture lifecycle, not an omission.
}
