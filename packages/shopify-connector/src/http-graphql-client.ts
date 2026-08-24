/**
 * Real HTTP implementation of ShopifyGraphQLPort.
 *
 * Sends requests to the Shopify Admin API GraphQL endpoint with
 * SSRF protection, authentication headers, and rate limit tracking.
 */

import type { ShopifyGraphQLPort, ShopifyGraphQLResponse, ShopifyThrottleStatus } from "./graphql-client.js";
import { validateShopDomainSsrf } from "./ssrf-validation.js";

// ─── Constants ────────────────────────────────────────────────────────────────

const SHOPIFY_API_VERSION = "2025-07";
const BUCKET_CAPACITY = 1000;
const LOW_BUCKET_THRESHOLD = 0.2;

// ─── Re-exports for backward compatibility ───────────────────────────────────

export { validateShopDomainSsrf, isPrivateIp } from "./ssrf-validation.js";
export type { DomainValidationResult } from "./ssrf-validation.js";

// ─── HTTP Client Configuration ────────────────────────────────────────────────

export interface HttpGraphQLClientConfig {
  readonly shopDomain: string;
  readonly accessToken: string;
  readonly apiVersion?: string | undefined;
}

// ─── HTTP Client Implementation ───────────────────────────────────────────────

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
