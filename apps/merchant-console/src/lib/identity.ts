/**
 * Merchant identity handling for the Counter Merchant Console.
 *
 * Provides merchant identity resolution, environment detection, and
 * display name formatting for the console UI.
 */

export const APP_NAME = "@counter/merchant-console";

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export type Environment = "pilot" | "production";

export interface MerchantIdentity {
  readonly merchantId: string;
  readonly merchantName: string;
  readonly email: string;
  readonly environment: Environment;
}

// ---------------------------------------------------------------------------
// Environment detection
// ---------------------------------------------------------------------------

/**
 * Determines the current environment from an environment variable string.
 * Defaults to "pilot" for safety - production requires explicit opt-in.
 */
export function resolveEnvironment(envValue: string | undefined | null): Environment {
  if (envValue === "production") {
    return "production";
  }
  return "pilot";
}

// ---------------------------------------------------------------------------
// Identity parsing & validation
// ---------------------------------------------------------------------------

const EMAIL_REGEX = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
const MERCHANT_ID_REGEX = /^[a-zA-Z0-9_-]{1,128}$/;

/**
 * Validates that a merchant ID is well-formed.
 * Accepts alphanumeric, hyphens, and underscores (1-128 chars).
 */
export function isValidMerchantId(id: string): boolean {
  return MERCHANT_ID_REGEX.test(id);
}

/**
 * Validates that an email address has a basic valid format.
 */
export function isValidEmail(email: string): boolean {
  return EMAIL_REGEX.test(email);
}

/**
 * Formats a merchant name for display. Trims whitespace and ensures
 * the name is non-empty. Returns null if invalid.
 */
export function formatMerchantName(name: string): string | null {
  const trimmed = name.trim();
  if (trimmed.length === 0) {
    return null;
  }
  if (trimmed.length > 256) {
    return null;
  }
  return trimmed;
}

/**
 * Constructs a validated MerchantIdentity from raw inputs.
 * Returns null if any field fails validation.
 */
export function createMerchantIdentity(
  merchantId: string,
  merchantName: string,
  email: string,
  envValue: string | undefined | null,
): MerchantIdentity | null {
  if (!isValidMerchantId(merchantId)) {
    return null;
  }

  const formattedName = formatMerchantName(merchantName);
  if (formattedName === null) {
    return null;
  }

  if (!isValidEmail(email)) {
    return null;
  }

  const environment = resolveEnvironment(envValue);

  return Object.freeze({
    merchantId,
    merchantName: formattedName,
    email,
    environment,
  });
}

/**
 * Returns a display label for the environment indicator badge.
 */
export function getEnvironmentLabel(env: Environment): string {
  switch (env) {
    case "pilot":
      return "PILOT (Test Mode)";
    case "production":
      return "PRODUCTION";
  }
}

/**
 * Returns a summary string for use in page titles or headers.
 */
export function getIdentitySummary(identity: MerchantIdentity): string {
  return `${identity.merchantName} (${identity.merchantId}) - ${getEnvironmentLabel(identity.environment)}`;
}
