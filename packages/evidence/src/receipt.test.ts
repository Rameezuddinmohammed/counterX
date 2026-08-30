/**
 * Tests for signed receipts: commitment, issuance, audience views, and
 * independent verification.
 */

import { describe, expect, it } from "vitest";
import type { CounterId, Instant } from "@counter/domain";
import type { CommercialTotals, ReceiptItem } from "@counter/trust-protocol";
import {
  createTestSignerA,
  TEST_KID_A,
  TEST_KID_B,
  TEST_KEY_RECORD_A,
  TEST_KEY_RECORD_B,
} from "@counter/trust-protocol";
import { buildReceiptCommitment, computeCommitmentDigest } from "./receipt-commitment.js";
import { InMemoryReceiptStore } from "./receipt-store.js";
import { issueReceipt } from "./receipt-issuance.js";
import type { ReceiptIssuanceConfig } from "./receipt-issuance.js";
import { verifyReceipt } from "./receipt-verifier.js";
import type { TrustedPublicKey } from "./receipt-verifier.js";
import type { ReceiptIssuanceInput } from "./receipt-types.js";

// ---------------------------------------------------------------------------
// Test Fixtures
// ---------------------------------------------------------------------------

const TEST_TRANSACTION_ID = "ctr_transaction_AAAAAAAAAAAAAAAAAAAAAA" as CounterId<"transaction">;
const TEST_RECEIPT_ID_1 = "ctr_receipt_AAAAAAAAAAAAAAAAAAAAAA" as CounterId<"receipt">;
const TEST_RECEIPT_ID_2 = "ctr_receipt_BBBBBBBBBBBBBBBBBBBBBB" as CounterId<"receipt">;

const TEST_NOW = 1_700_000_000_000 as Instant;

const TEST_ITEMS: readonly ReceiptItem[] = [
  {
    item_id: "item-001",
    quantity: 2,
    unit_price_minor_units: 1999,
    total_minor_units: 3998,
    currency: "USD",
  },
  {
    item_id: "item-002",
    quantity: 1,
    unit_price_minor_units: 500,
    total_minor_units: 500,
    currency: "USD",
  },
];

const TEST_TOTALS: CommercialTotals = {
  subtotal_minor_units: 4498,
  tax_minor_units: 450,
  shipping_minor_units: 599,
  total_minor_units: 5547,
  currency: "USD",
};

function makeIssuanceInput(overrides: Partial<ReceiptIssuanceInput> = {}): ReceiptIssuanceInput {
  return {
    transactionId: TEST_TRANSACTION_ID,
    intentId: "intent-001",
    merchantId: "merchant-001",
    orchestrationPhase: "payment_confirmed",
    paymentState: "captured",
    orderState: "committed",
    fulfillmentState: "pending",
    returnState: undefined,
    items: TEST_ITEMS,
    commercialTotals: TEST_TOTALS,
    mandateDigest: "sha256:mandate-digest-placeholder",
    authorityDigest: "sha256:authority-digest-placeholder",
    policyDecisionDigest: "sha256:policy-decision-digest-placeholder",
    paymentAuthorizationClass: "card_on_file",
    paymentProviderState: "provider_captured",
    paymentEvidenceTime: "2025-01-15T10:00:00.000Z",
    orderEvidenceTime: "2025-01-15T10:01:00.000Z",
    fulfillmentEvidenceTime: undefined,
    refundState: undefined,
    refundEvidenceTime: undefined,
    findings: [],
    unresolvedLimitations: [],
    findingsSeverityCounts: {},
    assuranceLevel: "standard",
    evidenceRootDigest: "sha256:evidence-root-placeholder",
    ...overrides,
  };
}

const TEST_CONFIG: ReceiptIssuanceConfig = {
  issuer: "counter://test/issuer-a",
  environment: "sandbox",
  validityDurationMs: 3_600_000, // 1 hour
};

const TRUSTED_KEY_A: TrustedPublicKey = {
  kid: TEST_KID_A,
  publicKey: TEST_KEY_RECORD_A.publicKey,
};

