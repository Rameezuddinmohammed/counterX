import { describe, expect, it } from "vitest";
import type { Instant, CounterId, Sha256Digest, Environment } from "@counter/domain";
import { createActivationSnapshot } from "./index.js";

// --- Test Helpers ---

const NOW = 1_700_000_000_000 as Instant;
const MERCHANT_ID = "ctr_merchant_AAAAAAAAAAAAAAAAAAAAAA" as CounterId<"merchant">;
const OPERATOR_ID = "ctr_operator_AAAAAAAAAAAAAAAAAAAAAA" as CounterId<"operator">;
const VALID_DIGEST = `sha256:${"a".repeat(64)}` as Sha256Digest;
const VALID_DIGEST_2 = `sha256:${"b".repeat(64)}` as Sha256Digest;

function makeValidSnapshotInput() {
  return {
    merchantId: MERCHANT_ID,
    environment: "production" as Environment,
    verificationDigests: [VALID_DIGEST, VALID_DIGEST_2],
    observedTimes: [NOW, NOW],
    expiryTimes: [(NOW + 86_400_000) as Instant, (NOW + 86_400_000) as Instant],
    acceptedLimitations: ["dev_store_only"],
    connectorIds: ["connector_shopify_001", "connector_razorpay_001"],
    capabilityManifestVersion: "1.0.0",
    activatedAt: NOW,
    activatedBy: OPERATOR_ID,
  };
}

// --- Tests ---

describe("activation negative tests", () => {
  describe("successful snapshot creation", () => {
    it("creates a snapshot with all prerequisites", () => {
      const result = createActivationSnapshot(makeValidSnapshotInput());
      expect(result.ok).toBe(true);
      if (result.ok) {
        expect(result.value.merchantId).toBe(MERCHANT_ID);
        expect(result.value.environment).toBe("production");
        expect(result.value.verificationDigests).toHaveLength(2);
        expect(result.value.connectorIds).toHaveLength(2);
        expect(result.value.capabilityManifestVersion).toBe("1.0.0");
        expect(result.value.activatedAt).toBe(NOW);
        expect(result.value.activatedBy).toBe(OPERATOR_ID);
      }
    });
  });

  describe("empty verificationDigests array blocks activation", () => {
    it("rejects activation with no verification digests", () => {
      const result = createActivationSnapshot({
        ...makeValidSnapshotInput(),
        verificationDigests: [],
      });
      expect(result.ok).toBe(false);
      if (!result.ok) {
        expect(result.error.code).toBe("INVALID_FORMAT");
      }
    });
  });

  describe("empty connectorIds array blocks activation", () => {
    it("rejects activation with no connectors", () => {
      const result = createActivationSnapshot({
        ...makeValidSnapshotInput(),
        connectorIds: [],
      });
      expect(result.ok).toBe(false);
      if (!result.ok) {
        expect(result.error.code).toBe("INVALID_FORMAT");
      }
    });
  });

  describe("empty capabilityManifestVersion blocks activation", () => {
    it("rejects activation with empty manifest version", () => {
      const result = createActivationSnapshot({
        ...makeValidSnapshotInput(),
        capabilityManifestVersion: "",
      });
      expect(result.ok).toBe(false);
      if (!result.ok) {
        expect(result.error.code).toBe("INVALID_FORMAT");
      }
    });

    it("rejects activation with whitespace-only manifest version", () => {
      const result = createActivationSnapshot({
        ...makeValidSnapshotInput(),
        capabilityManifestVersion: "   ",
      });
      expect(result.ok).toBe(false);
    });
  });

  describe("snapshot immutability", () => {
    it("snapshot is immutable (Object.isFrozen)", () => {
      const result = createActivationSnapshot(makeValidSnapshotInput());
      expect(result.ok).toBe(true);
      if (result.ok) {
        expect(Object.isFrozen(result.value)).toBe(true);
      }
    });

    it("verificationDigests array is frozen", () => {
      const result = createActivationSnapshot(makeValidSnapshotInput());
      expect(result.ok).toBe(true);
      if (result.ok) {
        expect(Object.isFrozen(result.value.verificationDigests)).toBe(true);
      }
    });

    it("observedTimes array is frozen", () => {
      const result = createActivationSnapshot(makeValidSnapshotInput());
      expect(result.ok).toBe(true);
      if (result.ok) {
        expect(Object.isFrozen(result.value.observedTimes)).toBe(true);
      }
    });

    it("expiryTimes array is frozen", () => {
      const result = createActivationSnapshot(makeValidSnapshotInput());
      expect(result.ok).toBe(true);
      if (result.ok) {
        expect(Object.isFrozen(result.value.expiryTimes)).toBe(true);
      }
    });

    it("acceptedLimitations array is frozen", () => {
      const result = createActivationSnapshot(makeValidSnapshotInput());
      expect(result.ok).toBe(true);
      if (result.ok) {
        expect(Object.isFrozen(result.value.acceptedLimitations)).toBe(true);
      }
    });

    it("connectorIds array is frozen", () => {
      const result = createActivationSnapshot(makeValidSnapshotInput());
      expect(result.ok).toBe(true);
      if (result.ok) {
        expect(Object.isFrozen(result.value.connectorIds)).toBe(true);
      }
    });
  });
});
