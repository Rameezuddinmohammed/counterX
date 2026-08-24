import { describe, expect, it } from "vitest";
import {
  createCounterId,
  instantFromEpochMilliseconds,
  sha256Digest,
  type CounterId,
  type Instant,
  type Sha256Digest,
} from "@counter/domain";
import { evaluateHealth } from "./health-evaluator.js";
import { generateManifest, type CapabilityManifest, type PilotCapability } from "./capability-manifest.js";
import type { ReadinessCheckResult, ReadinessResult } from "./readiness-types.js";

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

function testManifest(): CapabilityManifest {
  const result = generateManifest({
    merchantId: testMerchantId(),
    manifestVersion: "1.0.0",
    capabilities: ["quote.create", "quote.accept"],
    versionBindings: {
      connectorVersion: "1.2.0",
      mappingSchemaHash: testDigest(),
      policyVersion: "2.0.0",
      protocolVersion: "1.0.0",
      paymentProviderVersion: "3.1.0",
    },
    generatedAt: unwrapInstant(NOW_MS),
  });
  if (!result.ok) throw new Error("Invalid manifest");
  return result.value;
}

/**
 * Creates a manifest with no capabilities for testing the healthy baseline.
 * Since generateManifest requires at least one capability, we construct
 * the manifest directly.
 */
function emptyCapabilityManifest(): CapabilityManifest {
  return Object.freeze({
    merchantId: testMerchantId(),
    manifestVersion: "1.0.0",
    capabilities: Object.freeze([] as PilotCapability[]),
    versionBindings: Object.freeze({
      connectorVersion: "1.2.0",
      mappingSchemaHash: testDigest(),
      policyVersion: "2.0.0",
      protocolVersion: "1.0.0",
      paymentProviderVersion: "3.1.0",
    }),
    generatedAt: unwrapInstant(NOW_MS),
    signatureDigest: testDigest(),
  }) as CapabilityManifest;
}

function makeReadinessResult(
  overrides: Partial<ReadinessResult> & { checkResults: readonly ReadinessCheckResult[] },
): ReadinessResult {
  const merchantId = testMerchantId();
  return {
    merchantId,
    overallStatus: "Advisory",
    expiringItems: [],
    isReady: true,
    ...overrides,
  };
}