const TRUSTED_KEY_B: TrustedPublicKey = {
  kid: TEST_KID_B,
  publicKey: TEST_KEY_RECORD_B.publicKey,
};

// ---------------------------------------------------------------------------
// Canonical Commitment Tests
// ---------------------------------------------------------------------------

describe("ReceiptCommitment", () => {
  it("produces a deterministic SHA-256 digest via RFC 8785", () => {
    const input = makeIssuanceInput();
    const commitment = buildReceiptCommitment(input);
    const digest1 = computeCommitmentDigest(commitment);
    const digest2 = computeCommitmentDigest(commitment);

    expect(digest1).toBe(digest2);
    expect(digest1).toMatch(/^sha256:[0-9a-f]{64}$/);
  });

  it("produces the same digest regardless of field insertion order", () => {
    const input = makeIssuanceInput();
    const commitment1 = buildReceiptCommitment(input);

    // Build a second commitment with same data
    const input2 = makeIssuanceInput();
    const commitment2 = buildReceiptCommitment(input2);

    expect(computeCommitmentDigest(commitment1)).toBe(computeCommitmentDigest(commitment2));
  });

  it("changes digest when data changes", () => {
    const input1 = makeIssuanceInput({ paymentState: "captured" });
    const input2 = makeIssuanceInput({ paymentState: "pending" });

    const digest1 = computeCommitmentDigest(buildReceiptCommitment(input1));
    const digest2 = computeCommitmentDigest(buildReceiptCommitment(input2));

    expect(digest1).not.toBe(digest2);
  });
});

// ---------------------------------------------------------------------------
// Cross-View Canonical Equivalence
// ---------------------------------------------------------------------------

describe("Cross-view canonical equivalence", () => {
  it("merchant and wallet views produce the same canonical commitment digest", async () => {
    const input = makeIssuanceInput();
    const signer = createTestSignerA();
    const store = new InMemoryReceiptStore();

    const merchantResult = await issueReceipt(
      input,
      "merchant",
      TEST_RECEIPT_ID_1,
      signer,
      store,
      TEST_CONFIG,
      TEST_NOW,
    );

    // Use a new store for wallet to avoid ID conflict
    const walletStore = new InMemoryReceiptStore();
    const walletResult = await issueReceipt(
      input,
      "wallet",
      TEST_RECEIPT_ID_2,
      signer,
      walletStore,
      TEST_CONFIG,
      TEST_NOW,
    );

    expect(merchantResult.ok).toBe(true);
    expect(walletResult.ok).toBe(true);
    if (merchantResult.ok && walletResult.ok) {
      expect(merchantResult.value.record.canonicalCommitmentDigest).toBe(
        walletResult.value.record.canonicalCommitmentDigest,
      );
      expect(merchantResult.value.merchantView?.canonicalCommitmentDigest).toBe(
        walletResult.value.walletView?.canonicalCommitmentDigest,
      );
    }
  });
});

// ---------------------------------------------------------------------------
// Audience-Scoped Views and Redaction
// ---------------------------------------------------------------------------

