import { describe, expect, it } from "vitest";
import {
  createCounterId,
  instantFromEpochMilliseconds,
  sha256Digest,
  type CounterId,
  type Instant,
  type Sha256Digest,
} from "@counter/domain";
import {
  generateManifest,
  signManifest,
  PILOT_CAPABILITIES,
  FULFILLMENT_CAPABILITIES,
  isFulfillmentCapability,
  type GenerateManifestInput,
  type VersionBindings,
} from "./capability-manifest.js";

// ─── Test Helpers ───────────────────────────────────────────────────────────

function unwrapInstant(ms: number): Instant {
  const r = instantFromEpochMilliseconds(ms);
  if (!r.ok) throw new Error("Invalid instant");
  return r.value;
}

function testMerchantId(): CounterId<"merchant"> {
  const r = createCounterId("merchant", new Uint8Array(16).fill(1));
  if (!r.ok) throw new Error("Invalid id");
  return r.value;
}

function testDigest(): Sha256Digest {
  return sha256Digest(new TextEncoder().encode("mapping-schema"));
}

const NOW_MS = 1_700_000_000_000;

function testVersionBindings(): VersionBindings {
  return {
    connectorVersion: "1.2.0",
    mappingSchemaHash: testDigest(),
    policyVersion: "2.0.0",
    protocolVersion: "1.0.0",
    paymentProviderVersion: "3.1.0",
  };
}

function testInput(): GenerateManifestInput {
  return {
    merchantId: testMerchantId(),
    manifestVersion: "1.0.0",
    capabilities: ["quote.create", "quote.accept", "payment.initiate"],
    versionBindings: testVersionBindings(),
    generatedAt: unwrapInstant(NOW_MS),
  };
}

