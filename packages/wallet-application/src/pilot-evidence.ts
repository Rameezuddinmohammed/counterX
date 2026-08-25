/**
 * Pilot evidence bundle builder.
 *
 * Collects scenario results from pilot testing, maps them to wallet
 * implementation evidence, and produces a signed bundle proving parity
 * with the reference-buyer corpus.
 *
 * IMPORTANT: This bundle does NOT claim live autonomy. It only proves
 * that the wallet implementation passes the same scenarios as the
 * reference-buyer test corpus in a controlled pilot environment.
 */

import type { UnsignedCtpEnvelope } from "@counter/trust-protocol";
import { buildUnsignedEnvelope } from "@counter/trust-protocol";

// ---------------------------------------------------------------------------
// Scenario Result Types
// ---------------------------------------------------------------------------

export interface ScenarioResult {
  readonly scenarioId: string;
  readonly scenarioName: string;
  readonly corpusRef: string;
  readonly passed: boolean;
  readonly executedAt: string;
  readonly durationMs: number;
  readonly notes?: string;
}

// ---------------------------------------------------------------------------
// Evidence Mapping
// ---------------------------------------------------------------------------

export interface EvidenceMapping {
  readonly corpusScenarioId: string;
  readonly walletScenarioId: string;
  readonly coverageType: CoverageType;
  readonly description: string;
}

export const COVERAGE_TYPES = [
  "exact_parity",
  "functional_equivalent",
  "partial_coverage",
  "not_applicable",
] as const;

export type CoverageType = (typeof COVERAGE_TYPES)[number];

// ---------------------------------------------------------------------------
// Bundle Payload
// ---------------------------------------------------------------------------

export interface PilotEvidencePayload {
  readonly bundle_id: string;
  readonly created_at: string;
  readonly environment: "pilot";
  readonly corpus_version: string;
  readonly total_scenarios: number;
  readonly passed_scenarios: number;
  readonly failed_scenarios: number;
  readonly coverage_mappings: readonly EvidenceMapping[];
  readonly live_autonomy_claim: false;
  readonly parity_assertion: string;
  readonly version: string;
}

// ---------------------------------------------------------------------------
// Bundle Error
// ---------------------------------------------------------------------------

export interface PilotEvidenceError {
  readonly kind: "pilot_evidence_error";
  readonly reason: string;
}

export type PilotEvidenceResult<T> =
  | { readonly ok: true; readonly value: T }
  | { readonly ok: false; readonly error: PilotEvidenceError };

// ---------------------------------------------------------------------------
// PilotEvidenceBundle
// ---------------------------------------------------------------------------

export class PilotEvidenceBundle {
  readonly #scenarios: ScenarioResult[] = [];
  readonly #mappings: EvidenceMapping[] = [];
  #corpusVersion = "unknown";

  /**
   * Sets the reference-buyer corpus version this bundle maps against.
   */
  setCorpusVersion(version: string): void {
    this.#corpusVersion = version;
  }

  /**
   * Records a scenario execution result.
   */
  addScenarioResult(result: ScenarioResult): void {
    this.#scenarios.push(result);
  }

  /**
   * Adds a coverage mapping between a corpus scenario and a wallet scenario.
   */
  addCoverageMapping(mapping: EvidenceMapping): void {
    this.#mappings.push(mapping);
  }

  /**
   * Returns all recorded scenario results.
   */
  getScenarios(): readonly ScenarioResult[] {
    return [...this.#scenarios];
  }

  /**
   * Returns all coverage mappings.
   */
  getMappings(): readonly EvidenceMapping[] {
    return [...this.#mappings];
  }

  /**
   * Computes parity statistics.
   */
  getParityStats(): { total: number; passed: number; failed: number; parityPercent: number } {
    const total = this.#scenarios.length;
    const passed = this.#scenarios.filter((s) => s.passed).length;
    const failed = total - passed;
    const parityPercent = total > 0 ? Math.round((passed / total) * 100) : 0;
    return { total, passed, failed, parityPercent };
  }

  /**
   * Asserts that this bundle does NOT claim live autonomy.
   * Always returns false - the pilot evidence is for controlled environment only.
   */
  claimsLiveAutonomy(): false {
    return false;
  }

  /**
   * Builds the evidence bundle payload and wraps it in a CTP unsigned envelope.
   * The bundle explicitly states no live autonomy is claimed.
   */
  buildBundle(
    bundleId: string,
    kid: string,
    walletId: string,
  ): PilotEvidenceResult<UnsignedCtpEnvelope<PilotEvidencePayload>> {
    if (this.#scenarios.length === 0) {
      return {
        ok: false,
        error: { kind: "pilot_evidence_error", reason: "No scenarios recorded" },
      };
    }

    const stats = this.getParityStats();
    const now = new Date().toISOString();
    const farFuture = new Date(Date.now() + 365 * 24 * 60 * 60 * 1000).toISOString();

    const payload: PilotEvidencePayload = {
      bundle_id: bundleId,
      created_at: now,
      environment: "pilot",
      corpus_version: this.#corpusVersion,
      total_scenarios: stats.total,
      passed_scenarios: stats.passed,
      failed_scenarios: stats.failed,
      coverage_mappings: [...this.#mappings],
      live_autonomy_claim: false,
      parity_assertion: `Wallet implementation demonstrates ${stats.parityPercent}% parity with reference-buyer corpus v${this.#corpusVersion} in pilot environment. No live autonomy is claimed.`,
      version: "1",
    };

    const nonceBytes = new Uint8Array(16);
    crypto.getRandomValues(nonceBytes);
    let binary = "";
    for (const b of nonceBytes) {
      binary += String.fromCharCode(b);
    }
    const nonce = btoa(binary).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");

    const envelopeResult = buildUnsignedEnvelope<PilotEvidencePayload>({
      type: "counter.revocation.v1",
      id: bundleId,
      issuer: `counter://wallet/${walletId}`,
      subject: `counter://wallet/${walletId}/pilot-evidence`,
      audience: [`counter://wallet/${walletId}`],
      environment: "pilot",
      issued_at: now,
      not_before: now,
      expires_at: farFuture,
      nonce,
      correlation_id: `pilot-evidence-${bundleId}`,
      payload,
      kid,
    });

    if (!envelopeResult.ok) {
      return {
        ok: false,
        error: { kind: "pilot_evidence_error", reason: "Failed to build evidence envelope" },
      };
    }

    return { ok: true, value: envelopeResult.value };
  }
}