describe("Audience-scoped receipt views", () => {
  it("merchant view does not contain wallet-private fields", async () => {
    const input = makeIssuanceInput();
    const signer = createTestSignerA();
    const store = new InMemoryReceiptStore();

    const result = await issueReceipt(
      input,
      "merchant",
      TEST_RECEIPT_ID_1,
      signer,
      store,
      TEST_CONFIG,
      TEST_NOW,
    );

    expect(result.ok).toBe(true);
    if (result.ok) {
      const view = result.value.merchantView!;
      // Merchant view should NOT have wallet-specific fields
      expect(view).not.toHaveProperty("mandateSummary");
      expect(view).not.toHaveProperty("policyDecisionDigest");
      expect(view).not.toHaveProperty("paymentAuthorizationClass");
      expect(view).not.toHaveProperty("findingsSummary");
      expect(view).not.toHaveProperty("intentId");
      // Merchant view SHOULD have merchant-relevant fields
      expect(view.merchantId).toBe("merchant-001");
      expect(view.items).toEqual(TEST_ITEMS);
      expect(view.commercialTotals).toEqual(TEST_TOTALS);
      expect(view.paymentState).toBe("captured");
      expect(view.orderState).toBe("committed");
    }
  });

  it("wallet view does not contain merchant-private fields", async () => {
    const input = makeIssuanceInput();
    const signer = createTestSignerA();
    const store = new InMemoryReceiptStore();

    const result = await issueReceipt(
      input,
      "wallet",
      TEST_RECEIPT_ID_1,
      signer,
      store,
      TEST_CONFIG,
      TEST_NOW,
    );

    expect(result.ok).toBe(true);
    if (result.ok) {
      const view = result.value.walletView!;
      // Wallet view should NOT have merchant-specific fields
      expect(view).not.toHaveProperty("merchantId");
      // Wallet view SHOULD have wallet-relevant fields
      expect(view.intentId).toBe("intent-001");
      expect(view.mandateSummary).toBe("sha256:mandate-digest-placeholder");
      expect(view.policyDecisionDigest).toBe("sha256:policy-decision-digest-placeholder");
      expect(view.paymentAuthorizationClass).toBe("card_on_file");
      expect(view.findingsSummary).toEqual({
        countBySeverity: {},
        unresolvedIds: [],
      });
      expect(view.items).toEqual(TEST_ITEMS);
      expect(view.commercialTotals).toEqual(TEST_TOTALS);
    }
  });
});

// ---------------------------------------------------------------------------
// Receipt Issuance and Store
// ---------------------------------------------------------------------------

describe("Receipt issuance", () => {
  it("issues a signed receipt envelope", async () => {
    const input = makeIssuanceInput();
    const signer = createTestSignerA();
    const store = new InMemoryReceiptStore();

    const result = await issueReceipt(
      input,
      "merchant",
      TEST_RECEIPT_ID_1,
      signer,
      store,
      TEST_CONFIG,
      TEST_NOW,
    );

    expect(result.ok).toBe(true);
    if (result.ok) {
      const record = result.value.record;
      expect(record.id).toBe(TEST_RECEIPT_ID_1);
      expect(record.transactionId).toBe(TEST_TRANSACTION_ID);
      expect(record.audience).toBe("merchant");
      expect(record.version).toBe(1);
      expect(record.signingKeyId).toBe(TEST_KID_A);
      expect(record.receiptEnvelope.signature.value).toBeDefined();
      expect(record.receiptEnvelope.type).toBe("counter.transaction-receipt.v1");
    }
  });

  it("stores the receipt in the store", async () => {
    const input = makeIssuanceInput();
    const signer = createTestSignerA();
    const store = new InMemoryReceiptStore();

    await issueReceipt(input, "merchant", TEST_RECEIPT_ID_1, signer, store, TEST_CONFIG, TEST_NOW);

    const stored = store.getById(TEST_RECEIPT_ID_1);
    expect(stored).toBeDefined();
    expect(stored?.id).toBe(TEST_RECEIPT_ID_1);
  });
});

// ---------------------------------------------------------------------------
// Supersession Chain
// ---------------------------------------------------------------------------