describe("CapabilityManifest", () => {
  describe("generateManifest", () => {
    it("generates a valid manifest with all version bindings", () => {
      const input = testInput();
      const result = generateManifest(input);

      expect(result.ok).toBe(true);
      if (!result.ok) return;

      expect(result.value.merchantId).toBe(input.merchantId);
      expect(result.value.manifestVersion).toBe("1.0.0");
      expect(result.value.capabilities).toEqual([
        "quote.create",
        "quote.accept",
        "payment.initiate",
      ]);
      expect(result.value.versionBindings.connectorVersion).toBe("1.2.0");
      expect(result.value.versionBindings.mappingSchemaHash).toBe(testDigest());
      expect(result.value.versionBindings.policyVersion).toBe("2.0.0");
      expect(result.value.versionBindings.protocolVersion).toBe("1.0.0");
      expect(result.value.versionBindings.paymentProviderVersion).toBe("3.1.0");
      expect(result.value.generatedAt).toBe(unwrapInstant(NOW_MS));
      expect(result.value.signatureDigest).toMatch(/^sha256:[0-9a-f]{64}$/);
    });

    it("rejects invalid semver manifest version", () => {
      const input: GenerateManifestInput = {
        ...testInput(),
        manifestVersion: "not-semver",
      };
      const result = generateManifest(input);

      expect(result.ok).toBe(false);
      if (result.ok) return;
      expect(result.error.code).toBe("INVALID_FORMAT");
    });

    it("rejects manifest with no capabilities", () => {
      const input: GenerateManifestInput = {
        ...testInput(),
        capabilities: [],
      };
      const result = generateManifest(input);

      expect(result.ok).toBe(false);
      if (result.ok) return;
      expect(result.error.code).toBe("INVALID_FORMAT");
    });

    it("accepts pre-release semver versions", () => {
      const input: GenerateManifestInput = {
        ...testInput(),
        manifestVersion: "1.0.0-beta.1",
      };
      const result = generateManifest(input);

      expect(result.ok).toBe(true);
    });
  });

  describe("signManifest - signature determinism", () => {
    it("produces the same digest for identical inputs", () => {
      const input = testInput();
      const sig1 = signManifest(input);
      const sig2 = signManifest(input);

      expect(sig1).toBe(sig2);
    });

    it("produces different digests for different merchant IDs", () => {
      const input1 = testInput();
      const id2 = createCounterId("merchant", new Uint8Array(16).fill(2));
      if (!id2.ok) throw new Error("Invalid id");

      const input2: GenerateManifestInput = {
        ...testInput(),
        merchantId: id2.value,
      };

      const sig1 = signManifest(input1);
      const sig2 = signManifest(input2);

      expect(sig1).not.toBe(sig2);
    });

    it("produces different digests for different version bindings", () => {
      const input1 = testInput();
      const input2: GenerateManifestInput = {
        ...testInput(),
        versionBindings: {
          ...testVersionBindings(),
          connectorVersion: "2.0.0",
        },
      };

      const sig1 = signManifest(input1);
      const sig2 = signManifest(input2);

      expect(sig1).not.toBe(sig2);
    });

    it("produces the same digest regardless of capability order", () => {
      const input1: GenerateManifestInput = {
        ...testInput(),
        capabilities: ["quote.create", "payment.initiate"],
      };
      const input2: GenerateManifestInput = {
        ...testInput(),
        capabilities: ["payment.initiate", "quote.create"],
      };

      const sig1 = signManifest(input1);
      const sig2 = signManifest(input2);

      expect(sig1).toBe(sig2);
    });

    it("produces different digests for different timestamps", () => {
      const input1 = testInput();
      const input2: GenerateManifestInput = {
        ...testInput(),
        generatedAt: unwrapInstant(NOW_MS + 1000),
      };

      const sig1 = signManifest(input1);
      const sig2 = signManifest(input2);

      expect(sig1).not.toBe(sig2);
    });
  });

  describe("manifest version validation", () => {
    it("accepts standard semver versions", () => {
      for (const version of ["0.1.0", "1.0.0", "10.20.30"]) {
        const result = generateManifest({ ...testInput(), manifestVersion: version });
        expect(result.ok).toBe(true);
      }
    });

    it("rejects non-semver strings", () => {
      for (const version of ["v1.0.0", "1.0", "1", "latest", ""]) {
        const result = generateManifest({ ...testInput(), manifestVersion: version });
        expect(result.ok).toBe(false);
      }
    });
  });

  describe("discovery/runtime consistency", () => {
    it("manifest capabilities match what pilot declares", () => {
      const input: GenerateManifestInput = {
        ...testInput(),
        capabilities: [...PILOT_CAPABILITIES],
      };
      const result = generateManifest(input);

      expect(result.ok).toBe(true);
      if (!result.ok) return;
      expect(result.value.capabilities).toEqual(expect.arrayContaining([...PILOT_CAPABILITIES]));
    });

    it("frozen manifest cannot be mutated", () => {
      const result = generateManifest(testInput());
      expect(result.ok).toBe(true);
      if (!result.ok) return;

      expect(() => {
        (result.value as { manifestVersion: string }).manifestVersion = "hacked";
      }).toThrow();
    });
  });

  describe("FulfillmentCapability", () => {
    it("is a closed vocabulary of 7 values", () => {
      expect(FULFILLMENT_CAPABILITIES).toHaveLength(7);
    });

    it("isFulfillmentCapability accepts every declared value", () => {
      for (const value of FULFILLMENT_CAPABILITIES) {
        expect(isFulfillmentCapability(value)).toBe(true);
      }
    });

    it("isFulfillmentCapability rejects unknown strings and non-strings", () => {
      expect(isFulfillmentCapability("fulfillment.teleport.instant")).toBe(false);
      expect(isFulfillmentCapability("quote.create")).toBe(false);
      expect(isFulfillmentCapability(undefined)).toBe(false);
      expect(isFulfillmentCapability(42)).toBe(false);
    });

    it("generateManifest accepts an empty fulfillmentCapabilities array", () => {
      const input: GenerateManifestInput = { ...testInput(), fulfillmentCapabilities: [] };
      const result = generateManifest(input);

      expect(result.ok).toBe(true);
      if (!result.ok) return;
      expect(result.value.fulfillmentCapabilities).toEqual([]);
    });

    it("generateManifest carries fulfillmentCapabilities through when supplied", () => {
      const input: GenerateManifestInput = {
        ...testInput(),
        fulfillmentCapabilities: ["fulfillment.physical.ship", "fulfillment.digital.deliver"],
      };
      const result = generateManifest(input);

      expect(result.ok).toBe(true);
      if (!result.ok) return;
      expect(result.value.fulfillmentCapabilities).toEqual([
        "fulfillment.physical.ship",
        "fulfillment.digital.deliver",
      ]);
    });

    it("generateManifest omits fulfillmentCapabilities when not supplied (backward compatible)", () => {
      const result = generateManifest(testInput());
      expect(result.ok).toBe(true);
      if (!result.ok) return;
      expect(result.value.fulfillmentCapabilities).toBeUndefined();
    });

    it("signManifest is order-independent for fulfillmentCapabilities, like capabilities", () => {
      const input1: GenerateManifestInput = {
        ...testInput(),
        fulfillmentCapabilities: ["fulfillment.physical.ship", "fulfillment.digital.deliver"],
      };
      const input2: GenerateManifestInput = {
        ...testInput(),
        fulfillmentCapabilities: ["fulfillment.digital.deliver", "fulfillment.physical.ship"],
      };
      expect(signManifest(input1)).toBe(signManifest(input2));
    });

    it("signManifest produces a different digest when fulfillmentCapabilities differ", () => {
      const withFulfillment: GenerateManifestInput = {
        ...testInput(),
        fulfillmentCapabilities: ["fulfillment.physical.ship"],
      };
      const without: GenerateManifestInput = { ...testInput() };
      expect(signManifest(withFulfillment)).not.toBe(signManifest(without));
    });
  });
});
