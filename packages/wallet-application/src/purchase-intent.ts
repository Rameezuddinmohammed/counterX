/**
 * Purchase intent builder.
 *
 * Takes an approved proposal and produces a CTP purchase intent with:
 * - mandateRef binding
 * - quoteDigest
 * - amount
 * - 15-minute max validity (never beyond quote expiry)
 * - Signed through SecureKeyStore using trust-protocol signEnvelope
 *
 * Idempotency key = hash(walletId + intentRef + quoteDigest)
 */

import { createHash } from "node:crypto";
import { CryptoIdGenerator } from "@counter/domain";
import type {
  PurchaseIntentPayload,
  UnsignedCtpEnvelope,
  CtpEnvelope,
  CtpEnvironment,
} from "@counter/trust-protocol";
import { buildUnsignedEnvelope, generateNonce, signEnvelope } from "@counter/trust-protocol";
import type { SecureKeyStore } from "@counter/wallet-domain";
import type { PurchaseProposal } from "./purchase-proposal.js";

// ---------------------------------------------------------------------------
// Constants
// ---------------------------------------------------------------------------

/** Maximum intent validity: 15 minutes */
const MAX_INTENT_VALIDITY_MS = 15 * 60 * 1000;

// ---------------------------------------------------------------------------
// Purchase Intent
// ---------------------------------------------------------------------------

export interface PurchaseIntent {
  readonly intentId: string;
  readonly walletId: string;
  readonly merchantId: string;
  readonly mandateId: string;
  readonly quoteId: string;
  readonly quoteDigest: string;
  readonly amountPaise: bigint;
  readonly currency: string;
  readonly idempotencyKey: string;
  readonly issuedAt: string;
  readonly expiresAt: string;
  readonly envelope: UnsignedCtpEnvelope<PurchaseIntentPayload>;
}

export interface SignedPurchaseIntent {
  readonly intent: PurchaseIntent;
  readonly signedEnvelope: CtpEnvelope<PurchaseIntentPayload>;
}

// ---------------------------------------------------------------------------
// Idempotency Key Derivation
// ---------------------------------------------------------------------------

export function deriveIntentIdempotencyKey(
  walletId: string,
  intentId: string,
  quoteDigest: string,
): string {
  const data = `${walletId}:${intentId}:${quoteDigest}`;
  return createHash("sha256").update(data).digest("base64url");
}

// ---------------------------------------------------------------------------
// Purchase Intent Builder
// ---------------------------------------------------------------------------

export class PurchaseIntentBuilder {
  readonly #keyStore: SecureKeyStore;
  readonly #idGenerator: CryptoIdGenerator;
  readonly #environment: CtpEnvironment;

  constructor(keyStore: SecureKeyStore, environment: CtpEnvironment = "sandbox") {
    this.#keyStore = keyStore;
    this.#idGenerator = new CryptoIdGenerator();
    this.#environment = environment;
  }

  /**
   * Builds a purchase intent from an approved proposal.
   * Enforces 15-minute max validity capped by quote expiry.
   */
  build(params: {
    readonly proposal: PurchaseProposal;
    readonly mandateId: string;
    readonly agentId: string;
    readonly quoteExpiresAt: string;
    readonly kid: string;
    readonly paymentReferenceId: string;
    readonly timestamp: string;
    readonly correlationId: string;
  }): PurchaseIntent {
    const {
      proposal,
      mandateId,
      agentId,
      quoteExpiresAt,
      kid,
      paymentReferenceId,
      timestamp,
      correlationId,
    } = params;

    const intentId = this.#idGenerator.generate("evidence");
    const issuedAt = timestamp;

    // Cap validity at 15 minutes or quote expiry, whichever is sooner
    const maxExpiry = new Date(
      new Date(timestamp).getTime() + MAX_INTENT_VALIDITY_MS,
    ).toISOString();
    const quoteExpiry = quoteExpiresAt;
    const expiresAt = maxExpiry < quoteExpiry ? maxExpiry : quoteExpiry;

    const idempotencyKey = deriveIntentIdempotencyKey(
      proposal.walletId,
      intentId,
      proposal.quoteDigest,
    );

    const nonce = generateNonce((length) => {
      const bytes = new Uint8Array(length);
      crypto.getRandomValues(bytes);
      return bytes;
    });

    const payload: PurchaseIntentPayload = {
      intent_id: intentId,
      mandate_id: mandateId,
      wallet_id: proposal.walletId,
      agent_id: agentId,
      merchant_id: proposal.merchantId,
      environment: this.#environment,
      operation: "purchase",
      trigger_type: "agent_initiated",
      items: [],
      quote_id: proposal.quoteId,
      quote_digest: proposal.quoteDigest,
      quote_issued_at: proposal.createdAt,
      quote_expires_at: quoteExpiresAt,
      currency: proposal.currency,
      max_amount: {
        amount: proposal.amountPaise.toString(),
        currency: proposal.currency,
      },
      payment_authorization_ref: paymentReferenceId,
      transaction_id: this.#idGenerator.generate("evidence"),
      client_idempotency_id: idempotencyKey,
      intent_expiry: expiresAt,
    };

    const envelopeResult = buildUnsignedEnvelope<PurchaseIntentPayload>({
      type: "counter.purchase-intent.v1",
      id: intentId,
      issuer: proposal.walletId,
      subject: proposal.merchantId,
      audience: [proposal.merchantId],
      environment: this.#environment,
      issued_at: issuedAt,
      not_before: issuedAt,
      expires_at: expiresAt,
      nonce,
      correlation_id: correlationId,
      payload,
      kid,
    });

    if (!envelopeResult.ok) {
      throw new Error(`Failed to build intent envelope: ${envelopeResult.error.message}`);
    }

    return {
      intentId,
      walletId: proposal.walletId,
      merchantId: proposal.merchantId,
      mandateId,
      quoteId: proposal.quoteId,
      quoteDigest: proposal.quoteDigest,
      amountPaise: proposal.amountPaise,
      currency: proposal.currency,
      idempotencyKey,
      issuedAt,
      expiresAt,
      envelope: envelopeResult.value,
    };
  }

  /**
   * Signs the purchase intent envelope using SecureKeyStore.
   * Creates a Signer adapter that delegates to the key store.
   */
  async sign(intent: PurchaseIntent, keyId: string): Promise<SignedPurchaseIntent> {
    // Get the public key descriptor to verify key exists
    const descriptor = await this.#keyStore.getPublicDescriptor(keyId);
    if (!descriptor) {
      throw new Error("Key not found in SecureKeyStore");
    }

    // Create a signer that delegates to the SecureKeyStore
    const keyStoreRef = this.#keyStore;
    const signer = {
      kid: keyId,
      async sign(message: Uint8Array): Promise<Uint8Array> {
        return keyStoreRef.sign(keyId, message);
      },
    };

    const signResult = await signEnvelope(intent.envelope, signer);
    if (!signResult.ok) {
      throw new Error(`Failed to sign intent envelope: ${signResult.error.message}`);
    }

    return {
      intent,
      signedEnvelope: signResult.value,
    };
  }
}