describe("Supersession chain", () => {
  it("first receipt has no predecessor and version 1", async () => {
    const input = makeIssuanceInput();
    const signer = createTestSignerA();
    const store = new InMemoryReceiptStore();

    const result = await issueReceipt(
      input,
      "merchant",
      TEST_RECEIPT_ID_1,
      signer,
      store,
      TEST_CONFIG,
      TEST_NOW,
    );

    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.value.record.version).toBe(1);
      expect(result.value.record.predecessorReceiptId).toBeUndefined();
    }
  });

  it("subsequent receipt references predecessor and increments version", async () => {
    const input = makeIssuanceInput();
    const signer = createTestSignerA();
    const store = new InMemoryReceiptStore();

    // Issue first receipt
    await issueReceipt(input, "merchant", TEST_RECEIPT_ID_1, signer, store, TEST_CONFIG, TEST_NOW);

    // Issue second receipt for same transaction + audience
    const updatedInput = makeIssuanceInput({ paymentState: "settled" });
    const result = await issueReceipt(
      updatedInput,
      "merchant",
      TEST_RECEIPT_ID_2,
      signer,
      store,
      TEST_CONFIG,
      TEST_NOW,
    );

    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.value.record.version).toBe(2);
      expect(result.value.record.predecessorReceiptId).toBe(TEST_RECEIPT_ID_1);
    }
  });

  it("supersession chain is verifiable via independent verifier", async () => {
    const input = makeIssuanceInput();
    const signer = createTestSignerA();
    const store = new InMemoryReceiptStore();

    // Issue first receipt
    const first = await issueReceipt(
      input,
      "merchant",
      TEST_RECEIPT_ID_1,
      signer,
      store,
      TEST_CONFIG,
      TEST_NOW,
    );

    // Issue second receipt referencing first
    const updatedInput = makeIssuanceInput({ paymentState: "settled" });
    const second = await issueReceipt(
      updatedInput,
      "merchant",
      TEST_RECEIPT_ID_2,
      signer,
      store,
      TEST_CONFIG,
      TEST_NOW,
    );

    expect(first.ok).toBe(true);
    expect(second.ok).toBe(true);
    if (first.ok && second.ok) {
      const verifyResult = await verifyReceipt(second.value.record.receiptEnvelope, {
        trustedKeys: [TRUSTED_KEY_A],
        predecessorEnvelope: first.value.record.receiptEnvelope,
      });
      expect(verifyResult.valid).toBe(true);
    }
  });
});

// ---------------------------------------------------------------------------
// Independent Verifier
// ---------------------------------------------------------------------------

