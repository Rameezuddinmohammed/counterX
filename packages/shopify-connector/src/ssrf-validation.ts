/**
 * Shared SSRF protection utilities.
 *
 * Consolidates private IP pattern matching, metadata endpoint blocking,
 * and myshopify.com domain validation into a single module used by both
 * auth.ts and http-graphql-client.ts.
 */

// ─── Constants ────────────────────────────────────────────────────────────────

export const MYSHOPIFY_DOMAIN_PATTERN = /^[a-z0-9][a-z0-9-]*\.myshopify\.com$/u;

export const PRIVATE_IP_PATTERNS: readonly RegExp[] = [
  /^10\./u,
  /^172\.(1[6-9]|2\d|3[01])\./u,
  /^192\.168\./u,
  /^127\./u,
  /^169\.254\./u,
  /^0\./u,
  /^::1$/u,
  /^fc00:/iu,
  /^fe80:/iu,
  /^fd[0-9a-f]{2}:/iu,
];

export const METADATA_ENDPOINTS: readonly string[] = [
  "169.254.169.254",
  "metadata.google.internal",
];

// ─── Validation Functions ─────────────────────────────────────────────────────

/**
 * Returns true if the given IP string matches a known private/reserved range.
 */
export function isPrivateIp(ip: string): boolean {
  for (const pattern of PRIVATE_IP_PATTERNS) {
    if (pattern.test(ip)) {
      return true;
    }
  }
  return false;
}

export interface DomainValidationResult {
  readonly valid: boolean;
  readonly reason: string | undefined;
}

/**
 * Validates a Shopify domain for SSRF safety:
 * - Must match *.myshopify.com
 * - Must not be a metadata endpoint
 * - Subdomain must not encode a private IP
 */
export function validateShopDomainSsrf(domain: string): DomainValidationResult {
  const normalizedDomain = domain.toLowerCase().trim();

  if (!MYSHOPIFY_DOMAIN_PATTERN.test(normalizedDomain)) {
    return { valid: false, reason: "Domain must match *.myshopify.com pattern" };
  }

  for (const endpoint of METADATA_ENDPOINTS) {
    if (normalizedDomain === endpoint || normalizedDomain.includes(endpoint)) {
      return { valid: false, reason: "Metadata endpoint access is not permitted" };
    }
  }

  // Check for private IPs encoded in subdomain (e.g. 10-0-0-1.myshopify.com)
  const subdomain = normalizedDomain.replace(".myshopify.com", "");
  const possibleIp = subdomain.replace(/-/gu, ".");
  if (isPrivateIp(possibleIp)) {
    return { valid: false, reason: "Domain resolves to a private IP range" };
  }

  return { valid: true, reason: undefined };
}
