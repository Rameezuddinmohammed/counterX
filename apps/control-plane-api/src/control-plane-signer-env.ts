/**
 * Signing-key resolution for control-plane-api's own CTP-signed evidence
 * (currently: the durable revocation trail — see revocation-service.ts's
 * wiring in main.ts). Mirrors apps/worker/src/connector-env.ts's
 * requireCounterTestPaymentSigner pattern exactly, but with its own env vars
 * and its own named test fixture — this is a DIFFERENT signing key from the
 * worker's COUNTER_TEST_PAYMENT_SIGNER_KID/_SEED (that one signs unattended
 * payment-authorize/capture evidence; this one signs control-plane-api's own
 * revocation envelopes), so the two must never share a key or an env var
 * name.
 *
 * SECURITY: reads a secret from the environment only, never logs or echoes
 * it. A production-like deployment with the env vars unset fails loud
 * instead of silently signing real evidence with the public test fixture.
 */
import { TEST_KID_B, getTestPrivateKeyB } from "@counter/trust-protocol";

export interface ControlPlaneSigner {
  readonly kid: string;
  readonly seed: Uint8Array;
  readonly isFixture: boolean;
}

/** Minimal environment shape: a bag of optional string values. */
export type EnvironmentBag = Readonly<Record<string, string | undefined>>;

function readValue(env: EnvironmentBag, name: string): string | undefined {
  const raw = env[name];
  if (raw === undefined) {
    return undefined;
  }
  const trimmed = raw.trim();
  return trimmed.length > 0 ? trimmed : undefined;
}

/**
 * Resolves the deployment's own signing key from CONTROL_PLANE_SIGNER_KID /
 * _SEED (a 32-byte Ed25519 seed, base64url-encoded). Returns `null` when
 * either is absent or the seed does not decode to exactly 32 bytes.
 */
export function resolveControlPlaneSigner(
  env: EnvironmentBag,
): { readonly kid: string; readonly seed: Uint8Array } | null {
  const kid = readValue(env, "CONTROL_PLANE_SIGNER_KID");
  const seedEncoded = readValue(env, "CONTROL_PLANE_SIGNER_SEED");
  if (kid === undefined || seedEncoded === undefined) {
    return null;
  }
  const seed = new Uint8Array(Buffer.from(seedEncoded, "base64url"));
  if (seed.length !== 32) {
    return null;
  }
  return { kid, seed };
}

/**
 * Applies the same fail-closed policy as requireCounterTestPaymentSigner: a
 * real, deployment-specific key when configured; the named public fixture
 * (TEST_KID_B) only in a mock-eligible environment; a production-like
 * deployment with the variables unset throws instead of silently signing
 * with the public fixture.
 */
export function requireControlPlaneSigner(
  env: EnvironmentBag,
  inMemoryEligible: boolean,
): ControlPlaneSigner {
  const resolved = resolveControlPlaneSigner(env);
  if (resolved !== null) {
    return { ...resolved, isFixture: false };
  }
  if (inMemoryEligible) {
    return { kid: TEST_KID_B, seed: getTestPrivateKeyB(), isFixture: true };
  }
  throw new Error(
    `Refusing to start in a production-like environment without a real ` +
      `control-plane signing key. Missing required environment variable(s): ` +
      `CONTROL_PLANE_SIGNER_KID, CONTROL_PLANE_SIGNER_SEED.`,
  );
}