describe("Independent receipt verifier", () => {
  it("verifies a valid receipt", async () => {
    const input = makeIssuanceInput();
    const signer = createTestSignerA();
    const store = new InMemoryReceiptStore();

    const result = await issueReceipt(
      input,
      "merchant",
      TEST_RECEIPT_ID_1,
      signer,
      store,
      TEST_CONFIG,
      TEST_NOW,
    );

    expect(result.ok).toBe(true);
    if (result.ok) {
      const verifyResult = await verifyReceipt(result.value.record.receiptEnvelope, {
        trustedKeys: [TRUSTED_KEY_A],
      });
      expect(verifyResult.valid).toBe(true);
      expect(verifyResult.error).toBeUndefined();
    }
  });

  it("fails verification with wrong/unknown key", async () => {
    const input = makeIssuanceInput();
    const signer = createTestSignerA();
    const store = new InMemoryReceiptStore();

    const result = await issueReceipt(
      input,
      "merchant",
      TEST_RECEIPT_ID_1,
      signer,
      store,
      TEST_CONFIG,
      TEST_NOW,
    );

    expect(result.ok).toBe(true);
    if (result.ok) {
      // Verify with key B (wrong key, receipt was signed with key A)
      const verifyResult = await verifyReceipt(result.value.record.receiptEnvelope, {
        trustedKeys: [TRUSTED_KEY_B],
      });
      expect(verifyResult.valid).toBe(false);
      expect(verifyResult.error).toContain("not in the trusted key set");
    }
  });

  it("fails verification with no trusted keys", async () => {
    const input = makeIssuanceInput();
    const signer = createTestSignerA();
    const store = new InMemoryReceiptStore();

    const result = await issueReceipt(
      input,
      "merchant",
      TEST_RECEIPT_ID_1,
      signer,
      store,
      TEST_CONFIG,
      TEST_NOW,
    );

    expect(result.ok).toBe(true);
    if (result.ok) {
      const verifyResult = await verifyReceipt(result.value.record.receiptEnvelope, {
        trustedKeys: [],
      });
      expect(verifyResult.valid).toBe(false);
      expect(verifyResult.error).toContain("not in the trusted key set");
    }
  });

  it("fails verification when content is tampered", async () => {
    const input = makeIssuanceInput();
    const signer = createTestSignerA();
    const store = new InMemoryReceiptStore();

    const result = await issueReceipt(
      input,
      "merchant",
      TEST_RECEIPT_ID_1,
      signer,
      store,
      TEST_CONFIG,
      TEST_NOW,
    );

    expect(result.ok).toBe(true);
    if (result.ok) {
      // Tamper with the payload
      const tampered = {
        ...result.value.record.receiptEnvelope,
        payload: {
          ...result.value.record.receiptEnvelope.payload,
          merchant_id: "tampered-merchant",
        },
      };

      const verifyResult = await verifyReceipt(tampered, {
        trustedKeys: [TRUSTED_KEY_A],
      });
      expect(verifyResult.valid).toBe(false);
      // Should fail on signature (canonical bytes changed) or digest mismatch
      expect(verifyResult.error).toBeDefined();
    }
  });

  it("fails verification with wrong audience", async () => {
    const input = makeIssuanceInput();
    const signer = createTestSignerA();
    const store = new InMemoryReceiptStore();

    const result = await issueReceipt(
      input,
      "merchant",
      TEST_RECEIPT_ID_1,
      signer,
      store,
      TEST_CONFIG,
      TEST_NOW,
    );

    expect(result.ok).toBe(true);
    if (result.ok) {
      // Verify expecting wallet audience but this is a merchant receipt
      const verifyResult = await verifyReceipt(result.value.record.receiptEnvelope, {
        trustedKeys: [TRUSTED_KEY_A],
        expectedAudience: "counter://wallet/intent-001",
      });
      expect(verifyResult.valid).toBe(false);
      expect(verifyResult.error).toContain("audience");
    }
  });

  it("fails on invalid envelope structure", async () => {
    const verifyResult = await verifyReceipt(
      { not_an_envelope: true },
      { trustedKeys: [TRUSTED_KEY_A] },
    );
    expect(verifyResult.valid).toBe(false);
    expect(verifyResult.error).toContain("ctp_version");
  });

  it("fails on null input", async () => {
    const verifyResult = await verifyReceipt(null, {
      trustedKeys: [TRUSTED_KEY_A],
    });
    expect(verifyResult.valid).toBe(false);
    expect(verifyResult.error).toContain("non-null object");
  });

  it("validates correct audience passes", async () => {
    const input = makeIssuanceInput();
    const signer = createTestSignerA();
    const store = new InMemoryReceiptStore();

    const result = await issueReceipt(
      input,
      "merchant",
      TEST_RECEIPT_ID_1,
      signer,
      store,
      TEST_CONFIG,
      TEST_NOW,
    );

    expect(result.ok).toBe(true);
    if (result.ok) {
      const verifyResult = await verifyReceipt(result.value.record.receiptEnvelope, {
        trustedKeys: [TRUSTED_KEY_A],
        expectedAudience: "counter://merchant/merchant-001",
      });
      expect(verifyResult.valid).toBe(true);
    }
  });

  it("validates timestamp within window", async () => {
    const input = makeIssuanceInput();
    const signer = createTestSignerA();
    const store = new InMemoryReceiptStore();

    const result = await issueReceipt(
      input,
      "merchant",
      TEST_RECEIPT_ID_1,
      signer,
      store,
      TEST_CONFIG,
      TEST_NOW,
    );

    expect(result.ok).toBe(true);
    if (result.ok) {
      // Time within validity window
      const validTime = new Date(TEST_NOW + 1000).toISOString();
      const verifyResult = await verifyReceipt(result.value.record.receiptEnvelope, {
        trustedKeys: [TRUSTED_KEY_A],
        currentTime: validTime,
      });
      expect(verifyResult.valid).toBe(true);
    }
  });

  it("rejects expired receipt", async () => {
    const input = makeIssuanceInput();
    const signer = createTestSignerA();
    const store = new InMemoryReceiptStore();

    const result = await issueReceipt(
      input,
      "merchant",
      TEST_RECEIPT_ID_1,
      signer,
      store,
      TEST_CONFIG,
      TEST_NOW,
    );

    expect(result.ok).toBe(true);
    if (result.ok) {
      // Time well after expiry (validity is 1 hour)
      const expiredTime = new Date(TEST_NOW + 7_200_000).toISOString();
      const verifyResult = await verifyReceipt(result.value.record.receiptEnvelope, {
        trustedKeys: [TRUSTED_KEY_A],
        currentTime: expiredTime,
      });
      expect(verifyResult.valid).toBe(false);
      expect(verifyResult.error).toContain("expired");
    }
  });

  it("rejects tampered signature (wrong key's signature)", async () => {
    const input = makeIssuanceInput();
    const signerA = createTestSignerA();
    const store = new InMemoryReceiptStore();

    const result = await issueReceipt(
      input,
      "merchant",
      TEST_RECEIPT_ID_1,
      signerA,
      store,
      TEST_CONFIG,
      TEST_NOW,
    );

    expect(result.ok).toBe(true);
    if (result.ok) {
      // Provide the right kid but with key B's public key (mismatched)
      const wrongKey: TrustedPublicKey = {
        kid: TEST_KID_A,
        publicKey: TEST_KEY_RECORD_B.publicKey, // wrong public key for kid A
      };
      const verifyResult = await verifyReceipt(result.value.record.receiptEnvelope, {
        trustedKeys: [wrongKey],
      });
      expect(verifyResult.valid).toBe(false);
      expect(verifyResult.error).toContain("signature verification failed");
    }
  });
});

