import { describe, expect, it } from "vitest";
import { InMemorySecureKeyStore } from "@counter/wallet-domain";
import { PurchaseIntentBuilder, deriveIntentIdempotencyKey } from "./purchase-intent.js";
import type { PurchaseProposal } from "./purchase-proposal.js";

// ---------------------------------------------------------------------------
// Fixtures
// ---------------------------------------------------------------------------

function createTestProposal(): PurchaseProposal {
  return {
    proposalId: "prop-001",
    walletId: "wlt-test-001",
    merchantId: "merchant-001",
    quoteId: "quote-001",
    quoteDigest: "digest-abc123",
    amountPaise: 25000n,
    currency: "INR",
    precheckOutcome: "allowed",
    precheckReasons: [],
    policyVersionId: "policy-v1",
    mandateId: "mnd-test-001",
    idempotencyKey: "idem-key-001",
    createdAt: "2025-01-01T00:00:00.000Z",
  };
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe("deriveIntentIdempotencyKey", () => {
  it("produces deterministic keys for same inputs", () => {
    const key1 = deriveIntentIdempotencyKey("wlt-001", "intent-001", "digest-abc");
    const key2 = deriveIntentIdempotencyKey("wlt-001", "intent-001", "digest-abc");
    expect(key1).toBe(key2);
  });

  it("produces different keys for different inputs", () => {
    const key1 = deriveIntentIdempotencyKey("wlt-001", "intent-001", "digest-abc");
    const key2 = deriveIntentIdempotencyKey("wlt-002", "intent-001", "digest-abc");
    expect(key1).not.toBe(key2);
  });
});

describe("PurchaseIntentBuilder", () => {
  it("builds an intent with correct fields", () => {
    const keyStore = new InMemorySecureKeyStore();
    const builder = new PurchaseIntentBuilder(keyStore, "sandbox");

    const intent = builder.build({
      proposal: createTestProposal(),
      mandateId: "mnd-test-001",
      agentId: "agt-test-001",
      quoteExpiresAt: "2025-01-01T02:00:00.000Z",
      kid: "kid-001",
      paymentReferenceId: "ref-001",
      timestamp: "2025-01-01T00:00:00.000Z",
      correlationId: "corr-001",
    });

    expect(intent.walletId).toBe("wlt-test-001");
    expect(intent.merchantId).toBe("merchant-001");
    expect(intent.mandateId).toBe("mnd-test-001");
    expect(intent.quoteDigest).toBe("digest-abc123");
    expect(intent.amountPaise).toBe(25000n);
    expect(intent.currency).toBe("INR");
    expect(intent.idempotencyKey).toBeTruthy();
    expect(intent.envelope).toBeTruthy();
    expect(intent.envelope.type).toBe("counter.purchase-intent.v1");
  });

  it("enforces 15-minute max validity", () => {
    const keyStore = new InMemorySecureKeyStore();
    const builder = new PurchaseIntentBuilder(keyStore, "sandbox");

    const timestamp = "2025-01-01T00:00:00.000Z";
    const quoteExpiresAt = "2025-01-01T02:00:00.000Z"; // 2 hours from now

    const intent = builder.build({
      proposal: createTestProposal(),
      mandateId: "mnd-test-001",
      agentId: "agt-test-001",
      quoteExpiresAt,
      kid: "kid-001",
      paymentReferenceId: "ref-001",
      timestamp,
      correlationId: "corr-001",
    });

    // Should be capped at 15 minutes from issuance
    const expectedMaxExpiry = new Date(new Date(timestamp).getTime() + 15 * 60 * 1000).toISOString();
    expect(intent.expiresAt).toBe(expectedMaxExpiry);
  });

  it("caps validity at quote expiry when quote expires sooner", () => {
    const keyStore = new InMemorySecureKeyStore();
    const builder = new PurchaseIntentBuilder(keyStore, "sandbox");

    const timestamp = "2025-01-01T00:00:00.000Z";
    const quoteExpiresAt = "2025-01-01T00:05:00.000Z"; // Only 5 minutes

    const intent = builder.build({
      proposal: createTestProposal(),
      mandateId: "mnd-test-001",
      agentId: "agt-test-001",
      quoteExpiresAt,
      kid: "kid-001",
      paymentReferenceId: "ref-001",
      timestamp,
      correlationId: "corr-001",
    });

    // Should be capped at quote expiry since it is sooner than 15 minutes
    expect(intent.expiresAt).toBe(quoteExpiresAt);
  });

  it("signs intent via SecureKeyStore producing valid CTP envelope", async () => {
    const keyStore = new InMemorySecureKeyStore();
    const { keyId } = await keyStore.generateKey("intent-signing");
    const builder = new PurchaseIntentBuilder(keyStore, "sandbox");

    const intent = builder.build({
      proposal: createTestProposal(),
      mandateId: "mnd-test-001",
      agentId: "agt-test-001",
      quoteExpiresAt: "2025-01-01T02:00:00.000Z",
      kid: keyId,
      paymentReferenceId: "ref-001",
      timestamp: "2025-01-01T00:00:00.000Z",
      correlationId: "corr-001",
    });

    const signed = await builder.sign(intent, keyId);

    expect(signed.signedEnvelope).toBeTruthy();
    expect(signed.signedEnvelope.signature.value).toBeTruthy();
    expect(signed.signedEnvelope.signature.alg).toBe("EdDSA");
    expect(signed.signedEnvelope.signature.kid).toBe(keyId);
    expect(signed.signedEnvelope.type).toBe("counter.purchase-intent.v1");
  });

  it("sign throws when key is not found", async () => {
    const keyStore = new InMemorySecureKeyStore();
    const builder = new PurchaseIntentBuilder(keyStore, "sandbox");

    const intent = builder.build({
      proposal: createTestProposal(),
      mandateId: "mnd-test-001",
      agentId: "agt-test-001",
      quoteExpiresAt: "2025-01-01T02:00:00.000Z",
      kid: "nonexistent-kid",
      paymentReferenceId: "ref-001",
      timestamp: "2025-01-01T00:00:00.000Z",
      correlationId: "corr-001",
    });

    await expect(builder.sign(intent, "nonexistent-kid")).rejects.toThrow("Key not found");
  });
});
