/**
 * Evidence bundle for pilot certification.
 *
 * Aggregates all certification artifacts (scenario results, receipts, findings,
 * and manifest snapshot) into a cohesive bundle that can be CTP-signed and
 * independently verified.
 */

import type { Instant, Sha256Digest } from "@counter/domain";
import { sha256Digest } from "@counter/domain";
import type { CtpEnvelope, CtpEnvironment, Signer } from "@counter/trust-protocol";
import {
  buildUnsignedEnvelope,
  generateNonce,
  signEnvelope,
  verifyEnvelope,
  InMemoryKeyRegistry,
  TEST_KEY_RECORD_A,
  TEST_KEY_RECORD_B,
} from "@counter/trust-protocol";
import { randomBytes } from "node:crypto";

import type { CapabilityManifest } from "./capability-manifest.js";
import type { CertificationScenarioResult } from "./requirement-traceability.js";

// ─── Evidence Bundle ────────────────────────────────────────────────────────

export interface EvidenceBundle {
  readonly scenarioResults: readonly CertificationScenarioResult[];
  readonly receipts: readonly string[];
  readonly findings: readonly string[];
  readonly manifestSnapshot: CapabilityManifest;
  readonly timestamp: Instant;
  readonly version: string;
  readonly bundleDigest: Sha256Digest;
}

// ─── Signed Evidence Bundle ─────────────────────────────────────────────────

export interface SignedEvidenceBundle {
  readonly bundle: EvidenceBundle;
  readonly envelope: CtpEnvelope<EvidenceBundlePayload>;
}

export interface EvidenceBundlePayload {
  readonly bundleDigest: string;
  readonly version: string;
  readonly scenarioCount: number;
  readonly receiptCount: number;
  readonly findingCount: number;
  readonly manifestDigest: string;
  readonly timestamp: string;
}

// ─── Compute Bundle Digest ──────────────────────────────────────────────────

function computeBundleDigest(
  scenarioResults: readonly CertificationScenarioResult[],
  manifest: CapabilityManifest,
  receipts: readonly string[],
  findings: readonly string[],
): Sha256Digest {
  const canonical = JSON.stringify({
    findings: [...findings].sort(),
    manifestDigest: manifest.signatureDigest,
    receipts: [...receipts].sort(),
    scenarios: scenarioResults.map((r) => ({
      evidenceIds: [...r.evidenceIds].sort(),
      passed: r.passed,
      scenarioId: r.scenarioId,
    })),
  });
  const bytes = new TextEncoder().encode(canonical);
  return sha256Digest(bytes);
}

// ─── Build Evidence Bundle ──────────────────────────────────────────────────

/**
 * Aggregates all certification artifacts into an immutable evidence bundle.
 * Computes a deterministic SHA-256 digest over the canonical content.
 */
export function buildEvidenceBundle(
  scenarioResults: readonly CertificationScenarioResult[],
  manifest: CapabilityManifest,
  receipts: readonly string[],
  findings: readonly string[],
  timestamp: Instant,
  version: string = "1.0.0",
): EvidenceBundle {
  const bundleDigest = computeBundleDigest(scenarioResults, manifest, receipts, findings);

  return Object.freeze({
    scenarioResults: Object.freeze([...scenarioResults]),
    receipts: Object.freeze([...receipts]),
    findings: Object.freeze([...findings]),
    manifestSnapshot: manifest,
    timestamp,
    version,
    bundleDigest,
  });
}

// ─── Sign Bundle ────────────────────────────────────────────────────────────

/**
 * Produces a CTP-signed envelope over the bundle digest.
 * The envelope contains the bundle payload summary and is signed with EdDSA.
 */
export async function signBundle(
  bundle: EvidenceBundle,
  signer: Signer,
  kid: string,
  environment: CtpEnvironment,
): Promise<SignedEvidenceBundle> {
  const payload: EvidenceBundlePayload = {
    bundleDigest: bundle.bundleDigest,
    version: bundle.version,
    scenarioCount: bundle.scenarioResults.length,
    receiptCount: bundle.receipts.length,
    findingCount: bundle.findings.length,
    manifestDigest: bundle.manifestSnapshot.signatureDigest,
    timestamp: String(bundle.timestamp),
  };

  const nonce = generateNonce((length) => randomBytes(length));
  const now = new Date().toISOString();
  const expiresAt = new Date(Date.now() + 3_600_000).toISOString();

  const unsignedResult = buildUnsignedEnvelope<EvidenceBundlePayload>({
    type: "counter.evidence.v1",
    id: `ctr_evidence_bundle_${Date.now()}`,
    issuer: "counter://pilot-certification",
    subject: `counter://merchant/${bundle.manifestSnapshot.merchantId}`,
    audience: ["counter://pilot-verifier"],
    environment,
    issued_at: now,
    not_before: now,
    expires_at: expiresAt,
    nonce,
    correlation_id: `ctr_cert_${Date.now()}`,
    payload,
    evidence_refs: [
      {
        type: "capability-manifest",
        id: bundle.manifestSnapshot.merchantId,
        digest: bundle.manifestSnapshot.signatureDigest,
      },
    ],
    kid,
  });

  if (!unsignedResult.ok) {
    throw new Error(`Failed to build unsigned envelope: ${unsignedResult.error.message}`);
  }

  const signedResult = await signEnvelope(unsignedResult.value, signer);
  if (!signedResult.ok) {
    throw new Error(`Failed to sign envelope: ${signedResult.error.message}`);
  }

  return Object.freeze({
    bundle,
    envelope: signedResult.value,
  });
}

// ─── Verify Bundle ──────────────────────────────────────────────────────────

export interface BundleVerificationResult {
  readonly valid: boolean;
  readonly digestMatch: boolean;
  readonly signatureValid: boolean;
  readonly error?: string;
}

/**
 * Independently verifies a signed evidence bundle.
 * Checks both the bundle digest integrity and the CTP envelope signature.
 */
export async function verifyBundle(
  signedBundle: SignedEvidenceBundle,
): Promise<BundleVerificationResult> {
  const { bundle, envelope } = signedBundle;

  // Verify digest integrity
  const recomputedDigest = computeBundleDigest(
    bundle.scenarioResults,
    bundle.manifestSnapshot,
    bundle.receipts,
    bundle.findings,
  );
  const digestMatch = recomputedDigest === bundle.bundleDigest;

  if (!digestMatch) {
    return Object.freeze({
      valid: false,
      digestMatch: false,
      signatureValid: false,
      error: "Bundle digest does not match recomputed value",
    });
  }

  // Verify CTP signature using the test key registry
  // In production, this would use a real key registry
  const keyRegistry = new InMemoryKeyRegistry();
  keyRegistry.add(TEST_KEY_RECORD_A);
  keyRegistry.add(TEST_KEY_RECORD_B);

  const verifyResult = await verifyEnvelope(envelope as CtpEnvelope, {
    keyRegistry,
    currentTime: new Date().toISOString(),
    expectedAudience: "counter://pilot-verifier",
  });

  if (!verifyResult.ok) {
    return Object.freeze({
      valid: false,
      digestMatch: true,
      signatureValid: false,
      error: `Signature verification failed: ${verifyResult.error.message}`,
    });
  }

  return Object.freeze({
    valid: true,
    digestMatch: true,
    signatureValid: true,
  });
}
