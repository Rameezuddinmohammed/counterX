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
const MOCK_ELIGIBLE_ENVIRONMENTS: ReadonlySet<string> = new Set([
  "local",
  "test",
  "development",
]);

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
