import { describe, expect, it } from "vitest";
import {
  createCounterId,
  instantFromEpochMilliseconds,
  sha256Digest,
  type Clock,
  type CounterId,
  type Instant,
  type Sha256Digest,
} from "@counter/domain";
import { ReadinessEngine } from "./readiness-engine.js";
import type { ReadinessCheck } from "./readiness-types.js";

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
  return sha256Digest(new TextEncoder().encode("test"));
}

function fixedClock(ms: number): Clock {
  return { now: () => unwrapInstant(ms) };
}

const NOW_MS = 1_700_000_000_000;
const ONE_HOUR_MS = 60 * 60 * 1000;
const ONE_DAY_MS = 24 * 60 * 60 * 1000;

describe("ReadinessEngine", () => {
  const merchantId = testMerchantId();

  describe("evaluateAll with worst-of semantics", () => {
    it("returns Blocking for empty checks (nothing verified)", () => {
      const engine = new ReadinessEngine(fixedClock(NOW_MS));
      const result = engine.evaluateAll(merchantId, []);

      expect(result.overallStatus).toBe("Blocking");
      expect(result.isReady).toBe(false);
    });

    it("returns Advisory when all checks are healthy and far from expiry", () => {
      const engine = new ReadinessEngine(fixedClock(NOW_MS));
      const checks: ReadinessCheck[] = [
        {
          merchantId,
          checkKind: "connector_health",
          evidence: {
            kind: "connector_health",
            connectorId: "shopify-1",
            connectorVersion: "1.0.0",
            lastHeartbeatAt: unwrapInstant(NOW_MS - ONE_HOUR_MS),
          },
          expiresAt: unwrapInstant(NOW_MS + 7 * ONE_DAY_MS),
          acceptedLimitation: null,
        },
        {
          merchantId,
          checkKind: "mapping_freshness",
          evidence: {
            kind: "mapping_freshness",
            mappingSchemaHash: testDigest(),
            updatedAt: unwrapInstant(NOW_MS - ONE_HOUR_MS),
          },
          expiresAt: unwrapInstant(NOW_MS + 7 * ONE_DAY_MS),
          acceptedLimitation: null,
        },
      ];

      const result = engine.evaluateAll(merchantId, checks);

      expect(result.overallStatus).toBe("Advisory");
      expect(result.isReady).toBe(true);
    });

    it("returns Blocking (worst-of) when any single check is blocking", () => {
      const engine = new ReadinessEngine(fixedClock(NOW_MS));
      const checks: ReadinessCheck[] = [
        {
          merchantId,
          checkKind: "connector_health",
          evidence: {
            kind: "connector_health",
            connectorId: "shopify-1",
            connectorVersion: "1.0.0",
            lastHeartbeatAt: unwrapInstant(NOW_MS - ONE_HOUR_MS),
          },
          expiresAt: unwrapInstant(NOW_MS + 7 * ONE_DAY_MS),
          acceptedLimitation: null,
        },
        {
          merchantId,
          checkKind: "evidence_valid",
          evidence: {
            kind: "evidence_valid",
            evidenceDigest: testDigest(),
            issuedAt: unwrapInstant(NOW_MS - 2 * ONE_DAY_MS),
            expiresAt: unwrapInstant(NOW_MS - ONE_HOUR_MS), // expired
          },
          expiresAt: null,
          acceptedLimitation: null,
        },
      ];

      const result = engine.evaluateAll(merchantId, checks);

      expect(result.overallStatus).toBe("Blocking");
      expect(result.isReady).toBe(false);
    });
  });

  describe("check kind evaluation", () => {
    it("evaluates connector_health as Advisory when healthy", () => {
      const engine = new ReadinessEngine(fixedClock(NOW_MS));
      const checks: ReadinessCheck[] = [
        {
          merchantId,
          checkKind: "connector_health",
          evidence: {
            kind: "connector_health",
            connectorId: "shopify-1",
            connectorVersion: "2.1.0",
            lastHeartbeatAt: unwrapInstant(NOW_MS - ONE_HOUR_MS),
          },
          expiresAt: unwrapInstant(NOW_MS + 7 * ONE_DAY_MS),
          acceptedLimitation: null,
        },
      ];

      const result = engine.evaluateAll(merchantId, checks);
      expect(result.checkResults[0]!.status).toBe("Advisory");
      expect(result.checkResults[0]!.checkKind).toBe("connector_health");
    });

    it("evaluates policy_compiled as Advisory when healthy", () => {
      const engine = new ReadinessEngine(fixedClock(NOW_MS));
      const checks: ReadinessCheck[] = [
        {
          merchantId,
          checkKind: "policy_compiled",
          evidence: {
            kind: "policy_compiled",
            policyVersion: "3.0.0",
            compiledAt: unwrapInstant(NOW_MS - ONE_HOUR_MS),
            policyDigest: testDigest(),
          },
          expiresAt: unwrapInstant(NOW_MS + 7 * ONE_DAY_MS),
          acceptedLimitation: null,
        },
      ];

      const result = engine.evaluateAll(merchantId, checks);
      expect(result.checkResults[0]!.status).toBe("Advisory");
    });

    it("evaluates payment_configured as Advisory when healthy", () => {
      const engine = new ReadinessEngine(fixedClock(NOW_MS));
      const checks: ReadinessCheck[] = [
        {
          merchantId,
          checkKind: "payment_configured",
          evidence: {
            kind: "payment_configured",
            paymentProviderVersion: "1.2.0",
            configuredAt: unwrapInstant(NOW_MS - ONE_HOUR_MS),
          },
          expiresAt: unwrapInstant(NOW_MS + 7 * ONE_DAY_MS),
          acceptedLimitation: null,
        },
      ];

      const result = engine.evaluateAll(merchantId, checks);
      expect(result.checkResults[0]!.status).toBe("Advisory");
    });

    it("evaluates protocol_version as Advisory when healthy", () => {
      const engine = new ReadinessEngine(fixedClock(NOW_MS));
      const checks: ReadinessCheck[] = [
        {
          merchantId,
          checkKind: "protocol_version",
          evidence: {
            kind: "protocol_version",
            protocolVersion: "1.0.0",
            supportedSince: unwrapInstant(NOW_MS - 7 * ONE_DAY_MS),
          },
          expiresAt: unwrapInstant(NOW_MS + 7 * ONE_DAY_MS),
          acceptedLimitation: null,
        },
      ];

      const result = engine.evaluateAll(merchantId, checks);
      expect(result.checkResults[0]!.status).toBe("Advisory");
    });

    it("evaluates mapping_freshness as Advisory when healthy", () => {
      const engine = new ReadinessEngine(fixedClock(NOW_MS));
      const checks: ReadinessCheck[] = [
        {
          merchantId,
          checkKind: "mapping_freshness",
          evidence: {
            kind: "mapping_freshness",
            mappingSchemaHash: testDigest(),
            updatedAt: unwrapInstant(NOW_MS - ONE_HOUR_MS),
          },
          expiresAt: unwrapInstant(NOW_MS + 7 * ONE_DAY_MS),
          acceptedLimitation: null,
        },
      ];

      const result = engine.evaluateAll(merchantId, checks);
      expect(result.checkResults[0]!.status).toBe("Advisory");
    });
  });

  describe("expired evidence detection", () => {
    it("detects expired expiresAt on the check itself", () => {
      const engine = new ReadinessEngine(fixedClock(NOW_MS));
      const checks: ReadinessCheck[] = [
        {
          merchantId,
          checkKind: "connector_health",
          evidence: {
            kind: "connector_health",
            connectorId: "shopify-1",
            connectorVersion: "1.0.0",
            lastHeartbeatAt: unwrapInstant(NOW_MS - ONE_HOUR_MS),
          },
          expiresAt: unwrapInstant(NOW_MS - ONE_HOUR_MS), // expired
          acceptedLimitation: null,
        },
      ];

      const result = engine.evaluateAll(merchantId, checks);
      expect(result.overallStatus).toBe("Blocking");
      expect(result.isReady).toBe(false);
      expect(result.checkResults[0]!.timeToExpiryMs).toBeLessThan(0);
    });

    it("detects expired evidence_valid via evidence expiresAt", () => {
      const engine = new ReadinessEngine(fixedClock(NOW_MS));
      const checks: ReadinessCheck[] = [
        {
          merchantId,
          checkKind: "evidence_valid",
          evidence: {
            kind: "evidence_valid",
            evidenceDigest: testDigest(),
            issuedAt: unwrapInstant(NOW_MS - 2 * ONE_DAY_MS),
            expiresAt: unwrapInstant(NOW_MS - ONE_HOUR_MS), // expired
          },
          expiresAt: null,
          acceptedLimitation: null,
        },
      ];

      const result = engine.evaluateAll(merchantId, checks);
      expect(result.overallStatus).toBe("Blocking");
      expect(result.isReady).toBe(false);
    });
  });

  describe("limitation acknowledgment flow", () => {
    it("transitions to AcceptedLimitation when limitation is set", () => {
      const engine = new ReadinessEngine(fixedClock(NOW_MS));
      const checks: ReadinessCheck[] = [
        {
          merchantId,
          checkKind: "connector_health",
          evidence: {
            kind: "connector_health",
            connectorId: "shopify-1",
            connectorVersion: "1.0.0",
            lastHeartbeatAt: unwrapInstant(NOW_MS - ONE_HOUR_MS),
          },
          expiresAt: unwrapInstant(NOW_MS + 7 * ONE_DAY_MS),
          acceptedLimitation: "Legacy connector version accepted",
        },
      ];

      const result = engine.evaluateAll(merchantId, checks);
      expect(result.overallStatus).toBe("AcceptedLimitation");
      expect(result.isReady).toBe(true);
      expect(result.checkResults[0]!.reason).toContain("Legacy connector version accepted");
    });

    it("AcceptedLimitation is worse than Advisory but better than Blocking", () => {
      const engine = new ReadinessEngine(fixedClock(NOW_MS));
      const checks: ReadinessCheck[] = [
        {
          merchantId,
          checkKind: "connector_health",
          evidence: {
            kind: "connector_health",
            connectorId: "shopify-1",
            connectorVersion: "1.0.0",
            lastHeartbeatAt: unwrapInstant(NOW_MS - ONE_HOUR_MS),
          },
          expiresAt: unwrapInstant(NOW_MS + 7 * ONE_DAY_MS),
          acceptedLimitation: null,
        },
        {
          merchantId,
          checkKind: "payment_configured",
          evidence: {
            kind: "payment_configured",
            paymentProviderVersion: "0.9.0",
            configuredAt: unwrapInstant(NOW_MS - ONE_HOUR_MS),
          },
          expiresAt: unwrapInstant(NOW_MS + 7 * ONE_DAY_MS),
          acceptedLimitation: "Older payment version accepted",
        },
      ];

      const result = engine.evaluateAll(merchantId, checks);
      expect(result.overallStatus).toBe("AcceptedLimitation");
      expect(result.isReady).toBe(true);
    });
  });

  describe("Expiring detection", () => {
    it("marks checks expiring within 24 hours as Expiring", () => {
      const engine = new ReadinessEngine(fixedClock(NOW_MS));
      const checks: ReadinessCheck[] = [
        {
          merchantId,
          checkKind: "connector_health",
          evidence: {
            kind: "connector_health",
            connectorId: "shopify-1",
            connectorVersion: "1.0.0",
            lastHeartbeatAt: unwrapInstant(NOW_MS - ONE_HOUR_MS),
          },
          expiresAt: unwrapInstant(NOW_MS + 12 * ONE_HOUR_MS), // 12 hours, within 24h
          acceptedLimitation: null,
        },
      ];

      const result = engine.evaluateAll(merchantId, checks);
      expect(result.overallStatus).toBe("Expiring");
      expect(result.isReady).toBe(true);
      expect(result.expiringItems).toHaveLength(1);
      expect(result.expiringItems[0]!.checkKind).toBe("connector_health");
    });
  });

  describe("concurrent activation race detection", () => {
    it("deterministic evaluation supports race detection at activation layer", () => {
      const engine = new ReadinessEngine(fixedClock(NOW_MS));

      // Simulate two concurrent evaluations producing identical results
      const checks: ReadinessCheck[] = [
        {
          merchantId,
          checkKind: "connector_health",
          evidence: {
            kind: "connector_health",
            connectorId: "shopify-1",
            connectorVersion: "1.0.0",
            lastHeartbeatAt: unwrapInstant(NOW_MS - ONE_HOUR_MS),
          },
          expiresAt: unwrapInstant(NOW_MS + 7 * ONE_DAY_MS),
          acceptedLimitation: null,
        },
      ];

      const result1 = engine.evaluateAll(merchantId, checks);
      const result2 = engine.evaluateAll(merchantId, checks);

      // Both evaluations produce identical results (deterministic)
      // Race detection is done at the activation layer by checking
      // manifest version conflicts.
      expect(result1.overallStatus).toBe(result2.overallStatus);
      expect(result1.isReady).toBe(result2.isReady);
      expect(result1.merchantId).toBe(result2.merchantId);
    });
  });
});
