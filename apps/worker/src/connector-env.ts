/**
 * Credential-gating helper for the real Shopify + Razorpay connectors.
 *
 * This module resolves connector credentials from environment variables and
 * applies a single, shared environment policy:
 *
 *   - local / test / development  -> missing credentials return `null`, which
 *     signals callers to fall back to the deterministic mock connectors.
 *   - production / sandbox / pilot (and any unknown value) -> missing
 *     credentials THROW a fail-loud error naming the absent variable(s).
 *
 * The prod-like classification mirrors the existing convention used by the
 * make-it-real milestone's fail-closed handler guard in
 * `apps/agent-runtime/src/index.ts`: only `local`, `test`, and `development`
 * are mock-eligible; everything else is production-like.
 *
 * SECURITY: This module reads secrets from environment variables only. It
 * NEVER logs, echoes, or hardcodes any secret value. Error messages name the
 * missing variables (names only) and never include their values.
 */

import { TEST_KID_A, getTestPrivateKeyA } from "@counter/trust-protocol";

/** Resolved Shopify Admin API credentials. */
export interface ShopifyCredentials {
  readonly shopDomain: string;
  readonly accessToken: string;
  readonly apiVersion: string;
}

/** Resolved Razorpay API credentials. */
export interface RazorpayCredentials {
  readonly keyId: string;
  readonly keySecret: string;
  readonly webhookSecret: string;
  readonly baseUrl: string;
}

/**
 * Resolved signing material for the unattended CTP-signed test-payment
 * evidence (`CounterTestPaymentProvider`). A 32-byte Ed25519 seed, decoded
 * from base64url.
 */
export interface CounterTestPaymentSigner {
  readonly kid: string;
  readonly seed: Uint8Array;
}

/** Minimal environment shape: a bag of optional string values. */
export type EnvironmentBag = Readonly<Record<string, string | undefined>>;

/** Default Shopify Admin API version when `SHOPIFY_API_VERSION` is unset. */
export const DEFAULT_SHOPIFY_API_VERSION = "2025-07";

/** Default Razorpay API base URL when `RAZORPAY_BASE_URL` is unset. */
export const DEFAULT_RAZORPAY_BASE_URL = "https://api.razorpay.com";

/**
 * Environments where mock connectors may be used and where missing
 * credentials are tolerated (resolve to `null`). Mirrors
 * `MOCK_ELIGIBLE_ENVIRONMENTS` in `apps/agent-runtime/src/index.ts`.
 */
const MOCK_ELIGIBLE_ENVIRONMENTS: ReadonlySet<string> = new Set(["local", "test", "development"]);

/**
 * Reads and trims a single environment value, treating empty/whitespace-only
 * strings as absent.
 */
function readValue(env: EnvironmentBag, name: string): string | undefined {
  const raw = env[name];
  if (raw === undefined) {
    return undefined;
  }
  const trimmed = raw.trim();
  return trimmed.length > 0 ? trimmed : undefined;
}

/**
 * Classifies an environment bag as production-like.
 *
 * Reads `COUNTER_ENV` first, falling back to `NODE_ENV`. Any value other than
 * `local`, `test`, or `development` (including an absent value) is treated as
 * production-like so a misconfigured deploy fails fast rather than silently
 * running against mocks.
 */
export function isProdLike(env: EnvironmentBag): boolean {
  const environment = readValue(env, "COUNTER_ENV") ?? readValue(env, "NODE_ENV");
  if (environment === undefined) {
    return true;
  }
  return !MOCK_ELIGIBLE_ENVIRONMENTS.has(environment);
}

/**
 * Resolves Shopify credentials from the environment.
 *
 * Returns the parsed configuration when the shop domain and access token are
 * both present (the API version defaults to {@link DEFAULT_SHOPIFY_API_VERSION}
 * when unset). Returns `null` when either required variable is absent.
 *
 * The shop domain is read from `SHOPIFY_STORE_DOMAIN`, falling back to the
 * legacy `SHOPIFY_SHOP_DOMAIN`.
 */
