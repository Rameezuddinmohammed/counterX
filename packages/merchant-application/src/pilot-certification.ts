/**
 * Pilot certification for merchant candidates.
 *
 * Runs PILOT.md scenarios, collects evidence, and produces CTP-signed
 * capability manifests with evidence hashes. This module orchestrates the
 * full certification workflow: scenario execution, evidence collection,
 * traceability validation, and manifest signing.
 */

import type { Instant, Sha256Digest } from "@counter/domain";
import { sha256Digest } from "@counter/domain";
import type { CtpEnvelope, CtpEnvironment, Signer } from "@counter/trust-protocol";
import { buildUnsignedEnvelope, generateNonce, signEnvelope } from "@counter/trust-protocol";
import { randomBytes } from "node:crypto";

import type { CapabilityManifest } from "./capability-manifest.js";
import type { CertificationScenarioResult } from "./requirement-traceability.js";
import {
  buildTraceabilityMatrix,
  validateTraceability,
  PILOT_REQUIREMENTS,
} from "./requirement-traceability.js";
import { buildEvidenceBundle, signBundle } from "./evidence-bundle.js";
import type { EvidenceBundle, SignedEvidenceBundle } from "./evidence-bundle.js";

// ─── Scenario Definition ────────────────────────────────────────────────────

export interface ScenarioDefinition {
  readonly scenarioId: string;
  readonly name: string;
  readonly requirementIds: readonly string[];
  readonly execute: () => Promise<ScenarioExecutionResult>;
}

export interface ScenarioExecutionResult {
  readonly passed: boolean;
  readonly evidenceIds: readonly string[];
  readonly receiptIds: readonly string[];
  readonly findingIds: readonly string[];
  readonly details: string;
}

// ─── Certification Result ───────────────────────────────────────────────────

export interface CertificationResult {
  readonly scenarioId: string;
  readonly name: string;
  readonly passed: boolean;
  readonly evidenceIds: readonly string[];
  readonly receiptIds: readonly string[];
  readonly findingIds: readonly string[];
  readonly details: string;
  readonly requirementIds: readonly string[];
}

// ─── Certification Suite Result ─────────────────────────────────────────────

export interface CertificationSuiteResult {
  readonly overallPass: boolean;
  readonly results: readonly CertificationResult[];
  readonly timestamp: Instant;
  readonly totalScenarios: number;
  readonly passedScenarios: number;
  readonly failedScenarios: number;
}

// ─── Signed Certification Manifest ──────────────────────────────────────────

export interface SignedCertificationManifest {
  readonly manifest: CapabilityManifest;
  readonly evidenceHashes: readonly Sha256Digest[];
  readonly envelope: CtpEnvelope<CertificationManifestPayload>;
}

export interface CertificationManifestPayload {
  readonly manifestDigest: string;
  readonly evidenceHashes: readonly string[];
  readonly certificationTimestamp: string;
  readonly scenarioCount: number;
  readonly allPassed: boolean;
}

// ─── Pilot Certification Class ──────────────────────────────────────────────

export interface PilotCertificationConfig {
  readonly signer: Signer;
  readonly kid: string;
  readonly environment: CtpEnvironment;
}

/**
 * PilotCertification orchestrates the full certification workflow:
 * 1. Run all PILOT.md scenarios through reference-buyer infrastructure
 * 2. Collect evidence (receipts, findings, scenario results)
 * 3. Build and sign evidence bundle
 * 4. Produce CTP-signed capability manifest with evidence hashes
 * 5. Validate requirement traceability
 */
export class PilotCertification {
  readonly #signer: Signer;
  readonly #kid: string;
  readonly #environment: CtpEnvironment;

  #suiteResult: CertificationSuiteResult | null = null;

  public constructor(config: PilotCertificationConfig) {
    this.#signer = config.signer;
    this.#kid = config.kid;
    this.#environment = config.environment;
  }

  /**
   * Runs all scenarios and produces a CertificationSuiteResult.
   * Each scenario is executed independently; failures do not short-circuit.
   */
  public async runCertificationSuite(
    scenarios: readonly ScenarioDefinition[],
    timestamp: Instant,
  ): Promise<CertificationSuiteResult> {
    const results: CertificationResult[] = [];

    for (const scenario of scenarios) {
      const executionResult = await scenario.execute();
      results.push(
        Object.freeze({
          scenarioId: scenario.scenarioId,
          name: scenario.name,
          passed: executionResult.passed,
          evidenceIds: Object.freeze([...executionResult.evidenceIds]),
          receiptIds: Object.freeze([...executionResult.receiptIds]),
          findingIds: Object.freeze([...executionResult.findingIds]),
          details: executionResult.details,
          requirementIds: Object.freeze([...scenario.requirementIds]),
        }),
      );
    }

    const passedScenarios = results.filter((r) => r.passed).length;
    const overallPass = passedScenarios === results.length;

    const suiteResult: CertificationSuiteResult = Object.freeze({
      overallPass,
      results: Object.freeze(results),
      timestamp,
      totalScenarios: results.length,
      passedScenarios,
      failedScenarios: results.length - passedScenarios,
    });

    this.#suiteResult = suiteResult;
    return suiteResult;
  }