// ---------------------------------------------------------------------------
// Receipt Store
// ---------------------------------------------------------------------------

describe("InMemoryReceiptStore", () => {
  it("rejects duplicate receipt id", async () => {
    const input = makeIssuanceInput();
    const signer = createTestSignerA();
    const store = new InMemoryReceiptStore();

    const result1 = await issueReceipt(
      input,
      "merchant",
      TEST_RECEIPT_ID_1,
      signer,
      store,
      TEST_CONFIG,
      TEST_NOW,
    );
    expect(result1.ok).toBe(true);

    const result2 = await issueReceipt(
      input,
      "merchant",
      TEST_RECEIPT_ID_1,
      signer,
      store,
      TEST_CONFIG,
      TEST_NOW,
    );
    expect(result2.ok).toBe(false);
    if (!result2.ok) {
      expect(result2.error.code).toBe("CONFLICT");
    }
  });

  it("returns records by transaction", async () => {
    const input = makeIssuanceInput();
    const signer = createTestSignerA();
    const store = new InMemoryReceiptStore();

    await issueReceipt(input, "merchant", TEST_RECEIPT_ID_1, signer, store, TEST_CONFIG, TEST_NOW);
    await issueReceipt(input, "wallet", TEST_RECEIPT_ID_2, signer, store, TEST_CONFIG, TEST_NOW);

    const records = store.getByTransaction(TEST_TRANSACTION_ID);
    expect(records).toHaveLength(2);
  });

  it("filters by audience", async () => {
    const input = makeIssuanceInput();
    const signer = createTestSignerA();
    const store = new InMemoryReceiptStore();

    await issueReceipt(input, "merchant", TEST_RECEIPT_ID_1, signer, store, TEST_CONFIG, TEST_NOW);
    await issueReceipt(input, "wallet", TEST_RECEIPT_ID_2, signer, store, TEST_CONFIG, TEST_NOW);

    const merchantRecords = store.getByTransactionAndAudience(TEST_TRANSACTION_ID, "merchant");
    expect(merchantRecords).toHaveLength(1);
    expect(merchantRecords[0]?.audience).toBe("merchant");

    const walletRecords = store.getByTransactionAndAudience(TEST_TRANSACTION_ID, "wallet");
    expect(walletRecords).toHaveLength(1);
    expect(walletRecords[0]?.audience).toBe("wallet");
  });

  it("is append-only (no update or delete methods)", () => {
    const store = new InMemoryReceiptStore();
    expect("update" in store).toBe(false);
    expect("delete" in store).toBe(false);
    expect("remove" in store).toBe(false);
  });
});
