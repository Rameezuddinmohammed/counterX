/**
 * Purchase proposal builder.
 *
 * Produces an effect-free PurchaseProposal from a precheck result + quote,
 * with a stable idempotency key derived from (walletId + merchantId +
 * quoteDigest + timestamp-bucket). Includes proposal signing via SecureKeyStore.
 */

import { createHash } from "node:crypto";
import type { CounterId } from "@counter/domain";
import type { SecureKeyStore } from "@counter/wallet-domain";
import type { MerchantQuote, PrecheckResult } from "./policy-precheck.js";

// ---------------------------------------------------------------------------
// Purchase Proposal
// ---------------------------------------------------------------------------

export interface PurchaseProposal {
  readonly proposalId: string;
  readonly walletId: string;
  readonly merchantId: string;
  readonly quoteId: string;
  readonly quoteDigest: string;
  readonly amountPaise: bigint;
  readonly currency: string;
  readonly precheckOutcome: "allowed" | "denied" | "review_required";
  readonly precheckReasons: readonly string[];
  readonly policyVersionId: string;
  readonly mandateId: string | undefined;
  readonly idempotencyKey: string;
  readonly createdAt: string;
  readonly signature?: string | undefined;
}

// ---------------------------------------------------------------------------
// Idempotency Key Generation
// ---------------------------------------------------------------------------

/** Time bucket: 5-minute windows for idempotency grouping */
const BUCKET_SIZE_MS = 5 * 60 * 1000;

/**
 * Derives a deterministic idempotency key from wallet, merchant, quote digest, and time bucket.
 */
export function deriveProposalIdempotencyKey(
  walletId: string,
  merchantId: string,
  quoteDigest: string,
  timestamp: string,
): string {
  const ts = new Date(timestamp).getTime();
  const bucket = Math.floor(ts / BUCKET_SIZE_MS);
  const data = `${walletId}:${merchantId}:${quoteDigest}:${bucket}`;
  return createHash("sha256").update(data).digest("base64url");
}

// ---------------------------------------------------------------------------
// Purchase Proposal Builder
// ---------------------------------------------------------------------------

export class PurchaseProposalBuilder {
  readonly #keyStore: SecureKeyStore;

  constructor(keyStore: SecureKeyStore) {
    this.#keyStore = keyStore;
  }

  /**
   * Builds a PurchaseProposal from a precheck result and a merchant quote.
   * The proposal is effect-free - it does not mutate any state.
   */
  build(params: {
    readonly walletId: CounterId<"wallet">;
    readonly quote: MerchantQuote;
    readonly precheckResult: PrecheckResult;
    readonly timestamp: string;
  }): PurchaseProposal {
    const { walletId, quote, precheckResult, timestamp } = params;

    const idempotencyKey = deriveProposalIdempotencyKey(
      walletId,
      quote.merchantId,
      quote.quoteDigest,
      timestamp,
    );

    const proposalId = createHash("sha256")
      .update(`proposal:${idempotencyKey}:${timestamp}`)
      .digest("base64url")
      .slice(0, 22);

    return {
      proposalId,
      walletId,
      merchantId: quote.merchantId,
      quoteId: quote.quoteId,
      quoteDigest: quote.quoteDigest,
      amountPaise: quote.totalAmountPaise,
      currency: quote.currency,
      precheckOutcome: precheckResult.outcome,
      precheckReasons: precheckResult.reasons,
      policyVersionId: precheckResult.policyVersionId,
      mandateId: precheckResult.mandateId,
      idempotencyKey,
      createdAt: timestamp,
    };
  }

  /**
   * Signs a proposal using the SecureKeyStore.
   * Returns the proposal with the signature field populated.
   */
  async sign(proposal: PurchaseProposal, keyId: string): Promise<PurchaseProposal> {
    const dataToSign = JSON.stringify({
      proposalId: proposal.proposalId,
      walletId: proposal.walletId,
      merchantId: proposal.merchantId,
      quoteDigest: proposal.quoteDigest,
      amountPaise: proposal.amountPaise.toString(),
      idempotencyKey: proposal.idempotencyKey,
    });

    const signatureBytes = await this.#keyStore.sign(keyId, new TextEncoder().encode(dataToSign));

    return {
      ...proposal,
      signature: Buffer.from(signatureBytes).toString("base64url"),
    };
  }
}
