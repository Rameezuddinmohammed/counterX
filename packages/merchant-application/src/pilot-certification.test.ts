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
  createTestSignerA,
  TEST_KID_A,
  InMemoryKeyRegistry,
  TEST_KEY_RECORD_A,
  verifyEnvelope,
  type CtpEnvelope,
} from "@counter/trust-protocol";

import { PilotCertification, type ScenarioDefinition } from "./pilot-certification.js";
import {
  buildTraceabilityMatrix,
  validateTraceability,
  PILOT_REQUIREMENTS,
  type CertificationScenarioResult,
} from "./requirement-traceability.js";
import {
  buildEvidenceBundle,
  signBundle,
  verifyBundle,
  type EvidenceBundle,
} from "./evidence-bundle.js";
import {
  generateManifest,
  type CapabilityManifest,
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
const NOW = unwrapInstant(NOW_MS);

function testVersionBindings(): VersionBindings {
  return {
    connectorVersion: "1.2.0",
    mappingSchemaHash: testDigest(),
    policyVersion: "2.0.0",
    protocolVersion: "1.0.0",
    paymentProviderVersion: "3.1.0",
  };
}

function testManifest(): CapabilityManifest {
  const input: GenerateManifestInput = {
    merchantId: testMerchantId(),
    manifestVersion: "1.0.0",
    capabilities: ["quote.create", "quote.accept", "payment.initiate"],
    versionBindings: testVersionBindings(),
    generatedAt: NOW,
  };
  const result = generateManifest(input);
  if (!result.ok) throw new Error("Failed to generate manifest");
  return result.value;
}

function createMockScenarios(requirementIds?: readonly string[][]): ScenarioDefinition[] {
  const reqs = requirementIds ?? PILOT_REQUIREMENTS.map((r) => [r.id]);
  return reqs.map((ids, i) => ({
    scenarioId: `scenario-${i + 1}`,
    name: `Test Scenario ${i + 1}`,
    requirementIds: ids,
    execute: async () => ({
      passed: true,
      evidenceIds: [`evidence-${i + 1}-a`, `evidence-${i + 1}-b`],
      receiptIds: [`receipt-${i + 1}`],
      findingIds: [],
      details: `Scenario ${i + 1} completed successfully`,
    }),
  }));
}

function createPartiallyFailingScenarios(): ScenarioDefinition[] {
  return PILOT_REQUIREMENTS.map((req, i) => ({
    scenarioId: `scenario-${i + 1}`,
    name: `Test Scenario ${i + 1}`,
    requirementIds: [req.id],
    execute: async () => ({
      passed: i < 10, // First 10 pass, last 4 fail
      evidenceIds: [`evidence-${i + 1}`],
      receiptIds: i < 10 ? [`receipt-${i + 1}`] : [],
      findingIds: i >= 10 ? [`finding-${i + 1}`] : [],
      details: i < 10 ? "Passed" : "Failed",
    }),
  }));
}

// ─── PilotCertification Tests ───────────────────────────────────────────────

describe("PilotCertification", () => {
  describe("runCertificationSuite", () => {
    it("runs all scenarios and produces results", async () => {
      const signer = createTestSignerA();
      const cert = new PilotCertification({
        signer,
        kid: TEST_KID_A,
        environment: "pilot",
      });

      const scenarios = createMockScenarios();
      const result = await cert.runCertificationSuite(scenarios, NOW);

      expect(result.totalScenarios).toBe(14);
      expect(result.passedScenarios).toBe(14);
      expect(result.failedScenarios).toBe(0);
      expect(result.overallPass).toBe(true);
      expect(result.timestamp).toBe(NOW);
      expect(result.results).toHaveLength(14);
    });

    it("reports overall failure when any scenario fails", async () => {
      const signer = createTestSignerA();
      const cert = new PilotCertification({
        signer,
        kid: TEST_KID_A,
        environment: "pilot",
      });

      const scenarios = createPartiallyFailingScenarios();
      const result = await cert.runCertificationSuite(scenarios, NOW);

      expect(result.overallPass).toBe(false);
      expect(result.passedScenarios).toBe(10);
      expect(result.failedScenarios).toBe(4);
    });

    it("captures evidence IDs from each scenario", async () => {
      const signer = createTestSignerA();
      const cert = new PilotCertification({
        signer,
        kid: TEST_KID_A,
        environment: "pilot",
      });

      const scenarios = createMockScenarios([["REQ-001"], ["REQ-002"]]);
      const result = await cert.runCertificationSuite(scenarios, NOW);

      expect(result.results[0]!.evidenceIds).toContain("evidence-1-a");
      expect(result.results[0]!.evidenceIds).toContain("evidence-1-b");
      expect(result.results[1]!.evidenceIds).toContain("evidence-2-a");
    });

    it("captures requirement IDs from scenario definitions", async () => {
      const signer = createTestSignerA();
      const cert = new PilotCertification({
        signer,
        kid: TEST_KID_A,
        environment: "pilot",
      });

      const scenarios = createMockScenarios([["REQ-001", "REQ-002"], ["REQ-003"]]);
      const result = await cert.runCertificationSuite(scenarios, NOW);

      expect(result.results[0]!.requirementIds).toEqual(["REQ-001", "REQ-002"]);
      expect(result.results[1]!.requirementIds).toEqual(["REQ-003"]);
    });
  });

  describe("collectEvidenceBundle", () => {
    it("contains all required artifacts", async () => {
      const signer = createTestSignerA();
      const cert = new PilotCertification({
        signer,
        kid: TEST_KID_A,
        environment: "pilot",
      });

      const scenarios = createMockScenarios();
      await cert.runCertificationSuite(scenarios, NOW);

      const manifest = testManifest();
      const bundle = cert.collectEvidenceBundle(manifest, NOW);

      expect(bundle.scenarioResults).toHaveLength(14);
      expect(bundle.receipts.length).toBeGreaterThan(0);
      expect(bundle.manifestSnapshot).toBe(manifest);
      expect(bundle.timestamp).toBe(NOW);
      expect(bundle.version).toBe("1.0.0");
      expect(bundle.bundleDigest).toMatch(/^sha256:[0-9a-f]{64}$/);
    });

    it("throws if suite has not been run", () => {
      const signer = createTestSignerA();
      const cert = new PilotCertification({
        signer,
        kid: TEST_KID_A,
        environment: "pilot",
      });

      expect(() => cert.collectEvidenceBundle(testManifest(), NOW)).toThrow(
        "Cannot collect evidence bundle before running certification suite",
      );
    });

    it("includes findings from failed scenarios", async () => {
      const signer = createTestSignerA();
      const cert = new PilotCertification({
        signer,
        kid: TEST_KID_A,
        environment: "pilot",
      });

      const scenarios = createPartiallyFailingScenarios();
      await cert.runCertificationSuite(scenarios, NOW);

      const bundle = cert.collectEvidenceBundle(testManifest(), NOW);
      expect(bundle.findings.length).toBeGreaterThan(0);
    });
  });

  describe("signCertificationManifest", () => {
    it("produces CTP-signed manifest with correct evidence hashes", async () => {
      const signer = createTestSignerA();
      const cert = new PilotCertification({
        signer,
        kid: TEST_KID_A,
        environment: "pilot",
      });

      const scenarios = createMockScenarios();
      await cert.runCertificationSuite(scenarios, NOW);

      const manifest = testManifest();
      const signedManifest = await cert.signCertificationManifest(manifest, NOW);

      expect(signedManifest.manifest).toBe(manifest);
      expect(signedManifest.evidenceHashes.length).toBeGreaterThan(0);
      for (const hash of signedManifest.evidenceHashes) {
        expect(hash).toMatch(/^sha256:[0-9a-f]{64}$/);
      }
      expect(signedManifest.envelope.signature.value).toBeDefined();
      expect(signedManifest.envelope.signature.alg).toBe("EdDSA");
      expect(signedManifest.envelope.signature.kid).toBe(TEST_KID_A);
    });

    it("signed manifest envelope has correct payload", async () => {
      const signer = createTestSignerA();
      const cert = new PilotCertification({
        signer,
        kid: TEST_KID_A,
        environment: "pilot",
      });

      const scenarios = createMockScenarios();
      await cert.runCertificationSuite(scenarios, NOW);

      const manifest = testManifest();
      const signedManifest = await cert.signCertificationManifest(manifest, NOW);

      expect(signedManifest.envelope.payload.manifestDigest).toBe(manifest.signatureDigest);
      expect(signedManifest.envelope.payload.scenarioCount).toBe(14);
      expect(signedManifest.envelope.payload.allPassed).toBe(true);
    });

    it("throws if suite has not been run", async () => {
      const signer = createTestSignerA();
      const cert = new PilotCertification({
        signer,
        kid: TEST_KID_A,
        environment: "pilot",
      });

      await expect(cert.signCertificationManifest(testManifest(), NOW)).rejects.toThrow(
        "Cannot sign manifest before running certification suite",
      );
    });

    it("signed envelope is independently verifiable", async () => {
      const signer = createTestSignerA();
      const cert = new PilotCertification({
        signer,
        kid: TEST_KID_A,
        environment: "pilot",
      });

      const scenarios = createMockScenarios();
      await cert.runCertificationSuite(scenarios, NOW);

      const signedManifest = await cert.signCertificationManifest(testManifest(), NOW);

      // Verify using trust-protocol verify
      const keyRegistry = new InMemoryKeyRegistry([TEST_KEY_RECORD_A]);
      const verifyResult = await verifyEnvelope(signedManifest.envelope as CtpEnvelope, {
        keyRegistry,
        currentTime: new Date().toISOString(),
        expectedAudience: "counter://pilot-verifier",
      });

      expect(verifyResult.ok).toBe(true);
    });
  });
});

// ─── Requirement Traceability Tests ─────────────────────────────────────────

describe("RequirementTraceability", () => {
  describe("PILOT_REQUIREMENTS", () => {
    it("contains exactly 14 released operation candidates", () => {
      expect(PILOT_REQUIREMENTS).toHaveLength(14);
    });

    it("all requirements have unique IDs", () => {
      const ids = PILOT_REQUIREMENTS.map((r) => r.id);
      expect(new Set(ids).size).toBe(14);
    });

    it("all requirements have section references", () => {
      for (const req of PILOT_REQUIREMENTS) {
        expect(req.section).toMatch(/^3\.\d+$/);
      }
    });
  });

  describe("buildTraceabilityMatrix", () => {
    it("covers all PILOT_REQUIREMENTS when scenarios map to all", () => {
      const results: CertificationScenarioResult[] = PILOT_REQUIREMENTS.map((req, i) => ({
        scenarioId: `scenario-${i}`,
        requirementIds: [req.id],
        passed: true,
        evidenceIds: [`evidence-${i}`],
      }));

      const matrix = buildTraceabilityMatrix(results);

      expect(matrix.totalRequirements).toBe(14);
      expect(matrix.coveredCount).toBe(14);
      expect(matrix.missingCount).toBe(0);
      expect(matrix.partialCount).toBe(0);
    });

    it("detects missing requirements when no scenario covers them", () => {
      const results: CertificationScenarioResult[] = [
        {
          scenarioId: "scenario-1",
          requirementIds: ["REQ-001"],
          passed: true,
          evidenceIds: ["evidence-1"],
        },
      ];

      const matrix = buildTraceabilityMatrix(results);

      expect(matrix.coveredCount).toBe(1);
      expect(matrix.missingCount).toBe(13);
    });

    it("marks requirements as partial when scenarios fail", () => {
      const results: CertificationScenarioResult[] = PILOT_REQUIREMENTS.map((req, i) => ({
        scenarioId: `scenario-${i}`,
        requirementIds: [req.id],
        passed: i < 10,
        evidenceIds: [`evidence-${i}`],
      }));

      const matrix = buildTraceabilityMatrix(results);

      expect(matrix.coveredCount).toBe(10);
      expect(matrix.partialCount).toBe(4);
      expect(matrix.missingCount).toBe(0);
    });
  });

  describe("validateTraceability", () => {
    it("passes when all requirements are covered", () => {
      const results: CertificationScenarioResult[] = PILOT_REQUIREMENTS.map((req, i) => ({
        scenarioId: `scenario-${i}`,
        requirementIds: [req.id],
        passed: true,
        evidenceIds: [`evidence-${i}`],
      }));

      const matrix = buildTraceabilityMatrix(results);
      const validation = validateTraceability(matrix);

      expect(validation.valid).toBe(true);
      expect(validation.missingRequirements).toHaveLength(0);
      expect(validation.partialRequirements).toHaveLength(0);
      expect(validation.coveragePercentage).toBe(100);
    });

    it("fails when requirements are missing", () => {
      const results: CertificationScenarioResult[] = [
        {
          scenarioId: "scenario-1",
          requirementIds: ["REQ-001"],
          passed: true,
          evidenceIds: ["evidence-1"],
        },
      ];

      const matrix = buildTraceabilityMatrix(results);
      const validation = validateTraceability(matrix);

      expect(validation.valid).toBe(false);
      expect(validation.missingRequirements.length).toBeGreaterThan(0);
      expect(validation.missingRequirements).toContain("REQ-002");
    });

    it("reports partial requirements as invalid", () => {
      const results: CertificationScenarioResult[] = PILOT_REQUIREMENTS.map((req, i) => ({
        scenarioId: `scenario-${i}`,
        requirementIds: [req.id],
        passed: i !== 5, // REQ-006 fails
        evidenceIds: [`evidence-${i}`],
      }));

      const matrix = buildTraceabilityMatrix(results);
      const validation = validateTraceability(matrix);

      expect(validation.valid).toBe(false);
      expect(validation.partialRequirements).toContain("REQ-006");
    });

    it("calculates coverage percentage correctly", () => {
      const results: CertificationScenarioResult[] = PILOT_REQUIREMENTS.slice(0, 7).map(
        (req, i) => ({
          scenarioId: `scenario-${i}`,
          requirementIds: [req.id],
          passed: true,
          evidenceIds: [`evidence-${i}`],
        }),
      );

      const matrix = buildTraceabilityMatrix(results);
      const validation = validateTraceability(matrix);

      expect(validation.coveragePercentage).toBe(50);
    });
  });
});

// ─── Evidence Bundle Tests ──────────────────────────────────────────────────

describe("EvidenceBundle", () => {
  describe("buildEvidenceBundle", () => {
    it("aggregates all certification artifacts", () => {
      const certResults: CertificationScenarioResult[] = [
        {
          scenarioId: "scenario-1",
          requirementIds: ["REQ-001"],
          passed: true,
          evidenceIds: ["evidence-1"],
        },
        {
          scenarioId: "scenario-2",
          requirementIds: ["REQ-002"],
          passed: true,
          evidenceIds: ["evidence-2"],
        },
      ];
      const manifest = testManifest();
      const receipts = ["receipt-1", "receipt-2"];
      const findings = ["finding-1"];

      const bundle = buildEvidenceBundle(certResults, manifest, receipts, findings, NOW);

      expect(bundle.scenarioResults).toHaveLength(2);
      expect(bundle.receipts).toEqual(["receipt-1", "receipt-2"]);
      expect(bundle.findings).toEqual(["finding-1"]);
      expect(bundle.manifestSnapshot).toBe(manifest);
      expect(bundle.timestamp).toBe(NOW);
      expect(bundle.version).toBe("1.0.0");
    });

    it("computes a deterministic bundle digest", () => {
      const certResults: CertificationScenarioResult[] = [
        {
          scenarioId: "scenario-1",
          requirementIds: ["REQ-001"],
          passed: true,
          evidenceIds: ["evidence-1"],
        },
      ];
      const manifest = testManifest();

      const bundle1 = buildEvidenceBundle(certResults, manifest, ["r-1"], [], NOW);
      const bundle2 = buildEvidenceBundle(certResults, manifest, ["r-1"], [], NOW);

      expect(bundle1.bundleDigest).toBe(bundle2.bundleDigest);
      expect(bundle1.bundleDigest).toMatch(/^sha256:[0-9a-f]{64}$/);
    });

    it("produces different digests for different content", () => {
      const certResults: CertificationScenarioResult[] = [
        {
          scenarioId: "scenario-1",
          requirementIds: ["REQ-001"],
          passed: true,
          evidenceIds: ["evidence-1"],
        },
      ];
      const manifest = testManifest();

      const bundle1 = buildEvidenceBundle(certResults, manifest, ["r-1"], [], NOW);
      const bundle2 = buildEvidenceBundle(certResults, manifest, ["r-2"], [], NOW);

      expect(bundle1.bundleDigest).not.toBe(bundle2.bundleDigest);
    });

    it("returns frozen bundle", () => {
      const certResults: CertificationScenarioResult[] = [
        {
          scenarioId: "scenario-1",
          requirementIds: ["REQ-001"],
          passed: true,
          evidenceIds: ["evidence-1"],
        },
      ];

      const bundle = buildEvidenceBundle(certResults, testManifest(), [], [], NOW);

      expect(() => {
        (bundle as { version: string }).version = "hacked";
      }).toThrow();
    });
  });

  describe("signBundle", () => {
    it("produces verifiable CTP envelope", async () => {
      const signer = createTestSignerA();
      const certResults: CertificationScenarioResult[] = [
        {
          scenarioId: "scenario-1",
          requirementIds: ["REQ-001"],
          passed: true,
          evidenceIds: ["evidence-1"],
        },
      ];
      const manifest = testManifest();
      const bundle = buildEvidenceBundle(certResults, manifest, ["receipt-1"], [], NOW);

      const signed = await signBundle(bundle, signer, TEST_KID_A, "pilot");

      expect(signed.bundle).toBe(bundle);
      expect(signed.envelope.signature.value).toBeDefined();
      expect(signed.envelope.signature.alg).toBe("EdDSA");
      expect(signed.envelope.signature.kid).toBe(TEST_KID_A);
      expect(signed.envelope.type).toBe("counter.evidence.v1");
      expect(signed.envelope.environment).toBe("pilot");
    });

    it("signed envelope payload contains bundle digest", async () => {
      const signer = createTestSignerA();
      const certResults: CertificationScenarioResult[] = [
        {
          scenarioId: "scenario-1",
          requirementIds: ["REQ-001"],
          passed: true,
          evidenceIds: ["evidence-1"],
        },
      ];
      const manifest = testManifest();
      const bundle = buildEvidenceBundle(certResults, manifest, [], [], NOW);

      const signed = await signBundle(bundle, signer, TEST_KID_A, "pilot");

      expect(signed.envelope.payload.bundleDigest).toBe(bundle.bundleDigest);
      expect(signed.envelope.payload.scenarioCount).toBe(1);
      expect(signed.envelope.payload.manifestDigest).toBe(manifest.signatureDigest);
    });

    it("signed envelope is independently verifiable via CTP", async () => {
      const signer = createTestSignerA();
      const certResults: CertificationScenarioResult[] = [
        {
          scenarioId: "scenario-1",
          requirementIds: ["REQ-001"],
          passed: true,
          evidenceIds: ["evidence-1"],
        },
      ];
      const manifest = testManifest();
      const bundle = buildEvidenceBundle(certResults, manifest, [], [], NOW);

      const signed = await signBundle(bundle, signer, TEST_KID_A, "pilot");

      // Verify using trust-protocol verify
      const keyRegistry = new InMemoryKeyRegistry([TEST_KEY_RECORD_A]);
      const verifyResult = await verifyEnvelope(signed.envelope as CtpEnvelope, {
        keyRegistry,
        currentTime: new Date().toISOString(),
        expectedAudience: "counter://pilot-verifier",
      });

      expect(verifyResult.ok).toBe(true);
    });
  });

  describe("verifyBundle", () => {
    it("validates signature and digest of a signed bundle", async () => {
      const signer = createTestSignerA();
      const certResults: CertificationScenarioResult[] = [
        {
          scenarioId: "scenario-1",
          requirementIds: ["REQ-001"],
          passed: true,
          evidenceIds: ["evidence-1"],
        },
      ];
      const manifest = testManifest();
      const bundle = buildEvidenceBundle(certResults, manifest, ["receipt-1"], [], NOW);

      const signed = await signBundle(bundle, signer, TEST_KID_A, "pilot");
      const verification = await verifyBundle(signed);

      expect(verification.valid).toBe(true);
      expect(verification.digestMatch).toBe(true);
      expect(verification.signatureValid).toBe(true);
      expect(verification.error).toBeUndefined();
    });

    it("detects tampered bundle digest", async () => {
      const signer = createTestSignerA();
      const certResults: CertificationScenarioResult[] = [
        {
          scenarioId: "scenario-1",
          requirementIds: ["REQ-001"],
          passed: true,
          evidenceIds: ["evidence-1"],
        },
      ];
      const manifest = testManifest();
      const bundle = buildEvidenceBundle(certResults, manifest, ["receipt-1"], [], NOW);

      const signed = await signBundle(bundle, signer, TEST_KID_A, "pilot");

      // Tamper with the bundle by creating a new one with altered receipts
      // but keeping the original digest
      const tamperedBundle: EvidenceBundle = {
        ...signed.bundle,
        receipts: ["tampered-receipt"],
        // Keep original digest - should cause mismatch on recomputation
      };

      const tamperedSigned = { bundle: tamperedBundle, envelope: signed.envelope };
      const verification = await verifyBundle(tamperedSigned);

      expect(verification.valid).toBe(false);
      expect(verification.digestMatch).toBe(false);
    });
  });
});
