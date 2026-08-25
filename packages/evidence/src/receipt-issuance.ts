/**
 * Receipt issuance service.
 *
 * Issues signed CTP envelopes for transaction receipts, projecting
 * audience-scoped views (merchant or wallet) while maintaining the
 * same canonical commitment digest across both views.
 *
 * Uses the full trust-protocol signing pipeline:
 *   buildUnsignedEnvelope -> signEnvelope
 */

import { randomBytes } from "node:crypto";
import type { CounterId, Instant, Result, Sha256Digest } from "@counter/domain";
import { ok } from "@counter/domain";
import type {
  CtpEnvironment,
  Signer,
  TransactionReceiptPayload,
} from "@counter/trust-protocol";
import {
  buildUnsignedEnvelope,
  generateNonce,
  signEnvelope,
} from "@counter/trust-protocol";
import { buildReceiptCommitment, computeCommitmentDigest } from "./receipt-commitment.js";
import type {
  MerchantReceiptView,
  ReceiptAudience,
  ReceiptIssuanceInput,
  ReceiptRecord,
  WalletReceiptView,
} from "./receipt-types.js";
import type { ReceiptStore } from "./receipt-store.js";

// ---------------------------------------------------------------------------
// Issuance Configuration
// ---------------------------------------------------------------------------

export interface ReceiptIssuanceConfig {
  readonly issuer: string;
  readonly environment: CtpEnvironment;
  readonly validityDurationMs: number;
}

// ---------------------------------------------------------------------------
// Issuance Service
// ---------------------------------------------------------------------------

export interface ReceiptIssuanceResult {
  readonly record: ReceiptRecord;
  readonly merchantView: MerchantReceiptView | undefined;
  readonly walletView: WalletReceiptView | undefined;
}

/**
 * Issues a receipt for the given audience.
 *
 * Computes the canonical commitment digest, builds the audience-scoped
 * payload, wraps in a CTP envelope, signs it, and stores the result.
 */
export async function issueReceipt(
  input: ReceiptIssuanceInput,
  audience: ReceiptAudience,
  receiptId: CounterId<"receipt">,
  signer: Signer,
  store: ReceiptStore,
  config: ReceiptIssuanceConfig,
  now: Instant,
): Promise<Result<ReceiptIssuanceResult>> {
  // 1. Compute canonical commitment
  const commitment = buildReceiptCommitment(input);
  const commitmentDigest = computeCommitmentDigest(commitment);

  // 2. Determine supersession (predecessor)
  const predecessor = store.getLatestByTransactionAndAudience(
    input.transactionId,
    audience,
  );
  const version = predecessor !== undefined ? predecessor.version + 1 : 1;
  const predecessorReceiptId = predecessor?.id;

  // 3. Build the receipt payload
  const payload = buildReceiptPayload(
    input,
    receiptId,
    commitmentDigest,
    predecessorReceiptId,
  );

  // 4. Build the audience subject
  const subject =
    audience === "merchant"
      ? `counter://merchant/${input.merchantId}`
      : `counter://wallet/${input.intentId}`;

  // 5. Build unsigned envelope
  const issuedAt = new Date(now).toISOString();
  const expiresAt = new Date(now + config.validityDurationMs).toISOString();
  const nonce = generateNonce((length) => randomBytes(length));

  const unsignedResult = buildUnsignedEnvelope<TransactionReceiptPayload>({
    type: "counter.transaction-receipt.v1",
    id: receiptId,
    issuer: config.issuer,
    subject,
    audience: [subject],
    environment: config.environment,
    issued_at: issuedAt,
    not_before: issuedAt,
    expires_at: expiresAt,
    nonce,
    correlation_id: input.transactionId,
    payload,
    kid: signer.kid,
  });

  if (!unsignedResult.ok) {
    return unsignedResult;
  }

  // 6. Sign the envelope
  const signedResult = await signEnvelope(unsignedResult.value, signer);
  if (!signedResult.ok) {
    return signedResult;
  }

  // 7. Build the receipt record
  const record: ReceiptRecord = {
    id: receiptId,
    transactionId: input.transactionId,
    audience,
    version,
    canonicalCommitmentDigest: commitmentDigest,
    receiptEnvelope: signedResult.value,
    predecessorReceiptId: predecessorReceiptId,
    issuedAt: now,
    signingKeyId: signer.kid,
  };

  // 8. Store the record
  const storeResult = store.append(record);
  if (!storeResult.ok) {
    return storeResult;
  }

  // 9. Build the audience-specific view
  const merchantView =
    audience === "merchant"
      ? buildMerchantView(input, receiptId, commitmentDigest, predecessorReceiptId)
      : undefined;

  const walletView =
    audience === "wallet"
      ? buildWalletView(input, receiptId, commitmentDigest, predecessorReceiptId)
      : undefined;

  return ok({ record: storeResult.value, merchantView, walletView });
}

// ---------------------------------------------------------------------------
// Internal Helpers
// ---------------------------------------------------------------------------

