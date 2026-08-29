/**
 * Credential-gating helper for the real Shopify + Razorpay connectors.
 *
 * Mirrors apps/worker/src/connector-env.ts's resolver shapes and defaults
 * (kept as a separate per-app copy, matching this repo's existing
 * convention — apps do not import each other's src). The prod-like/mock-
 * eligible classification itself is owned by main.ts's existing
 * `isNonProduction` (already the single source of truth for this app), so
 * this module only resolves credentials — it does not re-decide the policy.
 *
 * SECURITY: reads secrets from environment variables only. Never logs,
 * echoes, or hardcodes a secret value. Error messages name missing
 * variables (names only), never values.
 */

export interface ShopifyCredentials {
  readonly shopDomain: string;
  readonly accessToken: string;
  readonly apiVersion: string;
}

export interface RazorpayCredentials {
  readonly keyId: string;
  readonly keySecret: string;
  /** Required by createRealRazorpayProvider's config shape; unused by refund() itself. */
  readonly webhookSecret: string;
  readonly baseUrl: string;
}

export type EnvironmentBag = Readonly<Record<string, string | undefined>>;

export const DEFAULT_SHOPIFY_API_VERSION = "2025-07";
export const DEFAULT_RAZORPAY_BASE_URL = "https://api.razorpay.com";

function readValue(env: EnvironmentBag, name: string): string | undefined {
  const raw = env[name];
  if (raw === undefined) {
    return undefined;
  }
  const trimmed = raw.trim();
  return trimmed.length > 0 ? trimmed : undefined;
}

/** Returns the parsed Shopify config, or `null` when required variables are absent. */
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

/** Returns the parsed Razorpay config, or `null` when required variables are absent. */
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

const SHOPIFY_REQUIRED_VARS: readonly string[] = [
  "SHOPIFY_STORE_DOMAIN (or SHOPIFY_SHOP_DOMAIN)",
  "SHOPIFY_ACCESS_TOKEN",
];
const RAZORPAY_REQUIRED_VARS: readonly string[] = [
  "RAZORPAY_KEY_ID",
  "RAZORPAY_KEY_SECRET",
  "RAZORPAY_WEBHOOK_SECRET",
];

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

function missingRazorpayVars(env: EnvironmentBag): string[] {
  return RAZORPAY_REQUIRED_VARS.filter((name) => readValue(env, name) === undefined);
}

/**
 * Applies the shared environment policy: real config when present; `null`
 * when absent in a mock-eligible environment; throws (fail-loud, naming only
 * the missing variable names) when absent in a production-like environment.
 */
export function requireShopifyCredentials(
  env: EnvironmentBag,
  isProdLike: boolean,
): ShopifyCredentials | null {
  const resolved = resolveShopifyCredentials(env);
  if (resolved !== null) {
    return resolved;
  }
  if (!isProdLike) {
    return null;
  }
  throw new Error(
    `Refusing to start in a production-like environment without Shopify credentials. ` +
      `Missing required environment variable(s): ${missingShopifyVars(env).join(", ")}.`,
  );
}

/** See {@link requireShopifyCredentials} for the policy semantics. */
export function requireRazorpayCredentials(
  env: EnvironmentBag,
  isProdLike: boolean,
): RazorpayCredentials | null {
  const resolved = resolveRazorpayCredentials(env);
  if (resolved !== null) {
    return resolved;
  }
  if (!isProdLike) {
    return null;
  }
  throw new Error(
    `Refusing to start in a production-like environment without Razorpay credentials. ` +
      `Missing required environment variable(s): ${missingRazorpayVars(env).join(", ")}.`,
  );
}