describe("HealthEvaluator", () => {
  const manifest = testManifest();

  describe("healthy baseline", () => {
    it("returns Healthy when all checks are passing with no issues and no manifest gaps", () => {
      // Use a manifest with no capabilities so the cross-check does not flag gaps.
      const readiness = makeReadinessResult({
        overallStatus: "Advisory",
        checkResults: [],
        isReady: true,
      });

      const health = evaluateHealth(readiness, emptyCapabilityManifest());

      expect(health.status).toBe("Healthy");
      expect(health.blockingChecks).toHaveLength(0);
      expect(health.degradedChecks).toHaveLength(0);
    });
  });

  describe("manifest cross-check", () => {
    it("returns Degraded when manifest declares capabilities without corresponding readiness checks", () => {
      const readiness = makeReadinessResult({
        overallStatus: "Advisory",
        checkResults: [],
        isReady: true,
      });

      // The test manifest declares quote.create and quote.accept which require
      // connector_health, mapping_freshness, policy_compiled checks
      const health = evaluateHealth(readiness, manifest);

      expect(health.status).toBe("Degraded");
      expect(health.degradedChecks).toContain("connector_health");
      expect(health.degradedChecks).toContain("mapping_freshness");
      expect(health.degradedChecks).toContain("policy_compiled");
    });

    it("does not flag gaps when all required checks are present", () => {
      const readiness = makeReadinessResult({
        overallStatus: "Advisory",
        isReady: true,
        checkResults: [
          { checkKind: "connector_health", status: "Advisory", reason: "OK", timeToExpiryMs: null },
          { checkKind: "mapping_freshness", status: "Advisory", reason: "OK", timeToExpiryMs: null },
          { checkKind: "policy_compiled", status: "Advisory", reason: "OK", timeToExpiryMs: null },
        ],
      });

      const health = evaluateHealth(readiness, manifest);

      expect(health.status).toBe("Degraded");
      // These are degraded because of their Advisory status, not because of manifest gaps
      expect(health.degradedChecks).toContain("connector_health");
      expect(health.degradedChecks).toContain("mapping_freshness");
      expect(health.degradedChecks).toContain("policy_compiled");
      // No duplicate entries from the cross-check
      expect(health.degradedChecks).toHaveLength(3);
    });
  });

  describe("suspension trigger", () => {
    it("returns Suspended when any check is Blocking", () => {
      const readiness = makeReadinessResult({
        overallStatus: "Blocking",
        isReady: false,
        checkResults: [
          {
            checkKind: "connector_health",
            status: "Blocking",
            reason: "Connector expired",
            timeToExpiryMs: -3600000,
          },
          {
            checkKind: "mapping_freshness",
            status: "Advisory",
            reason: "Healthy",
            timeToExpiryMs: null,
          },
        ],
      });

      const health = evaluateHealth(readiness, manifest);

      expect(health.status).toBe("Suspended");
      expect(health.blockingChecks).toContain("connector_health");
      expect(health.reason).toContain("connector_health");
    });

    it("returns Suspended with multiple blocking checks", () => {
      const readiness = makeReadinessResult({
        overallStatus: "Blocking",
        isReady: false,
        checkResults: [
          {
            checkKind: "connector_health",
            status: "Blocking",
            reason: "Connector expired",
            timeToExpiryMs: -3600000,
          },
          {
            checkKind: "evidence_valid",
            status: "Blocking",
            reason: "Evidence expired",
            timeToExpiryMs: -7200000,
          },
        ],
      });

      const health = evaluateHealth(readiness, manifest);

      expect(health.status).toBe("Suspended");
      expect(health.blockingChecks).toHaveLength(2);
      expect(health.blockingChecks).toContain("connector_health");
      expect(health.blockingChecks).toContain("evidence_valid");
    });
  });

  describe("degraded detection", () => {
    it("returns Degraded when checks have Advisory issues", () => {
      const readiness = makeReadinessResult({
        overallStatus: "Advisory",
        isReady: true,
        checkResults: [
          {
            checkKind: "connector_health",
            status: "Advisory",
            reason: "Connector healthy",
            timeToExpiryMs: null,
          },
        ],
      });

      const health = evaluateHealth(readiness, manifest);

      expect(health.status).toBe("Degraded");
      expect(health.degradedChecks).toContain("connector_health");
    });

    it("returns Degraded when checks have Expiring issues", () => {
      const readiness = makeReadinessResult({
        overallStatus: "Expiring",
        isReady: true,
        checkResults: [
          {
            checkKind: "policy_compiled",
            status: "Expiring",
            reason: "Policy expiring soon",
            timeToExpiryMs: 3600000,
          },
        ],
        expiringItems: [
          {
            checkKind: "policy_compiled",
            status: "Expiring",
            reason: "Policy expiring soon",
            timeToExpiryMs: 3600000,
          },
        ],
      });

      const health = evaluateHealth(readiness, manifest);

      expect(health.status).toBe("Degraded");
      expect(health.degradedChecks).toContain("policy_compiled");
    });

    it("returns Degraded when checks have AcceptedLimitation", () => {
      const readiness = makeReadinessResult({
        overallStatus: "AcceptedLimitation",
        isReady: true,
        checkResults: [
          {
            checkKind: "payment_configured",
            status: "AcceptedLimitation",
            reason: "Limitation accepted: old version",
            timeToExpiryMs: null,
          },
        ],
      });

      const health = evaluateHealth(readiness, manifest);

      expect(health.status).toBe("Degraded");
      expect(health.degradedChecks).toContain("payment_configured");
    });
  });

  describe("mixed statuses", () => {
    it("Suspended takes priority over Degraded", () => {
      const readiness = makeReadinessResult({
        overallStatus: "Blocking",
        isReady: false,
        checkResults: [
          {
            checkKind: "connector_health",
            status: "Blocking",
            reason: "Connector expired",
            timeToExpiryMs: -3600000,
          },
          {
            checkKind: "policy_compiled",
            status: "Expiring",
            reason: "Policy expiring soon",
            timeToExpiryMs: 3600000,
          },
        ],
      });

      const health = evaluateHealth(readiness, manifest);

      expect(health.status).toBe("Suspended");
      expect(health.blockingChecks).toContain("connector_health");
      expect(health.degradedChecks).toContain("policy_compiled");
    });
  });
});
