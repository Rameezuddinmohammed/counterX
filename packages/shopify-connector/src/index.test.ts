import { describe, expect, it } from "vitest";
import {
  PACKAGE_NAME,
  SHOPIFY_CONFIG_KEYS,
  createMockGraphQLClient,
  createHttpGraphQLClient,
  validateShopDomainSsrf,
  isPrivateIp,
  validateToken,
  verifyWebhookSignature,
  checkScopes,
  validateShopDomain,
  redactCredentials,
  createShopifyHealthPort,
  SHOPIFY_CONNECTOR_MANIFEST,
} from "./index.js";
import type {
  ShopifyConnectorManifest,
  ShopifyAuthConfig,
  ConfigKeyDescriptor,
  ShopifyGraphQLPort,
  ShopifyGraphQLResponse,
  ShopifyGraphQLError,
  ShopifyThrottleStatus,
  HttpGraphQLClientConfig,
  DomainValidationResult,
  MockShopifyClient,
  MockCallRecord,
  MockFault,
  MockGraphQLClientConfig,
  ShopifyTokenValidation,
  ScopeCheckResult,
  ShopifyHealthConfig,
} from "./index.js";

describe("@counter/shopify-connector", () => {
  it("exposes its package identity", () => {
    expect(PACKAGE_NAME).toBe("@counter/shopify-connector");
  });

  it("ShopifyConnectorManifest type is structurally correct", () => {
    const manifest: ShopifyConnectorManifest = {
      connectorId: "shopify-1",
      platform: "shopify",
      apiVersion: "2024-01",
      capabilities: ["catalog-sync", "order-create"],
      supportedActions: ["draft-order", "fulfill"],
    };
    expect(manifest.platform).toBe("shopify");
    expect(manifest.capabilities).toContain("catalog-sync");
  });

  it("ShopifyAuthConfig type is structurally correct", () => {
    const config: ShopifyAuthConfig = {
      shopDomain: "test-store.myshopify.com",
      accessToken: "shpat_test_token_12345678",
      apiVersion: "2024-01",
      scopes: ["read_products", "write_orders"],
    };
    expect(config.shopDomain).toBe("test-store.myshopify.com");
    expect(config.scopes).toHaveLength(2);
  });

  it("exports SHOPIFY_CONFIG_KEYS describing expected environment variables", () => {
    expect(SHOPIFY_CONFIG_KEYS.length).toBeGreaterThan(0);
    for (const key of SHOPIFY_CONFIG_KEYS) {
      const descriptor: ConfigKeyDescriptor = key;
      expect(descriptor.name).toBeTruthy();
      expect(descriptor.purpose).toBeTruthy();
      expect(typeof descriptor.required).toBe("boolean");
    }
  });

  it("exports GraphQL client factories", () => {
    expect(typeof createMockGraphQLClient).toBe("function");
    expect(typeof createHttpGraphQLClient).toBe("function");
  });

  it("exports SSRF validation utilities", () => {
    expect(typeof validateShopDomainSsrf).toBe("function");
    expect(typeof isPrivateIp).toBe("function");
  });

  it("exports auth functions", () => {
    expect(typeof validateToken).toBe("function");
    expect(typeof verifyWebhookSignature).toBe("function");
    expect(typeof checkScopes).toBe("function");
    expect(typeof validateShopDomain).toBe("function");
    expect(typeof redactCredentials).toBe("function");
  });

  it("exports health port factory", () => {
    expect(typeof createShopifyHealthPort).toBe("function");
  });

  it("exports SHOPIFY_CONNECTOR_MANIFEST", () => {
    expect(SHOPIFY_CONNECTOR_MANIFEST).toBeDefined();
    expect(SHOPIFY_CONNECTOR_MANIFEST.platform).toBe("shopify");
    expect(SHOPIFY_CONNECTOR_MANIFEST.version).toBe("2025-07");
    expect(SHOPIFY_CONNECTOR_MANIFEST.connectorId).toBe("shopify-connector");
  });

  it("all exported types are accessible (compile-time verification)", () => {
    // These type assertions verify the types are properly exported
    const _port: ShopifyGraphQLPort | undefined = undefined;
    const _response: ShopifyGraphQLResponse<unknown> | undefined = undefined;
    const _error: ShopifyGraphQLError | undefined = undefined;
    const _throttle: ShopifyThrottleStatus | undefined = undefined;
    const _httpConfig: HttpGraphQLClientConfig | undefined = undefined;
    const _domainResult: DomainValidationResult | undefined = undefined;
    const _mockClient: MockShopifyClient | undefined = undefined;
    const _callRecord: MockCallRecord | undefined = undefined;
    const _fault: MockFault | undefined = undefined;
    const _mockConfig: MockGraphQLClientConfig | undefined = undefined;
    const _tokenValidation: ShopifyTokenValidation | undefined = undefined;
    const _scopeCheck: ScopeCheckResult | undefined = undefined;
    const _healthConfig: ShopifyHealthConfig | undefined = undefined;

    // Suppress unused variable warnings
    expect(_port).toBeUndefined();
    expect(_response).toBeUndefined();
    expect(_error).toBeUndefined();
    expect(_throttle).toBeUndefined();
    expect(_httpConfig).toBeUndefined();
    expect(_domainResult).toBeUndefined();
    expect(_mockClient).toBeUndefined();
    expect(_callRecord).toBeUndefined();
    expect(_fault).toBeUndefined();
    expect(_mockConfig).toBeUndefined();
    expect(_tokenValidation).toBeUndefined();
    expect(_scopeCheck).toBeUndefined();
    expect(_healthConfig).toBeUndefined();
  });
});