export function resolveShopifyCredentials(env: EnvironmentBag): ShopifyCredentials | null {
  const shopDomain =
    readValue(env, "SHOPIFY_STORE_DOMAIN") ?? readValue(env, "SHOPIFY_SHOP_DOMAIN");
  const accessToken = readValue(env, "SHOPIFY_ACCESS_TOKEN");

  if (shopDomain === undefined || accessToken === undefined) {
    return null;
  }

  const apiVersion = readValue(env, "SHOPIFY_API_VERSION") ?? DEFAULT_SHOPIFY_API_VERSION;

  return { shopDomain, accessToken, apiVersion };
}

/**
 * Resolves Razorpay credentials from the environment.
 *
 * Returns the parsed configuration when the key id, key secret, and webhook
 * secret are all present (the base URL defaults to
 * {@link DEFAULT_RAZORPAY_BASE_URL} when unset). Returns `null` when any
 * required variable is absent.
 */
export function resolveRazorpayCredentials(env: EnvironmentBag): RazorpayCredentials | null {
  const keyId = readValue(env, "RAZORPAY_KEY_ID");
  const keySecret = readValue(env, "RAZORPAY_KEY_SECRET");
  const webhookSecret = readValue(env, "RAZORPAY_WEBHOOK_SECRET");

  if (keyId === undefined || keySecret === undefined || webhookSecret === undefined) {
    return null;
  }

  const baseUrl = readValue(env, "RAZORPAY_BASE_URL") ?? DEFAULT_RAZORPAY_BASE_URL;

  return { keyId, keySecret, webhookSecret, baseUrl };
}

/** Names of the environment variables the Shopify resolver requires. */
const SHOPIFY_REQUIRED_VARS: readonly string[] = [
  "SHOPIFY_STORE_DOMAIN (or SHOPIFY_SHOP_DOMAIN)",
  "SHOPIFY_ACCESS_TOKEN",
];

/** Names of the environment variables the Razorpay resolver requires. */
const RAZORPAY_REQUIRED_VARS: readonly string[] = [
  "RAZORPAY_KEY_ID",
  "RAZORPAY_KEY_SECRET",
  "RAZORPAY_WEBHOOK_SECRET",
];

/**
 * Computes the subset of Shopify variables that are currently missing. Used to
 * build fail-loud error messages that name the absent variables only.
 */
function missingShopifyVars(env: EnvironmentBag): string[] {
  const missing: string[] = [];
  if (
    readValue(env, "SHOPIFY_STORE_DOMAIN") === undefined &&
    readValue(env, "SHOPIFY_SHOP_DOMAIN") === undefined
  ) {
    missing.push(SHOPIFY_REQUIRED_VARS[0] as string);
  }
  if (readValue(env, "SHOPIFY_ACCESS_TOKEN") === undefined) {
    missing.push("SHOPIFY_ACCESS_TOKEN");
  }
  return missing;
}

/**
 * Computes the subset of Razorpay variables that are currently missing. Used to
 * build fail-loud error messages that name the absent variables only.
 */
function missingRazorpayVars(env: EnvironmentBag): string[] {
  return RAZORPAY_REQUIRED_VARS.filter((name) => readValue(env, name) === undefined);
}

/**
 * Applies the shared environment policy to a resolver result.
 *
 * - Real config present -> returns it.
 * - Config absent in a mock-eligible environment -> returns `null`
 *   (caller should use the mock connector).
 * - Config absent in a production-like environment -> THROWS a fail-loud error
 *   naming the missing variables (names only, never values).
 */
export function requireShopifyCredentials(env: EnvironmentBag): ShopifyCredentials | null {
  const resolved = resolveShopifyCredentials(env);
  if (resolved !== null) {
    return resolved;
  }
  if (!isProdLike(env)) {
    return null;
  }
  throw new Error(
    `Refusing to start in a production-like environment without Shopify ` +
      `credentials. Missing required environment variable(s): ` +
      `${missingShopifyVars(env).join(", ")}.`,
  );
}

/**
 * Applies the shared environment policy to a Razorpay resolver result.
 *
 * See {@link requireShopifyCredentials} for the policy semantics.
 */