function buildReceiptPayload(
  input: ReceiptIssuanceInput,
  receiptId: CounterId<"receipt">,
  commitmentDigest: Sha256Digest,
  predecessorReceiptId: CounterId<"receipt"> | undefined,
): TransactionReceiptPayload {
  const base: TransactionReceiptPayload = {
    receipt_id: receiptId,
    transaction_id: input.transactionId,
    intent_id: input.intentId,
    merchant_id: input.merchantId,
    state_vector: buildStateVector(input),
    items: input.items,
    commercial_totals: input.commercialTotals,
    assurance_level: input.assuranceLevel,
    evidence_root_digest: commitmentDigest,
  };

  // Only include optional fields when they have values (exactOptionalPropertyTypes)
  const optional: Record<string, unknown> = {};
  if (input.mandateDigest !== undefined) {
    optional["mandate_summary"] = input.mandateDigest;
  }
  if (input.authorityDigest !== undefined) {
    optional["authority_digest"] = input.authorityDigest;
  }
  if (input.policyDecisionDigest !== undefined) {
    optional["policy_decision_digest"] = input.policyDecisionDigest;
  }
  if (input.paymentAuthorizationClass !== undefined) {
    optional["payment_authorization_class"] = input.paymentAuthorizationClass;
  }
  if (input.paymentProviderState !== undefined) {
    optional["payment_provider_state"] = input.paymentProviderState;
  }
  if (input.paymentEvidenceTime !== undefined) {
    optional["payment_evidence_time"] = input.paymentEvidenceTime;
  }
  if (input.orderState !== undefined) {
    optional["order_state"] = input.orderState;
  }
  if (input.fulfillmentState !== undefined) {
    optional["fulfillment_state"] = input.fulfillmentState;
  }
  if (input.refundState !== undefined) {
    optional["refund_state"] = input.refundState;
  }
  if (input.orderEvidenceTime !== undefined) {
    optional["order_evidence_time"] = input.orderEvidenceTime;
  }
  if (input.fulfillmentEvidenceTime !== undefined) {
    optional["fulfillment_evidence_time"] = input.fulfillmentEvidenceTime;
  }
  if (input.refundEvidenceTime !== undefined) {
    optional["refund_evidence_time"] = input.refundEvidenceTime;
  }
  if (input.findings.length > 0) {
    optional["findings"] = input.findings;
  }
  if (input.unresolvedLimitations.length > 0) {
    optional["unresolved_limitations"] = input.unresolvedLimitations;
  }
  if (predecessorReceiptId !== undefined) {
    optional["predecessor_receipt"] = predecessorReceiptId;
  }

  return { ...base, ...optional } as TransactionReceiptPayload;
}

function buildStateVector(
  input: ReceiptIssuanceInput,
): Record<string, string> {
  const vector: Record<string, string> = {
    orchestration: input.orchestrationPhase,
  };
  if (input.paymentState !== undefined) {
    vector["payment"] = input.paymentState;
  }
  if (input.orderState !== undefined) {
    vector["order"] = input.orderState;
  }
  if (input.fulfillmentState !== undefined) {
    vector["fulfillment"] = input.fulfillmentState;
  }
  if (input.returnState !== undefined) {
    vector["return"] = input.returnState;
  }
  if (input.refundState !== undefined) {
    vector["refund"] = input.refundState;
  }
  return vector;
}

function buildMerchantView(
  input: ReceiptIssuanceInput,
  receiptId: CounterId<"receipt">,
  commitmentDigest: Sha256Digest,
  predecessorReceiptId: CounterId<"receipt"> | undefined,
): MerchantReceiptView {
  return {
    receiptId,
    transactionId: input.transactionId,
    merchantId: input.merchantId,
    orchestrationPhase: input.orchestrationPhase,
    items: input.items,
    commercialTotals: input.commercialTotals,
    paymentState: input.paymentState,
    paymentEvidenceTime: input.paymentEvidenceTime,
    orderState: input.orderState,
    orderEvidenceTime: input.orderEvidenceTime,
    fulfillmentState: input.fulfillmentState,
    fulfillmentEvidenceTime: input.fulfillmentEvidenceTime,
    refundState: input.refundState,
    refundEvidenceTime: input.refundEvidenceTime,
    assuranceLevel: input.assuranceLevel,
    canonicalCommitmentDigest: commitmentDigest,
    predecessorReceiptId,
  };
}

function buildWalletView(
  input: ReceiptIssuanceInput,
  receiptId: CounterId<"receipt">,
  commitmentDigest: Sha256Digest,
  predecessorReceiptId: CounterId<"receipt"> | undefined,
): WalletReceiptView {
  return {
    receiptId,
    transactionId: input.transactionId,
    intentId: input.intentId,
    orchestrationPhase: input.orchestrationPhase,
    items: input.items,
    commercialTotals: input.commercialTotals,
    mandateSummary: input.mandateDigest,
    policyDecisionDigest: input.policyDecisionDigest,
    paymentAuthorizationClass: input.paymentAuthorizationClass,
    paymentState: input.paymentState,
    paymentEvidenceTime: input.paymentEvidenceTime,
    orderState: input.orderState,
    orderEvidenceTime: input.orderEvidenceTime,
    fulfillmentState: input.fulfillmentState,
    fulfillmentEvidenceTime: input.fulfillmentEvidenceTime,
    refundState: input.refundState,
    refundEvidenceTime: input.refundEvidenceTime,
    findingsSummary: {
      countBySeverity: input.findingsSeverityCounts,
      unresolvedIds: input.unresolvedLimitations,
    },
    assuranceLevel: input.assuranceLevel,
    canonicalCommitmentDigest: commitmentDigest,
    predecessorReceiptId,
  };
}
