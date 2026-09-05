/**
 * Signing-key resolution for control-plane-api's self-signed buyer-runtime
 * credentials (wallet-user-store.ts's mintRuntimeCredential). Mirrors
 * control-plane-signer-env.ts's requireControlPlaneSigner pattern exactly,
 * but for a DIFFERENT key: this one signs the short-lived RS256 JWT a
 * self-serve buyer's AI agent uses to call agent-runtime's buyer-facing
 * routes, replacing the earlier design (a single shared Auth0 M2M
 * application's client-credentials grant, which could only ever stamp ONE
 * hardcoded scope for every buyer — see wallet-user-store.ts's history).
 *
 * The private key is PKCS8 PEM, base64-encoded for safe storage in a single
 * env var (Fly secrets are single-line-friendly; base64 avoids any
 * newline/quoting hazard). Public key trust lives on agent-runtime's side
 * (see apps/agent-runtime's COUNTER_RUNTIME_TOKEN_PUBLIC_KEY).
 *
 * SECURITY: reads a secret from the environment only, never logs or echoes
 * it. A production-like deployment with the env vars unset fails loud
 * instead of silently signing real buyer credentials with the public test
 * fixture.
 */
import { RUNTIME_TOKEN_TEST_KID, RUNTIME_TOKEN_TEST_PRIVATE_KEY_PEM } from "@counter/domain";

export interface RuntimeTokenSigner {
  readonly kid: string;
  readonly privateKeyPem: string;
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
 * Resolves the deployment's own signing key from RUNTIME_TOKEN_SIGNER_KID /
 * _PRIVATE_KEY_BASE64 (a PKCS8 PEM, base64-encoded). Returns `null` when
 * either is absent or the value does not decode to a PEM block.
 */
export function resolveRuntimeTokenSigner(
  env: EnvironmentBag,
): { readonly kid: string; readonly privateKeyPem: string } | null {
  const kid = readValue(env, "RUNTIME_TOKEN_SIGNER_KID");
  const privateKeyEncoded = readValue(env, "RUNTIME_TOKEN_SIGNER_PRIVATE_KEY_BASE64");
  if (kid === undefined || privateKeyEncoded === undefined) {
    return null;
  }
  const privateKeyPem = Buffer.from(privateKeyEncoded, "base64").toString("utf8");
  if (!privateKeyPem.includes("BEGIN PRIVATE KEY")) {
    return null;
  }
  return { kid, privateKeyPem };
}

/**
 * Applies the same fail-closed policy as requireControlPlaneSigner: a real,
 * deployment-specific key when configured; the named public fixture
 * (RUNTIME_TOKEN_TEST_KID) only in a mock-eligible environment; a
 * production-like deployment with the variables unset throws instead of
 * silently signing with the public fixture.
 */
export function requireRuntimeTokenSigner(
  env: EnvironmentBag,
  inMemoryEligible: boolean,
): RuntimeTokenSigner {
  const resolved = resolveRuntimeTokenSigner(env);
  if (resolved !== null) {
    return { ...resolved, isFixture: false };
  }
  if (inMemoryEligible) {
    return {
      kid: RUNTIME_TOKEN_TEST_KID,
      privateKeyPem: RUNTIME_TOKEN_TEST_PRIVATE_KEY_PEM,
      isFixture: true,
    };
  }
  throw new Error(
    `Refusing to start in a production-like environment without a real ` +
      `runtime-token signing key. Missing required environment variable(s): ` +
      `RUNTIME_TOKEN_SIGNER_KID, RUNTIME_TOKEN_SIGNER_PRIVATE_KEY_BASE64.`,
  );
}
