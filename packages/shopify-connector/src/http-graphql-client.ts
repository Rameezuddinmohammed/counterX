/**
 * Real HTTP implementation of ShopifyGraphQLPort.
 *
 * Sends requests to the Shopify Admin API GraphQL endpoint with
 * SSRF protection, authentication headers, and rate limit tracking.
 */

import type { ShopifyGraphQLPort, ShopifyGraphQLResponse, ShopifyThrottleStatus } from "./graphql-client.js";

// --- Constants ---

const SHOPIFY_API_VERSION = "2025-07";
const MYSHOPIFY_DOMAIN_PATTERN = /^[a-z0-9][a-z0-9-]*\.myshopify\.com$/u;
const BUCKET_CAPACITY = 1000;
const LOW_BUCKET_THRESHOLD = 0.2;

// --- Private IP Ranges ---

const PRIVATE_IP_PATTERNS: readonly RegExp[] = [
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

const METADATA_ENDPOINTS: readonly string[] = ["169.254.169.254", "metadata.google.internal"];

// --- SSRF Validation ---

export interface DomainValidationResult {
  readonly valid: boolean;
  readonly reason: string | undefined;
}

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

  return { valid: true, reason: undefined };
}

export function isPrivateIp(ip: string): boolean {
  for (const pattern of PRIVATE_IP_PATTERNS) {
    if (pattern.test(ip)) {
      return true;
    }
  }
  return false;
}

// --- HTTP Client Configuration ---

export interface HttpGraphQLClientConfig {
  readonly shopDomain: string;
  readonly accessToken: string;
  readonly apiVersion?: string | undefined;
}

// --- HTTP Client Implementation ---

export function createHttpGraphQLClient(config: HttpGraphQLClientConfig): ShopifyGraphQLPort {
  const apiVersion = config.apiVersion ?? SHOPIFY_API_VERSION;

  const domainValidation = validateShopDomainSsrf(config.shopDomain);
  if (!domainValidation.valid) {
    throw new Error(`SSRF protection: ${domainValidation.reason}`);
  }

  const endpoint = `https://${config.shopDomain}/admin/api/${apiVersion}/graphql.json`;

  let lastThrottleStatus: ShopifyThrottleStatus | undefined;

  async function executeOperation<T>(
    operation: string,
    variables: Record<string, unknown>,
  ): Promise<ShopifyGraphQLResponse<T>> {
    // Adaptive backoff when bucket is low
    if (lastThrottleStatus) {
      const fillRatio = lastThrottleStatus.currentlyAvailable / lastThrottleStatus.maximumAvailable;
      if (fillRatio < LOW_BUCKET_THRESHOLD) {
        const waitMs = Math.ceil(
          ((BUCKET_CAPACITY * LOW_BUCKET_THRESHOLD - lastThrottleStatus.currentlyAvailable) /
            lastThrottleStatus.restoreRate) *
            1000,
        );
        await new Promise((resolve) => setTimeout(resolve, Math.min(waitMs, 5000)));
      }
    }

    const response = await fetch(endpoint, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "X-Shopify-Access-Token": config.accessToken,
      },
      body: JSON.stringify({ query: operation, variables }),
    });

    if (!response.ok) {
      throw new Error(`Shopify API returned HTTP ${String(response.status)}`);
    }

    const body = (await response.json()) as ShopifyGraphQLResponse<T>;

    // Track throttle status for adaptive backoff
    if (body.extensions?.cost?.throttleStatus) {
      lastThrottleStatus = body.extensions.cost.throttleStatus;
    }

    return body;
  }

  return {
    async query<T>(
      operation: string,
      variables: Record<string, unknown>,
    ): Promise<ShopifyGraphQLResponse<T>> {
      return executeOperation<T>(operation, variables);
    },

    async mutate<T>(
      operation: string,
      variables: Record<string, unknown>,
    ): Promise<ShopifyGraphQLResponse<T>> {
      return executeOperation<T>(operation, variables);
    },
  };
}
