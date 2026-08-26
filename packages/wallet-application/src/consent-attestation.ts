/**
 * Consent attestation builder for CTP 'counter.principal-consent-attestation.v1'.
 *
 * Uses @counter/trust-protocol to build CTP envelopes for principal consent.
 * Mandates reference attestation by its payload_digest rather than embedding.
 * Consent text is rendered with version tracking and is immutable once generated.
 */

import type { CounterId } from "@counter/domain";
import type {
  PrincipalConsentAttestationPayload,
  UnsignedCtpEnvelope,
  CtpEnvironment,
} from "@counter/trust-protocol";
import {
  buildUnsignedEnvelope,
  computePayloadDigest,
} from "@counter/trust-protocol";
import type { StepUpAssuranceLevel } from "./step-up-service.js";
import { ConsentTextRenderer } from "./consent-text-renderer.js";
import type { ConsentOperationType, RenderedConsentText } from "./consent-text-renderer.js";

// ---------------------------------------------------------------------------
// Auth Methods
// ---------------------------------------------------------------------------

export const CONSENT_AUTH_METHODS = [
  "pilot_password",
  "webauthn",
  "external_provider",
] as const;

export type ConsentAuthMethod = (typeof CONSENT_AUTH_METHODS)[number];

const consentAuthMethodSet: ReadonlySet<string> = new Set(CONSENT_AUTH_METHODS);

export function isConsentAuthMethod(value: unknown): value is ConsentAuthMethod {
  return typeof value === "string" && consentAuthMethodSet.has(value);
}

// ---------------------------------------------------------------------------
// Consent Attestation Input
// ---------------------------------------------------------------------------

export interface ConsentAttestationInput {
  readonly principal_id: CounterId<"actor">;
  readonly wallet_id: CounterId<"wallet">;
  readonly object_type: string;
  readonly object_id: string;
  readonly object_digest: string;
  readonly consent_operation: ConsentOperationType;
  readonly consent_variables: Readonly<Record<string, string>>;
  readonly auth_provider: string;
  readonly auth_method: ConsentAuthMethod;
  readonly auth_assurance: StepUpAssuranceLevel;
  readonly auth_timestamp: string;
  readonly audience: readonly string[];
  readonly expiry: string;
  readonly nonce: string;
  readonly environment: CtpEnvironment;
  readonly kid: string;
  readonly correlation_id: string;
  readonly step_up_evidence_ref?: string | undefined;
  readonly revocation_locator?: string | undefined;
}

// ---------------------------------------------------------------------------
// Consent Attestation Result
// ---------------------------------------------------------------------------

export interface ConsentAttestationOutput {
  readonly envelope: UnsignedCtpEnvelope<PrincipalConsentAttestationPayload>;
  readonly consent_text: RenderedConsentText;
  readonly payload_digest: string;
}

// ---------------------------------------------------------------------------
// Consent Attestation Error
// ---------------------------------------------------------------------------

export interface ConsentAttestationError {
  readonly kind: "consent_attestation_error";
  readonly reason: string;
}

export type ConsentAttestationResult =
  | { readonly ok: true; readonly value: ConsentAttestationOutput }
  | { readonly ok: false; readonly error: ConsentAttestationError };

// ---------------------------------------------------------------------------
// Nonce Tracker (replay prevention)
// ---------------------------------------------------------------------------

export class ConsentNonceTracker {
  private readonly usedNonces = new Set<string>();

  /**
   * Returns true if the nonce has already been consumed.
   */
  isUsed(nonce: string): boolean {
    return this.usedNonces.has(nonce);
  }

  /**
   * Consumes a nonce, marking it as used.
   */
  consume(nonce: string): void {
    this.usedNonces.add(nonce);
  }

  /**
   * Resets all consumed nonces (test utility).
   */
  reset(): void {
    this.usedNonces.clear();
  }
}

// ---------------------------------------------------------------------------
// ConsentAttestationBuilder
// ---------------------------------------------------------------------------

export class ConsentAttestationBuilder {
  private readonly renderer: ConsentTextRenderer;
  private readonly nonceTracker: ConsentNonceTracker;