  /**
   * Gathers test results, receipts, findings, and manifest snapshot into
   * an evidence bundle. Requires runCertificationSuite to have been called.
   */
  public collectEvidenceBundle(
    manifest: CapabilityManifest,
    timestamp: Instant,
  ): EvidenceBundle {
    if (this.#suiteResult === null) {
      throw new Error("Cannot collect evidence bundle before running certification suite");
    }

    const certResults: CertificationScenarioResult[] = this.#suiteResult.results.map((r) => ({
      scenarioId: r.scenarioId,
      requirementIds: r.requirementIds,
      passed: r.passed,
      evidenceIds: r.evidenceIds,
    }));

    const allReceipts = this.#suiteResult.results.flatMap((r) => [...r.receiptIds]);
    const allFindings = this.#suiteResult.results.flatMap((r) => [...r.findingIds]);

    return buildEvidenceBundle(certResults, manifest, allReceipts, allFindings, timestamp);
  }

  /**
   * Produces a CTP-signed capability manifest with evidence hashes.
   * The signed manifest includes digests of all evidence collected during
   * certification, enabling independent verification.
   */
  public async signCertificationManifest(
    manifest: CapabilityManifest,
    timestamp: Instant,
  ): Promise<SignedCertificationManifest> {
    if (this.#suiteResult === null) {
      throw new Error("Cannot sign manifest before running certification suite");
    }

    // Compute evidence hashes from each scenario's evidence
    const evidenceHashes: Sha256Digest[] = [];
    for (const result of this.#suiteResult.results) {
      if (result.evidenceIds.length > 0) {
        const evidenceContent = new TextEncoder().encode(
          JSON.stringify({ evidenceIds: [...result.evidenceIds].sort(), scenarioId: result.scenarioId }),
        );
        evidenceHashes.push(sha256Digest(evidenceContent));
      }
    }

    const payload: CertificationManifestPayload = {
      manifestDigest: manifest.signatureDigest,
      evidenceHashes: evidenceHashes.map((h) => h as string),
      certificationTimestamp: String(timestamp),
      scenarioCount: this.#suiteResult.totalScenarios,
      allPassed: this.#suiteResult.overallPass,
    };

    const nonce = generateNonce((length) => randomBytes(length));
    const now = new Date().toISOString();
    const expiresAt = new Date(Date.now() + 3_600_000).toISOString();

    const unsignedResult = buildUnsignedEnvelope<CertificationManifestPayload>({
      type: "counter.evidence.v1",
      id: `ctr_evidence_cert_manifest_${Date.now()}`,
      issuer: "counter://pilot-certification",
      subject: `counter://merchant/${manifest.merchantId}`,
      audience: ["counter://pilot-verifier"],
      environment: this.#environment,
      issued_at: now,
      not_before: now,
      expires_at: expiresAt,
      nonce,
      correlation_id: `ctr_cert_manifest_${Date.now()}`,
      payload,
      evidence_refs: evidenceHashes.map((h, i) => ({
        type: "certification-evidence",
        id: `evidence-${i}`,
        digest: h as string,
      })),
      kid: this.#kid,
    });

    if (!unsignedResult.ok) {
      throw new Error(`Failed to build unsigned envelope: ${unsignedResult.error.message}`);
    }

    const signedResult = await signEnvelope(unsignedResult.value, this.#signer);
    if (!signedResult.ok) {
      throw new Error(`Failed to sign envelope: ${signedResult.error.message}`);
    }

    return Object.freeze({
      manifest,
      evidenceHashes: Object.freeze([...evidenceHashes]),
      envelope: signedResult.value,
    });
  }

  /**
   * Validates requirement traceability of the current suite results.
   */
  public validateRequirementTraceability(): {
    readonly matrix: ReturnType<typeof buildTraceabilityMatrix>;
    readonly validation: ReturnType<typeof validateTraceability>;
  } {
    if (this.#suiteResult === null) {
      throw new Error("Cannot validate traceability before running certification suite");
    }

    const certResults: CertificationScenarioResult[] = this.#suiteResult.results.map((r) => ({
      scenarioId: r.scenarioId,
      requirementIds: r.requirementIds,
      passed: r.passed,
      evidenceIds: r.evidenceIds,
    }));

    const matrix = buildTraceabilityMatrix(certResults, PILOT_REQUIREMENTS);
    const validation = validateTraceability(matrix);

    return Object.freeze({ matrix, validation });
  }

  /**
   * Full certification workflow: run suite, collect evidence, sign manifest.
   */
  public async certify(
    scenarios: readonly ScenarioDefinition[],
    manifest: CapabilityManifest,
    timestamp: Instant,
  ): Promise<{
    readonly suiteResult: CertificationSuiteResult;
    readonly evidenceBundle: EvidenceBundle;
    readonly signedBundle: SignedEvidenceBundle;
    readonly signedManifest: SignedCertificationManifest;
  }> {
    const suiteResult = await this.runCertificationSuite(scenarios, timestamp);
    const evidenceBundle = this.collectEvidenceBundle(manifest, timestamp);
    const signedBundle = await signBundle(evidenceBundle, this.#signer, this.#kid, this.#environment);
    const signedManifest = await this.signCertificationManifest(manifest, timestamp);

    return Object.freeze({
      suiteResult,
      evidenceBundle,
      signedBundle,
      signedManifest,
    });
  }
}
