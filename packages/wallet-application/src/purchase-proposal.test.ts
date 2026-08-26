import { describe, expect, it } from "vitest";
import { InMemorySecureKeyStore } from "@counter/wallet-domain";
import {
  PurchaseProposalBuilder,
  deriveProposalIdempotencyKey,
} from "./purchase-proposal.js";
import type { MerchantQuote, PrecheckResult } from "./policy-precheck.js";

// ---------------------------------------------------------------------------
// Fixtures
// ---------------------------------------------------------------------------

function createTestQuote(): MerchantQuote {
  return {
    quoteId: "quote-001",
    merchantId: "merchant-001",
    merchantCountry: "IN",
    deliveryCountry: "IN",
    currency: "INR",
    totalAmountPaise: 25000n,
    expiresAt: "2025-01-01T01:00:00.000Z",
    quoteDigest: "digest-abc123",
  };
}

function createTestPrecheckResult(): PrecheckResult {
  return {
    outcome: "allowed",
    reasons: [],
    policyVersionId: "policy-v1",
    mandateId: "mnd-test-001",
    evaluatedAt: "2025-01-01T00:00:00.000Z",
  };
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe("deriveProposalIdempotencyKey", () => {
  it("produces deterministic keys for same inputs", () => {
    const key1 = deriveProposalIdempotencyKey(
      "wlt-001",
      "merchant-001",
      "digest-abc123",
      "2025-01-01T00:02:00.000Z",
    );
    const key2 = deriveProposalIdempotencyKey(
      "wlt-001",
      "merchant-001",
      "digest-abc123",
      "2025-01-01T00:02:00.000Z",
    );

    expect(key1).toBe(key2);
  });

  it("produces same key within same 5-minute bucket", () => {
    const key1 = deriveProposalIdempotencyKey(
      "wlt-001",
      "merchant-001",
      "digest-abc123",
      "2025-01-01T00:01:00.000Z",
    );
    const key2 = deriveProposalIdempotencyKey(
      "wlt-001",
      "merchant-001",
      "digest-abc123",
      "2025-01-01T00:04:00.000Z",
    );

    expect(key1).toBe(key2);
  });

  it("produces different keys for different time buckets", () => {
    const key1 = deriveProposalIdempotencyKey(
      "wlt-001",
      "merchant-001",
      "digest-abc123",
      "2025-01-01T00:01:00.000Z",
    );
    const key2 = deriveProposalIdempotencyKey(
      "wlt-001",
      "merchant-001",
      "digest-abc123",
      "2025-01-01T00:06:00.000Z",
    );

    expect(key1).not.toBe(key2);
  });

  it("produces different keys for different wallets", () => {
    const key1 = deriveProposalIdempotencyKey(
      "wlt-001",
      "merchant-001",
      "digest-abc123",
      "2025-01-01T00:01:00.000Z",
    );
    const key2 = deriveProposalIdempotencyKey(
      "wlt-002",
      "merchant-001",
      "digest-abc123",
      "2025-01-01T00:01:00.000Z",
    );

    expect(key1).not.toBe(key2);
  });
});

describe("PurchaseProposalBuilder", () => {
  it("builds a proposal with correct fields", () => {
    const keyStore = new InMemorySecureKeyStore();
    const builder = new PurchaseProposalBuilder(keyStore);

    const proposal = builder.build({
      walletId: "wlt-test-001" as any,
      quote: createTestQuote(),
      precheckResult: createTestPrecheckResult(),
      timestamp: "2025-01-01T00:00:00.000Z",
    });

    expect(proposal.walletId).toBe("wlt-test-001");
    expect(proposal.merchantId).toBe("merchant-001");
    expect(proposal.quoteId).toBe("quote-001");
    expect(proposal.quoteDigest).toBe("digest-abc123");
    expect(proposal.amountPaise).toBe(25000n);
    expect(proposal.currency).toBe("INR");
    expect(proposal.precheckOutcome).toBe("allowed");
    expect(proposal.policyVersionId).toBe("policy-v1");
    expect(proposal.mandateId).toBe("mnd-test-001");
    expect(proposal.idempotencyKey).toBeTruthy();
    expect(proposal.createdAt).toBe("2025-01-01T00:00:00.000Z");
  });

  it("produces stable idempotency keys for same inputs", () => {
    const keyStore = new InMemorySecureKeyStore();
    const builder = new PurchaseProposalBuilder(keyStore);

    const params = {
      walletId: "wlt-test-001" as any,
      quote: createTestQuote(),
      precheckResult: createTestPrecheckResult(),
      timestamp: "2025-01-01T00:00:00.000Z",
    };

    const proposal1 = builder.build(params);
    const proposal2 = builder.build(params);

    expect(proposal1.idempotencyKey).toBe(proposal2.idempotencyKey);
  });

  it("signs a proposal via SecureKeyStore", async () => {
    const keyStore = new InMemorySecureKeyStore();
    const { keyId } = await keyStore.generateKey("proposal-signing");
    const builder = new PurchaseProposalBuilder(keyStore);

    const proposal = builder.build({
      walletId: "wlt-test-001" as any,
      quote: createTestQuote(),
      precheckResult: createTestPrecheckResult(),
      timestamp: "2025-01-01T00:00:00.000Z",
    });

    const signed = await builder.sign(proposal, keyId);

    expect(signed.signature).toBeTruthy();
    expect(signed.signature!.length).toBeGreaterThan(0);
  });

  it("sign throws when key store is locked", async () => {
    const keyStore = new InMemorySecureKeyStore();
    const { keyId } = await keyStore.generateKey("proposal-signing");
    const builder = new PurchaseProposalBuilder(keyStore);

    const proposal = builder.build({
      walletId: "wlt-test-001" as any,
      quote: createTestQuote(),
      precheckResult: createTestPrecheckResult(),
      timestamp: "2025-01-01T00:00:00.000Z",
    });

    keyStore.lockStore();

    await expect(builder.sign(proposal, keyId)).rejects.toThrow("locked");
  });
});
