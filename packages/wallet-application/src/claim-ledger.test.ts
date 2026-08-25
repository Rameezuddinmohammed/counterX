/**
 * Tests for ClaimLedger.
 *
 * Covers: claim recording by source, receipt consumption and verification
 * (valid receipt passes, wrong audience fails, invalid signature fails,
 * broken chain fails, expired receipt fails).
 */

import { describe, it, expect } from "vitest";
import { ClaimLedger } from "./claim-ledger.js";
import type { ClaimSourceType } from "./claim-ledger.js";
import type { TrustedPublicKey } from "@counter/evidence";
import {
  createTestSignerA,
  createTestSignerB,
  createTestUnsignedEnvelope,
  signEnvelope,
  TEST_KEY_RECORD_A,
} from "@counter/trust-protocol";

// ---------------------------------------------------------------------------
// Test Helpers
// ---------------------------------------------------------------------------

const TRUSTED_KEY_A: TrustedPublicKey = {
  kid: TEST_KEY_RECORD_A.kid,
  publicKey: TEST_KEY_RECORD_A.publicKey,
};

async function makeSignedEnvelope(options?: {
  audience?: readonly string[];
  expiresAt?: string;
  notBefore?: string;
  id?: string;
  payload?: Record<string, unknown>;
}) {
  const signer = createTestSignerA();
  const unsigned = createTestUnsignedEnvelope({
    audience: options?.audience ?? ["counter://wallet/test-wallet-001"],
    expiresAt: options?.expiresAt ?? "2030-12-31T23:59:59.999Z",
    notBefore: options?.notBefore ?? "2024-01-01T00:00:00.000Z",
    id: options?.id ?? "receipt-test-001",
    payload: options?.payload ?? { transaction_id: "txn-001", amount: 5000 },
  });
  const result = await signEnvelope(unsigned, signer);
  if (!result.ok) throw new Error("Failed to sign envelope");
  return result.value;
}

