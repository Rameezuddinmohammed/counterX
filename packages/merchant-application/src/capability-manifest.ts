/**
 * Capability manifest for merchant activation.
 *
 * Binds all version references and generates a deterministic SHA-256 signature
 * from canonical JSON serialization. The manifest declares the capabilities
 * available in the pilot release.
 */

import type { CounterId, Instant, Sha256Digest, Result } from "@counter/domain";
import { sha256Digest, createCanonicalError, ok, err } from "@counter/domain";

// ─── Pilot Capabilities ─────────────────────────────────────────────────────

export const PILOT_CAPABILITIES = [
  "quote.create",
  "quote.accept",
  "payment.initiate",
  "payment.confirm",
  "refund.initiate",
] as const;

export type PilotCapability = (typeof PILOT_CAPABILITIES)[number];

// ─── Version Bindings ───────────────────────────────────────────────────────

export interface VersionBindings {
  readonly connectorVersion: string;
  readonly mappingSchemaHash: Sha256Digest;
  readonly policyVersion: string;
  readonly protocolVersion: string;
  readonly paymentProviderVersion: string;
}

// ─── Capability Manifest ────────────────────────────────────────────────────

export interface CapabilityManifest {
  readonly merchantId: CounterId<"merchant">;
  readonly manifestVersion: string;
  readonly capabilities: readonly PilotCapability[];
  readonly versionBindings: VersionBindings;
  readonly generatedAt: Instant;
  readonly signatureDigest: Sha256Digest;
}

// ─── Generate Manifest Input ────────────────────────────────────────────────

export interface GenerateManifestInput {
  readonly merchantId: CounterId<"merchant">;
  readonly manifestVersion: string;
  readonly capabilities: readonly PilotCapability[];
  readonly versionBindings: VersionBindings;
  readonly generatedAt: Instant;
}

// ─── Semver Pattern ─────────────────────────────────────────────────────────

const SEMVER_PATTERN = /^\d+\.\d+\.\d+(?:-[a-zA-Z0-9.]+)?$/u;

// ─── Canonical JSON Serialization ───────────────────────────────────────────

function toCanonicalJson(input: GenerateManifestInput): string {
  // Deterministic serialization: sorted keys, no extra whitespace
  const canonical = {
    capabilities: [...input.capabilities].sort(),
    generatedAt: input.generatedAt,
    manifestVersion: input.manifestVersion,
    merchantId: input.merchantId,
    versionBindings: {
      connectorVersion: input.versionBindings.connectorVersion,
      mappingSchemaHash: input.versionBindings.mappingSchemaHash,
      paymentProviderVersion: input.versionBindings.paymentProviderVersion,
      policyVersion: input.versionBindings.policyVersion,
      protocolVersion: input.versionBindings.protocolVersion,
    },
  };
  return JSON.stringify(canonical);
}

// ─── Sign Manifest ──────────────────────────────────────────────────────────

/**
 * Computes a deterministic SHA-256 digest of the canonical manifest content.
 * The signature is computed over sorted keys, sorted capabilities, and
 * version binding fields in alphabetical order.
 */
export function signManifest(input: GenerateManifestInput): Sha256Digest {
  const canonical = toCanonicalJson(input);
  const bytes = new TextEncoder().encode(canonical);
  return sha256Digest(bytes);
}

// ─── Generate Manifest ──────────────────────────────────────────────────────

/**
 * Generates a complete capability manifest with a deterministic signature.
 * Validates the manifest version as semver and ensures at least one capability.
 */
export function generateManifest(input: GenerateManifestInput): Result<CapabilityManifest> {
  if (!SEMVER_PATTERN.test(input.manifestVersion)) {
    return err(
      createCanonicalError({
        category: "validation",
        code: "INVALID_FORMAT",
        message: "Manifest version must be valid semver",
      }),
    );
  }

  if (input.capabilities.length === 0) {
    return err(
      createCanonicalError({
        category: "validation",
        code: "INVALID_FORMAT",
        message: "Manifest must declare at least one capability",
      }),
    );
  }

  const signatureDigest = signManifest(input);

  const manifest: CapabilityManifest = Object.freeze({
    merchantId: input.merchantId,
    manifestVersion: input.manifestVersion,
    capabilities: Object.freeze([...input.capabilities]),
    versionBindings: Object.freeze({ ...input.versionBindings }),
    generatedAt: input.generatedAt,
    signatureDigest,
  });

  return ok(manifest);
}
