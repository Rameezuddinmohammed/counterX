/**
 * Shopify authentication and credential safety service.
 *
 * Provides token validation, webhook signature verification,
 * scope checking, domain validation, and credential redaction.
 */

import { createCanonicalError, ok, err } from "@counter/domain";
import type { Result } from "@counter/domain";
import { timingSafeEqual } from "node:crypto";
import { isPrivateIp, METADATA_ENDPOINTS, MYSHOPIFY_DOMAIN_PATTERN } from "./ssrf-validation.js";

// ─── Types ────────────────────────────────────────────────────────────────────

export interface ShopifyAuthConfig {
  readonly shopDomain: string;
  readonly accessToken: string;
  readonly apiVersion: string;
  readonly scopes: readonly string[];
}

export interface ShopifyTokenValidation {
  readonly valid: boolean;
  readonly shopDomain: string;
  readonly tokenPrefix: string;
}

export interface ScopeCheckResult {
  readonly satisfied: boolean;
  readonly missing: readonly string[];
  readonly extra: readonly string[];
}

// ─── Constants ────────────────────────────────────────────────────────────────

const SHOPIFY_TOKEN_PREFIX = "shpat_";

// ─── Token Validation ─────────────────────────────────────────────────────────

export function validateToken(config: ShopifyAuthConfig): Result<ShopifyTokenValidation> {
  if (!config.accessToken.startsWith(SHOPIFY_TOKEN_PREFIX)) {
    return err(
      createCanonicalError({
        category: "authentication",
        code: "UNAUTHENTICATED",
        message: "Token must start with shpat_ prefix",
      }),
    );
  }

  if (config.accessToken.length < SHOPIFY_TOKEN_PREFIX.length + 10) {
    return err(
      createCanonicalError({
        category: "authentication",
        code: "UNAUTHENTICATED",
        message: "Token is too short to be valid",
      }),
    );
  }

  const domainResult = validateShopDomain(config.shopDomain);
  if (!domainResult.ok) {
    return domainResult;
  }

  return ok({
    valid: true,
    shopDomain: config.shopDomain,
    tokenPrefix: config.accessToken.slice(0, SHOPIFY_TOKEN_PREFIX.length + 4),
  });
}

// ─── Webhook Signature Verification ──────────────────────────────────────────

export async function verifyWebhookSignature(
  rawBody: Uint8Array,
  hmacHeader: string,
  secret: string,
): Promise<boolean> {
  const encoder = new TextEncoder();
  const keyData = encoder.encode(secret);

  const cryptoKey = await crypto.subtle.importKey(
    "raw",
    keyData,
    { name: "HMAC", hash: "SHA-256" },
    false,
    ["sign"],
  );

  const signature = await crypto.subtle.sign("HMAC", cryptoKey, rawBody);

  // Shopify sends the HMAC as a base64-encoded value in X-Shopify-Hmac-Sha256.
  // Compare raw bytes using timing-safe comparison to avoid timing attacks.
  const computedBuf = Buffer.from(signature);
  const headerBuf = Buffer.from(hmacHeader, "base64");

  if (computedBuf.length !== headerBuf.length) {
    // Compare computed against itself to consume constant time, then return false.
    timingSafeEqual(computedBuf, computedBuf);
    return false;
  }

  return timingSafeEqual(computedBuf, headerBuf);
}

// ─── Scope Checking ───────────────────────────────────────────────────────────

export function checkScopes(
  granted: readonly string[],
  required: readonly string[],
): ScopeCheckResult {
  const grantedSet = new Set(granted);
  const requiredSet = new Set(required);

  const missing: string[] = [];
  const extra: string[] = [];

  for (const scope of required) {
    if (!grantedSet.has(scope)) {
      missing.push(scope);
    }
  }

  for (const scope of granted) {
    if (!requiredSet.has(scope)) {
      extra.push(scope);
    }
  }

  return Object.freeze({
    satisfied: missing.length === 0,
    missing: Object.freeze(missing),
    extra: Object.freeze(extra),
  });
}

// ─── Domain Validation ────────────────────────────────────────────────────────

export function validateShopDomain(domain: string): Result<string> {
  const normalized = domain.toLowerCase().trim();

  if (!MYSHOPIFY_DOMAIN_PATTERN.test(normalized)) {
    return err(
      createCanonicalError({
        category: "validation",
        code: "INVALID_FORMAT",
        message: "Domain must match *.myshopify.com pattern",
      }),
    );
  }

  // Check metadata endpoints
  for (const endpoint of METADATA_ENDPOINTS) {
    if (normalized === endpoint || normalized.includes(endpoint)) {
      return err(
        createCanonicalError({
          category: "validation",
          code: "INVALID_FORMAT",
          message: "Metadata endpoint access is not permitted",
        }),
      );
    }
  }

  // Check for private IPs embedded in domain (e.g. 10-0-0-1.myshopify.com is suspicious)
  const subdomain = normalized.replace(".myshopify.com", "");
  const possibleIp = subdomain.replace(/-/gu, ".");
  if (isPrivateIp(possibleIp)) {
    return err(
      createCanonicalError({
        category: "validation",
        code: "INVALID_FORMAT",
        message: "Domain resolves to a private IP range",
      }),
    );
  }

  return ok(normalized);
}

// ─── Credential Redaction ─────────────────────────────────────────────────────

const CREDENTIAL_PATTERNS: readonly RegExp[] = [/shpat_[a-zA-Z0-9_-]+/gu, /shpss_[a-zA-Z0-9_-]+/gu];

export function redactCredentials(text: string): string {
  let result = text;
  for (const pattern of CREDENTIAL_PATTERNS) {
    result = result.replace(new RegExp(pattern.source, pattern.flags), (match) => {
      const prefix = match.slice(0, 7);
      return `${prefix}${"*".repeat(Math.max(4, match.length - 7))}`;
    });
  }
  return result;
}
