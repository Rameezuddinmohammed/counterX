/**
 * CTP assurance non-inflation policy.
 *
 * Defines CTP assurance levels and enforces the non-inflation rule:
 * a Counter Wallet service-witnessed attestation (assurance "service_witnessed")
 * MUST fail any rule that requires "direct_principal", "webauthn", or
 * "external_protocol" assurance. Similarly, "agent_proof" cannot satisfy those
 * higher-assurance requirements.
 *
 * The ordering represents the strength of the original consent proof:
 * - direct_principal: the principal personally and directly signed
 * - webauthn: a WebAuthn/passkey ceremony was completed
 * - external_protocol: an external authentication protocol was used
 * - service_witnessed: a service witnessed the authentication (not direct proof)
 * - agent_proof: an agent signed on behalf of the principal
 */

// ---------------------------------------------------------------------------
// CTP Assurance Levels
// ---------------------------------------------------------------------------

export const CTP_ASSURANCE_LEVELS = [
  "direct_principal",
  "webauthn",
  "external_protocol",
  "service_witnessed",
  "agent_proof",
] as const;

export type CtpAssuranceLevel = (typeof CTP_ASSURANCE_LEVELS)[number];

const ctpAssuranceLevelSet: ReadonlySet<string> = new Set(CTP_ASSURANCE_LEVELS);

export function isCtpAssuranceLevel(value: unknown): value is CtpAssuranceLevel {
  return typeof value === "string" && ctpAssuranceLevelSet.has(value);
}

// ---------------------------------------------------------------------------
// Assurance Level Strength (higher number = stronger assurance)
// ---------------------------------------------------------------------------

const ASSURANCE_STRENGTH: Readonly<Record<CtpAssuranceLevel, number>> = Object.freeze({
  direct_principal: 4,
  webauthn: 3,
  external_protocol: 2,
  service_witnessed: 1,
  agent_proof: 0,
});

// ---------------------------------------------------------------------------
// Non-Inflation Rule
// ---------------------------------------------------------------------------

/**
 * Levels that require direct proof of principal action and CANNOT be
 * satisfied by service_witnessed or agent_proof.
 */
const DIRECT_PROOF_LEVELS: ReadonlySet<CtpAssuranceLevel> = new Set([
  "direct_principal",
  "webauthn",
  "external_protocol",
]);

/**
 * Levels that represent indirect/delegated proof and CANNOT satisfy
 * direct proof requirements.
 */
const INDIRECT_PROOF_LEVELS: ReadonlySet<CtpAssuranceLevel> = new Set([
  "service_witnessed",
  "agent_proof",
]);

/**
 * Determines if the actual assurance level meets the required assurance level.
 *
 * Non-inflation rule: service_witnessed and agent_proof CANNOT satisfy
 * direct_principal, webauthn, or external_protocol requirements.
 *
 * Within the same class (direct vs indirect), higher strength satisfies
 * lower requirements (e.g., direct_principal satisfies webauthn requirement).
 */
export function meetsAssuranceRequirement(
  actual: CtpAssuranceLevel,
  required: CtpAssuranceLevel,
): boolean {
  // Non-inflation: indirect proof cannot satisfy direct proof requirements
  if (INDIRECT_PROOF_LEVELS.has(actual) && DIRECT_PROOF_LEVELS.has(required)) {
    return false;
  }

  // Within the allowed domain, check strength ordering
  return ASSURANCE_STRENGTH[actual] >= ASSURANCE_STRENGTH[required];
}

/**
 * Returns the strength ordering value for an assurance level.
 * Higher values indicate stronger assurance.
 */
export function assuranceStrength(level: CtpAssuranceLevel): number {
  return ASSURANCE_STRENGTH[level];
}