async function makeSignedEnvelopeWithKeyB(options?: {
  audience?: readonly string[];
  id?: string;
}) {
  const signer = createTestSignerB();
  const unsigned = createTestUnsignedEnvelope({
    audience: options?.audience ?? ["counter://wallet/test-wallet-001"],
    id: options?.id ?? "receipt-test-keyb",
    kid: signer.kid,
  });
  const result = await signEnvelope(unsigned, signer);
  if (!result.ok) throw new Error("Failed to sign envelope with key B");
  return result.value;
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe("ClaimLedger", () => {
  describe("claim recording by source", () => {
    it("records a claim with model_request source type", () => {
      const ledger = new ClaimLedger();
      const result = ledger.record({
        claimId: "claim-001",
        sourceType: "model_request",
        sourceId: "req-001",
        data: { prompt: "Buy widgets" },
      });

      expect(result.ok).toBe(true);
      if (!result.ok) return;
      expect(result.value.claimId).toBe("claim-001");
      expect(result.value.sourceType).toBe("model_request");
      expect(result.value.sourceId).toBe("req-001");
      expect(result.value.verified).toBe(false);
    });

    it("records claims from all source types", () => {
      const ledger = new ClaimLedger();
      const sourceTypes: ClaimSourceType[] = [
        "model_request",
        "model_proposal",
        "model_decision",
        "intent",
        "merchant_response",
        "provider_evidence",
      ];

      for (const [index, sourceType] of sourceTypes.entries()) {
        const result = ledger.record({
          claimId: `claim-${index}`,
          sourceType,
          sourceId: `src-${index}`,
          data: { type: sourceType },
        });
        expect(result.ok).toBe(true);
      }

      expect(ledger.getAll()).toHaveLength(6);
    });

    it("retrieves claims by source type", () => {
      const ledger = new ClaimLedger();
      ledger.record({ claimId: "c1", sourceType: "intent", sourceId: "i1", data: {} });
      ledger.record({ claimId: "c2", sourceType: "intent", sourceId: "i2", data: {} });
      ledger.record({ claimId: "c3", sourceType: "model_request", sourceId: "r1", data: {} });

      const intentClaims = ledger.getBySource("intent");
      expect(intentClaims).toHaveLength(2);
    });

    it("returns existing claim on duplicate claimId (idempotent)", () => {
      const ledger = new ClaimLedger();
      ledger.record({
        claimId: "claim-001",
        sourceType: "model_request",
        sourceId: "req-001",
        data: { first: true },
      });

      const result = ledger.record({
        claimId: "claim-001",
        sourceType: "model_proposal",
        sourceId: "req-002",
        data: { second: true },
      });

      expect(result.ok).toBe(true);
      if (!result.ok) return;
      // Returns the original claim
      expect(result.value.sourceType).toBe("model_request");
    });
  });

  describe("receipt consumption and verification", () => {
    it("valid receipt passes verification", async () => {
      const ledger = new ClaimLedger();
      ledger.record({
        claimId: "claim-receipt-001",
        sourceType: "provider_evidence",
        sourceId: "ev-001",
        data: { amount: 5000 },
      });

      const signedEnvelope = await makeSignedEnvelope();

      const result = await ledger.consumeReceipt({
        claimId: "claim-receipt-001",
        receiptEnvelope: signedEnvelope,
        expectedAudience: "counter://wallet/test-wallet-001",
        trustedKeys: [TRUSTED_KEY_A],
        currentTime: "2025-06-01T00:00:00.000Z",
      });

      expect(result.ok).toBe(true);
      if (!result.ok) return;
      expect(result.value.verificationResult.valid).toBe(true);
      expect(result.value.audience).toBe("counter://wallet/test-wallet-001");

      // Claim should be marked verified
      const claim = ledger.get("claim-receipt-001");
      expect(claim?.verified).toBe(true);
    });

    it("wrong audience fails verification", async () => {
      const ledger = new ClaimLedger();
      ledger.record({
        claimId: "claim-002",
        sourceType: "provider_evidence",
        sourceId: "ev-002",
        data: {},
      });

      const signedEnvelope = await makeSignedEnvelope({
        audience: ["counter://wallet/other-wallet"],
      });

      const result = await ledger.consumeReceipt({
        claimId: "claim-002",
        receiptEnvelope: signedEnvelope,
        expectedAudience: "counter://wallet/test-wallet-001",
        trustedKeys: [TRUSTED_KEY_A],
      });

      expect(result.ok).toBe(false);
      if (result.ok) return;
      expect(result.error.reason).toContain("audience");
    });

    it("invalid signature fails verification (untrusted key)", async () => {
      const ledger = new ClaimLedger();
      ledger.record({
        claimId: "claim-003",
        sourceType: "provider_evidence",
        sourceId: "ev-003",
        data: {},
      });

      // Sign with key B but only trust key A
      const signedEnvelope = await makeSignedEnvelopeWithKeyB();

      const result = await ledger.consumeReceipt({
        claimId: "claim-003",
        receiptEnvelope: signedEnvelope,
        expectedAudience: "counter://wallet/test-wallet-001",
        trustedKeys: [TRUSTED_KEY_A], // Only trust A, not B
      });

      expect(result.ok).toBe(false);
      if (result.ok) return;
      expect(result.error.reason).toContain("not in the trusted key set");
    });

    it("broken chain fails verification", async () => {
      const ledger = new ClaimLedger();
      ledger.record({
        claimId: "claim-004",
        sourceType: "provider_evidence",
        sourceId: "ev-004",
        data: {},
      });

      const current = await makeSignedEnvelope({
        id: "receipt-current",
        payload: { transaction_id: "txn-001", amount: 5000 },
      });

      // Predecessor with different id than what current references
      const predecessor = await makeSignedEnvelope({
        id: "receipt-predecessor-wrong",
        payload: { transaction_id: "txn-001", amount: 5000 },
      });

      const result = await ledger.consumeReceipt({
        claimId: "claim-004",
        receiptEnvelope: current,
        expectedAudience: "counter://wallet/test-wallet-001",
        trustedKeys: [TRUSTED_KEY_A],
        predecessorEnvelope: predecessor,
      });

      expect(result.ok).toBe(false);
      if (result.ok) return;
      expect(result.error.reason).toContain("predecessor");
    });

    it("expired receipt fails verification", async () => {
      const ledger = new ClaimLedger();
      ledger.record({
        claimId: "claim-005",
        sourceType: "provider_evidence",
        sourceId: "ev-005",
        data: {},
      });

      const signedEnvelope = await makeSignedEnvelope({
        expiresAt: "2024-01-01T00:00:00.000Z",
        notBefore: "2023-01-01T00:00:00.000Z",
      });

      const result = await ledger.consumeReceipt({
        claimId: "claim-005",
        receiptEnvelope: signedEnvelope,
        expectedAudience: "counter://wallet/test-wallet-001",
        trustedKeys: [TRUSTED_KEY_A],
        currentTime: "2025-06-01T00:00:00.000Z", // After expiry
      });

      expect(result.ok).toBe(false);
      if (result.ok) return;
      expect(result.error.reason).toContain("expired");
    });

    it("claim is not marked verified on failed receipt", async () => {
      const ledger = new ClaimLedger();
      ledger.record({
        claimId: "claim-006",
        sourceType: "provider_evidence",
        sourceId: "ev-006",
        data: {},
      });

      const signedEnvelope = await makeSignedEnvelope({
        audience: ["counter://wallet/wrong-wallet"],
      });

      await ledger.consumeReceipt({
        claimId: "claim-006",
        receiptEnvelope: signedEnvelope,
        expectedAudience: "counter://wallet/test-wallet-001",
        trustedKeys: [TRUSTED_KEY_A],
      });

      const claim = ledger.get("claim-006");
      expect(claim?.verified).toBe(false);
    });
  });
});
