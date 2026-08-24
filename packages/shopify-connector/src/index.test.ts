import { describe, expect, it } from "vitest";
import {
  PACKAGE_NAME,
  SHOPIFY_CONFIG_KEYS,
} from "./index.js";
import type {
  ShopifyConnectorManifest,
  ShopifyAuthConfig,
  ConfigKeyDescriptor,
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
      accessToken: "shpat_test_token",
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
});