export function requireRazorpayCredentials(env: EnvironmentBag): RazorpayCredentials | null {
  const resolved = resolveRazorpayCredentials(env);
  if (resolved !== null) {
    assertRazorpayKeyShapeMatchesEnvironment(resolved.keyId, env);
    return resolved;
  }
  if (!isProdLike(env)) {
    return null;
  }
  throw new Error(
    `Refusing to start in a production-like environment without Razorpay ` +
      `credentials. Missing required environment variable(s): ` +
      `${missingRazorpayVars(env).join(", ")}.`,
  );
}

/**
 * Defense-in-depth guard against a misconfigured deploy: Razorpay key ids are
 * always prefixed `rzp_test_` or `rzp_live_`, so a live key pasted into a
 * non-prod box (or a test key surviving into a prod-like one) is a real,
 * catchable mistake — nothing else in this file checks for it. Only asserts
 * on a recognized prefix; an unrecognized shape is left to Razorpay's own API
 * to reject rather than guessed at here.
 */
function assertRazorpayKeyShapeMatchesEnvironment(keyId: string, env: EnvironmentBag): void {
  const prodLike = isProdLike(env);
  if (keyId.startsWith("rzp_test_") && prodLike) {
    throw new Error(
      "Refusing to start: a Razorpay TEST-mode key (rzp_test_...) is configured in a " +
        "production-like environment. This would silently run real checkouts against a " +
        "sandbox account instead of live Razorpay.",
    );
  }
  if (keyId.startsWith("rzp_live_") && !prodLike) {
    throw new Error(
      "Refusing to start: a Razorpay LIVE-mode key (rzp_live_...) is configured in a " +
        "non-production environment. This would risk moving real money from a local/test run.",
    );
  }
}

/** Names of the environment variables the test-payment signer resolver requires. */
const COUNTER_TEST_PAYMENT_SIGNER_REQUIRED_VARS: readonly string[] = [
  "COUNTER_TEST_PAYMENT_SIGNER_KID",
  "COUNTER_TEST_PAYMENT_SIGNER_SEED",
];

/**
 * Resolves the deployment's own CTP signing key for `CounterTestPaymentProvider`
 * evidence from `COUNTER_TEST_PAYMENT_SIGNER_KID` / `_SEED` (a 32-byte Ed25519
 * seed, base64url-encoded). Returns `null` when either is absent or the seed
 * does not decode to exactly 32 bytes.
 */
export function resolveCounterTestPaymentSigner(
  env: EnvironmentBag,
): CounterTestPaymentSigner | null {
  const kid = readValue(env, "COUNTER_TEST_PAYMENT_SIGNER_KID");
  const seedEncoded = readValue(env, "COUNTER_TEST_PAYMENT_SIGNER_SEED");
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
 * Applies the shared environment policy to the test-payment signer resolver.
 *
 * Unlike Shopify/Razorpay, the "unset" fallback here is not "no connector" —
 * it's a publicly-known, committed test key (`createTestSignerA`/`TEST_KID_A`
 * in `@counter/trust-protocol`'s fixtures) that must never be mistaken for a
 * real signer (see CLAUDE.md). So this always returns a usable signer: a real,
 * deployment-specific secret when configured, or the named public fixture
 * in a mock-eligible environment. Only a production-like environment with the
 * variables unset fails loud — the one case where the public fixture would
 * otherwise be silently used as if it were real.
 */
export function requireCounterTestPaymentSigner(
  env: EnvironmentBag,
): CounterTestPaymentSigner & { readonly isFixture: boolean } {
  const resolved = resolveCounterTestPaymentSigner(env);
  if (resolved !== null) {
    return { ...resolved, isFixture: false };
  }
  if (!isProdLike(env)) {
    return { kid: TEST_KID_A, seed: getTestPrivateKeyA(), isFixture: true };
  }
  throw new Error(
    `Refusing to start in a production-like environment without a real CTP ` +
      `test-payment signing key. Missing required environment variable(s): ` +
      `${COUNTER_TEST_PAYMENT_SIGNER_REQUIRED_VARS.filter((name) => readValue(env, name) === undefined).join(", ")}.`,
  );
}
