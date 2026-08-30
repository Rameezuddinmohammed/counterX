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

// ─── Fulfillment Capabilities ───────────────────────────────────────────────

/**
 * How a merchant actually gets goods/services to the buyer once a purchase
 * completes — orthogonal to PILOT_CAPABILITIES above (which describe the
 * transaction protocol steps, not what's being fulfilled). Added for the
 * self-serve onboarding wizard (Step 1's goods-type multi-select) so the
 * wizard fits far more than physical-vs-digital retail. Additive: does not
 * replace or narrow PILOT_CAPABILITIES.
 */
export const FULFILLMENT_CAPABILITIES = [
  "fulfillment.physical.ship", // ships to an address
  "fulfillment.digital.deliver", // instant electronic delivery, no address
  "fulfillment.access.grant", // subscription/membership/paywall access, nothing shipped
  "fulfillment.booking.schedule", // appointment/time-slot, may require physical presence
  "fulfillment.event.ticket", // fixed-inventory, time-bound entry credential (tickets, reservations)
  "fulfillment.rental.temporary", // temporary possession + return/deposit logic
  "fulfillment.quote.custom", // no fixed catalog price — needs a human quote before any transaction
] as const;

export type FulfillmentCapability = (typeof FULFILLMENT_CAPABILITIES)[number];

const fulfillmentCapabilitySet: ReadonlySet<string> = new Set(FULFILLMENT_CAPABILITIES);

export function isFulfillmentCapability(value: unknown): value is FulfillmentCapability {
  return typeof value === "string" && fulfillmentCapabilitySet.has(value);
}

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
  /** Optional/additive — empty array is valid. See FULFILLMENT_CAPABILITIES. */
  readonly fulfillmentCapabilities?: readonly FulfillmentCapability[];
  readonly versionBindings: VersionBindings;
  readonly generatedAt: Instant;
  readonly signatureDigest: Sha256Digest;
}

// ─── Generate Manifest Input ────────────────────────────────────────────────

export interface GenerateManifestInput {
  readonly merchantId: CounterId<"merchant">;
  readonly manifestVersion: string;
  readonly capabilities: readonly PilotCapability[];
  /** Optional/additive — empty array is valid. See FULFILLMENT_CAPABILITIES. */
  readonly fulfillmentCapabilities?: readonly FulfillmentCapability[];
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
    fulfillmentCapabilities: [...(input.fulfillmentCapabilities ?? [])].sort(),
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
    ...(input.fulfillmentCapabilities !== undefined
      ? { fulfillmentCapabilities: Object.freeze([...input.fulfillmentCapabilities]) }
      : {}),
    versionBindings: Object.freeze({ ...input.versionBindings }),
    generatedAt: input.generatedAt,
    signatureDigest,
  });

  return ok(manifest);
}