  constructor(nonceTracker?: ConsentNonceTracker) {
    this.renderer = new ConsentTextRenderer();
    this.nonceTracker = nonceTracker ?? new ConsentNonceTracker();
  }

  /**
   * Builds an unsigned CTP consent attestation envelope.
   *
   * Validates:
   * - Nonce has not been used (replay prevention)
   * - Audience is non-empty
   * - Object digest matches expected format
   * - Consent text renders successfully
   */
  build(input: ConsentAttestationInput): ConsentAttestationResult {
    // Check nonce replay
    if (this.nonceTracker.isUsed(input.nonce)) {
      return {
        ok: false,
        error: {
          kind: "consent_attestation_error",
          reason: "Nonce has already been used (replay attack detected)",
        },
      };
    }

    // Validate audience
    if (!input.audience || input.audience.length === 0) {
      return {
        ok: false,
        error: {
          kind: "consent_attestation_error",
          reason: "Audience must be non-empty",
        },
      };
    }

    // Validate object digest format
    if (!input.object_digest.startsWith("sha256:")) {
      return {
        ok: false,
        error: {
          kind: "consent_attestation_error",
          reason: "Object digest must use sha256: prefix format",
        },
      };
    }

    // Render consent text
    const consentText = this.renderer.render({
      operation: input.consent_operation,
      variables: input.consent_variables,
    });

    if (!consentText) {
      return {
        ok: false,
        error: {
          kind: "consent_attestation_error",
          reason: `Unknown consent operation type: ${input.consent_operation}`,
        },
      };
    }

    // Build payload - handle optional fields explicitly for exactOptionalPropertyTypes
    const payload: PrincipalConsentAttestationPayload = {
      principal_id: input.principal_id,
      wallet_id: input.wallet_id,
      object_type: input.object_type,
      object_id: input.object_id,
      object_digest: input.object_digest,
      consent_text: consentText.text,
      consent_version: consentText.version,
      auth_provider: input.auth_provider,
      auth_method: input.auth_method,
      auth_assurance: input.auth_assurance,
      auth_time: input.auth_timestamp,
      auth_timestamp: input.auth_timestamp,
      audience: input.audience,
      expiry: input.expiry,
      nonce: input.nonce,
      ...(input.step_up_evidence_ref !== undefined
        ? { step_up_evidence_ref: input.step_up_evidence_ref }
        : {}),
      ...(input.revocation_locator !== undefined
        ? { revocation_locator: input.revocation_locator }
        : {}),
    };

    // Build envelope
    const now = input.auth_timestamp;
    const evidenceRefs = input.step_up_evidence_ref
      ? [{ type: "step-up", id: input.step_up_evidence_ref, digest: input.object_digest }]
      : [];

    const envelopeResult = buildUnsignedEnvelope<PrincipalConsentAttestationPayload>({
      type: "counter.principal-consent-attestation.v1",
      id: `consent-${input.nonce}`,
      issuer: `counter://wallet/${input.wallet_id}`,
      subject: input.principal_id,
      audience: input.audience,
      environment: input.environment,
      issued_at: now,
      not_before: now,
      expires_at: input.expiry,
      nonce: input.nonce,
      correlation_id: input.correlation_id,
      payload,
      kid: input.kid,
      evidence_refs: evidenceRefs,
    });

    if (!envelopeResult.ok) {
      return {
        ok: false,
        error: {
          kind: "consent_attestation_error",
          reason: `Envelope construction failed: ${envelopeResult.error.message}`,
        },
      };
    }

    // Consume nonce to prevent replay
    this.nonceTracker.consume(input.nonce);

    // Compute payload digest for reference
    const payloadDigest = computePayloadDigest(payload);

    return {
      ok: true,
      value: {
        envelope: envelopeResult.value,
        consent_text: consentText,
        payload_digest: payloadDigest,
      },
    };
  }

  /**
   * Validates that a given digest matches the expected attestation payload digest.
   */
  validateDigest(actual: string, expected: string): boolean {
    return actual === expected;
  }

  /**
   * Validates that the audience in an attestation includes the expected audience.
   */
  validateAudience(
    attestationAudience: readonly string[],
    expectedAudience: string,
  ): boolean {
    return attestationAudience.includes(expectedAudience);
  }
}
