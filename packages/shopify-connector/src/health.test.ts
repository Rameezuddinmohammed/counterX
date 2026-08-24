import { describe, expect, it } from "vitest";
import { createShopifyHealthPort } from "./health.js";
import { createMockGraphQLClient } from "./mock-graphql-client.js";
import type { ShopifyAuthConfig } from "./auth.js";
import type { ShopifyGraphQLResponse } from "./graphql-client.js";

const validAuthConfig: ShopifyAuthConfig = {
  shopDomain: "test-store.myshopify.com",
  accessToken: "shpat_valid_token_1234567890",
  apiVersion: "2025-07",
  scopes: ["read_products", "write_draft_orders", "read_orders", "write_orders", "read_inventory"],
};

describe("ShopifyHealthPort", () => {
  it("reports healthy when API responds, token is valid, and bucket > 30%", async () => {
    const mockClient = createMockGraphQLClient();
    const shopResponse: ShopifyGraphQLResponse<{ shop: { name: string } }> = {
      data: { shop: { name: "Test Store" } },
      errors: undefined,
      extensions: {
        cost: {
          throttleStatus: {
            currentlyAvailable: 900,
            restoreRate: 50,
            maximumAvailable: 1000,
          },
        },
      },
    };
    mockClient.setResponse("{ shop { name } }", shopResponse);

    const healthPort = createShopifyHealthPort({
      client: mockClient,
      authConfig: validAuthConfig,
    });

    const result = await healthPort.checkHealth();
    expect(result.status).toBe("healthy");
    expect(result.message).toBeUndefined();
    expect(result.details.length).toBeGreaterThan(0);
  });

  it("reports degraded when bucket < 30%", async () => {
    const mockClient = createMockGraphQLClient();
    const shopResponse: ShopifyGraphQLResponse<{ shop: { name: string } }> = {
      data: { shop: { name: "Test Store" } },
      errors: undefined,
      extensions: {
        cost: {
          throttleStatus: {
            currentlyAvailable: 200,
            restoreRate: 50,
            maximumAvailable: 1000,
          },
        },
      },
    };
    mockClient.setResponse("{ shop { name } }", shopResponse);

    const healthPort = createShopifyHealthPort({
      client: mockClient,
      authConfig: validAuthConfig,
    });

    const result = await healthPort.checkHealth();
    expect(result.status).toBe("degraded");
  });

  it("reports unhealthy when auth validation fails", async () => {
    const mockClient = createMockGraphQLClient();
    const shopResponse: ShopifyGraphQLResponse<{ shop: { name: string } }> = {
      data: { shop: { name: "Test Store" } },
      errors: undefined,
      extensions: {
        cost: {
          throttleStatus: {
            currentlyAvailable: 900,
            restoreRate: 50,
            maximumAvailable: 1000,
          },
        },
      },
    };
    mockClient.setResponse("{ shop { name } }", shopResponse);

    const invalidAuthConfig: ShopifyAuthConfig = {
      shopDomain: "test-store.myshopify.com",
      accessToken: "invalid_token_no_prefix",
      apiVersion: "2025-07",
      scopes: ["read_products"],
    };

    const healthPort = createShopifyHealthPort({
      client: mockClient,
      authConfig: invalidAuthConfig,
    });

    const result = await healthPort.checkHealth();
    expect(result.status).toBe("unhealthy");
  });

  it("reports unhealthy when API query throws", async () => {
    const mockClient = createMockGraphQLClient();
    mockClient.setFault({ kind: "network_error", message: "Connection refused" });

    const healthPort = createShopifyHealthPort({
      client: mockClient,
      authConfig: validAuthConfig,
    });

    const result = await healthPort.checkHealth();
    expect(result.status).toBe("unhealthy");
  });

  it("includes component details in response", async () => {
    const mockClient = createMockGraphQLClient();
    const shopResponse: ShopifyGraphQLResponse<{ shop: { name: string } }> = {
      data: { shop: { name: "Test Store" } },
      errors: undefined,
      extensions: {
        cost: {
          throttleStatus: {
            currentlyAvailable: 900,
            restoreRate: 50,
            maximumAvailable: 1000,
          },
        },
      },
    };
    mockClient.setResponse("{ shop { name } }", shopResponse);

    const healthPort = createShopifyHealthPort({
      client: mockClient,
      authConfig: validAuthConfig,
    });

    const result = await healthPort.checkHealth();
    const componentNames = result.details.map((d) => d.component);
    expect(componentNames).toContain("auth_validity");
    expect(componentNames).toContain("api_connectivity");
    expect(componentNames).toContain("rate_limit_budget");
  });
});
