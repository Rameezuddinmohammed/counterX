import { describe, expect, it } from "vitest";
import { PilotEvidenceBundle } from "./pilot-evidence.js";
import type { ScenarioResult, EvidenceMapping } from "./pilot-evidence.js";

// ---------------------------------------------------------------------------
// Fixtures
// ---------------------------------------------------------------------------

const WALLET_ID = "wlt-pilot-001";
const KID = "test-kid-001";

function createScenarioResult(overrides?: Partial<ScenarioResult>): ScenarioResult {
  return {
    scenarioId: "scenario-001",
    scenarioName: "Basic purchase flow",
    corpusRef: "ref-buyer/purchase-basic",
    passed: true,
    executedAt: "2025-01-15T10:00:00.000Z",
    durationMs: 150,
    ...overrides,
  };
}

function createMapping(overrides?: Partial<EvidenceMapping>): EvidenceMapping {
  return {
    corpusScenarioId: "corpus-001",
    walletScenarioId: "wallet-001",
    coverageType: "exact_parity",
    description: "Basic purchase maps exactly to wallet purchase flow",
    ...overrides,
  };
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe("PilotEvidenceBundle", () => {
  describe("scenario collection", () => {
    it("records scenario results", () => {
      const bundle = new PilotEvidenceBundle();

      bundle.addScenarioResult(createScenarioResult());
      bundle.addScenarioResult(createScenarioResult({ scenarioId: "scenario-002", passed: false }));

      const scenarios = bundle.getScenarios();
      expect(scenarios).toHaveLength(2);
      expect(scenarios[0]!.scenarioId).toBe("scenario-001");
      expect(scenarios[1]!.passed).toBe(false);
    });
  });

  describe("coverage mapping", () => {
    it("maps corpus scenarios to wallet scenarios", () => {
      const bundle = new PilotEvidenceBundle();

      bundle.addCoverageMapping(createMapping());
      bundle.addCoverageMapping(
        createMapping({
          corpusScenarioId: "corpus-002",
          walletScenarioId: "wallet-002",
          coverageType: "functional_equivalent",
        }),
      );

      const mappings = bundle.getMappings();
      expect(mappings).toHaveLength(2);
      expect(mappings[0]!.coverageType).toBe("exact_parity");
      expect(mappings[1]!.coverageType).toBe("functional_equivalent");
    });
  });

  describe("parity statistics", () => {
    it("computes correct parity percentage", () => {
      const bundle = new PilotEvidenceBundle();

      bundle.addScenarioResult(createScenarioResult({ passed: true }));
      bundle.addScenarioResult(createScenarioResult({ scenarioId: "s2", passed: true }));
      bundle.addScenarioResult(createScenarioResult({ scenarioId: "s3", passed: false }));

      const stats = bundle.getParityStats();
      expect(stats.total).toBe(3);
      expect(stats.passed).toBe(2);
      expect(stats.failed).toBe(1);
      expect(stats.parityPercent).toBe(67);
    });

    it("handles empty scenario list", () => {
      const bundle = new PilotEvidenceBundle();

      const stats = bundle.getParityStats();
      expect(stats.total).toBe(0);
      expect(stats.passed).toBe(0);
      expect(stats.parityPercent).toBe(0);
    });
  });

  describe("non-live-autonomy assertion", () => {
    it("never claims live autonomy", () => {
      const bundle = new PilotEvidenceBundle();
      expect(bundle.claimsLiveAutonomy()).toBe(false);
    });
  });

  describe("bundle generation", () => {
    it("produces a signed evidence bundle with parity data", () => {
      const bundle = new PilotEvidenceBundle();
      bundle.setCorpusVersion("1.0.0");

      bundle.addScenarioResult(createScenarioResult({ passed: true }));
      bundle.addScenarioResult(createScenarioResult({ scenarioId: "s2", passed: true }));
      bundle.addCoverageMapping(createMapping());

      const result = bundle.buildBundle("bundle-001", KID, WALLET_ID);

      expect(result.ok).toBe(true);
      if (result.ok) {
        const envelope = result.value;
        expect(envelope.type).toBe("counter.revocation.v1");
        expect(envelope.environment).toBe("pilot");
        expect(envelope.payload.bundle_id).toBe("bundle-001");
        expect(envelope.payload.environment).toBe("pilot");
        expect(envelope.payload.corpus_version).toBe("1.0.0");
        expect(envelope.payload.total_scenarios).toBe(2);
        expect(envelope.payload.passed_scenarios).toBe(2);
        expect(envelope.payload.failed_scenarios).toBe(0);
        expect(envelope.payload.live_autonomy_claim).toBe(false);
        expect(envelope.payload.parity_assertion).toContain("100% parity");
        expect(envelope.payload.parity_assertion).toContain("No live autonomy is claimed");
        expect(envelope.payload.coverage_mappings).toHaveLength(1);
      }
    });

    it("fails when no scenarios are recorded", () => {
      const bundle = new PilotEvidenceBundle();

      const result = bundle.buildBundle("bundle-001", KID, WALLET_ID);

      expect(result.ok).toBe(false);
      if (!result.ok) {
        expect(result.error.reason).toContain("No scenarios recorded");
      }
    });

    it("includes failed scenario info in parity assertion", () => {
      const bundle = new PilotEvidenceBundle();
      bundle.setCorpusVersion("2.0.0");

      bundle.addScenarioResult(createScenarioResult({ passed: true }));
      bundle.addScenarioResult(createScenarioResult({ scenarioId: "s2", passed: false }));

      const result = bundle.buildBundle("bundle-002", KID, WALLET_ID);

      expect(result.ok).toBe(true);
      if (result.ok) {
        expect(result.value.payload.failed_scenarios).toBe(1);
        expect(result.value.payload.parity_assertion).toContain("50% parity");
      }
    });
  });
});
