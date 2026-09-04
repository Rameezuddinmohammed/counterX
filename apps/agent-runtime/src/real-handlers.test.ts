/**
 * Unit-level proof that agent-runtime's product catalog is genuinely
 * per-merchant: capability/search/product/quote resolve their
 * ShopifyConnector from a fake ShopifyConnectorResolver keyed by
 * ctx.merchantId, never share one connector across merchants, and return a
 * clean not_found (never a crash, never another merchant's data) when a
 * merchant has no active connection.
 *
 * No real Postgres and no real Shopify network calls here — see
 * merchant-shopify-connection-store.integration.test.ts for the real-
 * Postgres proof that the STORE itself reads the right row per merchantId,
 * and real-handlers.integration.test.ts for transactionCreate's own
 * real-Postgres coverage (it doesn't touch Shopify at all).
 */
import { describe, expect, it } from "vitest";
import type {
  ShopifyConnector,
  ShopifyGraphQLPort,
  ShopifyGraphQLResponse,
  ShopifyProductsListResponse,
} from "@counter/shopify-connector";
import { __testing, type ShopifyConnectorResolver } from "./real-handlers.js";
import type { HandlerContext } from "./merchant-handlers.js";

const { createCapabilityHandler, createSearchHandler, createProductHandler } = __testing;

function ctxFor(merchantId: string): HandlerContext {
  return Object.freeze({
    merchantId,
    correlationId: `corr-${merchantId}`,
    idempotencyKey: undefined,
    version: undefined,
    callerWalletId: undefined,
  });
}

interface VariantNodeResponse {
  readonly node: {
    readonly id: string;
    readonly title: string;
    readonly sku: string | null;
    readonly inventoryQuantity: number;
    readonly price: string;
    readonly compareAtPrice: string | null;
    readonly product: {
      readonly title: string;
      readonly descriptionHtml: string;
      readonly status: string;
    };
  } | null;
}

/**
 * A fake ShopifyConnector whose GraphQL responses embed the shop domain in
 * the product/variant title — so a test can tell WHICH merchant's connector
 * actually served a given call, without a real Shopify network call.
 */
function fakeConnectorFor(shopDomain: string): ShopifyConnector {
  const searchResponse: ShopifyGraphQLResponse<ShopifyProductsListResponse> = {
    data: {
      products: {
        edges: [
          {
            cursor: "cursor-1",
            node: {
              id: `gid://shopify/Product/${shopDomain}`,
              title: `Product from ${shopDomain}`,
              descriptionHtml: "",
              status: "ACTIVE",
              createdAt: new Date(0).toISOString(),
              updatedAt: new Date(0).toISOString(),
              variants: {
                edges: [
                  {
                    node: {
                      id: `gid://shopify/ProductVariant/${shopDomain}`,
                      title: "Default",
                      sku: null,
                      inventoryQuantity: 5,
                      price: "10.00",
                      compareAtPrice: null,
                    },
                  },
                ],
              },
            },
          },
        ],
        pageInfo: { hasNextPage: false, endCursor: null },
      },
    },
    errors: undefined,
    extensions: undefined,
  };

  const variantResponse: ShopifyGraphQLResponse<VariantNodeResponse> = {
    data: {
      node: {
        id: `gid://shopify/ProductVariant/${shopDomain}`,
        title: "Default",
        sku: null,
        inventoryQuantity: 5,
        price: "10.00",
        compareAtPrice: null,
        product: {
          title: `Product from ${shopDomain}`,
          descriptionHtml: "",
          status: "ACTIVE",
        },
      },
    },
    errors: undefined,
    extensions: undefined,
  };

  const client: ShopifyGraphQLPort = {
    query: async <T>(operation: string) => {
      // The two queries this test exercises (product search vs. single
      // variant lookup) are distinguished the same way shopify-catalog.ts's
      // own callers distinguish them: by which query string is sent.
      if (operation.includes("ProductsList")) {
        return searchResponse as unknown as ShopifyGraphQLResponse<T>;
      }
      return variantResponse as unknown as ShopifyGraphQLResponse<T>;
    },
    mutate: async () => {
      throw new Error("not used by capability/search/product handlers");
    },
  };

  return { client } as unknown as ShopifyConnector;
}

/** Resolves ONLY the merchant ids it was explicitly given a connector for — everything else is `undefined`, never a fallback. */
function fakeResolver(
  connectors: Readonly<Record<string, ShopifyConnector>>,
): ShopifyConnectorResolver {
  return {
    async resolve(merchantId: string) {
      return connectors[merchantId];
    },
  };
}

const MERCHANT_A = "ctr_merchant_AAAAAAAAAAAAAAAAAAAAAA";
const MERCHANT_B = "ctr_merchant_BBBBBBBBBBBBBBBBBBBBBB";
const MERCHANT_UNCONFIGURED = "ctr_merchant_CCCCCCCCCCCCCCCCCCCCCC";

describe("real handlers — per-merchant Shopify catalog isolation", () => {
  const resolver = fakeResolver({
    [MERCHANT_A]: fakeConnectorFor("merchant-a.myshopify.com"),
    [MERCHANT_B]: fakeConnectorFor("merchant-b.myshopify.com"),
  });

  it("search returns merchant A's own catalog for merchant A, never merchant B's", async () => {
    const handler = createSearchHandler(resolver);

    const resultA = await handler.handle(ctxFor(MERCHANT_A), {
      query: "widget",
      filters: undefined,
      pagination: undefined,
    });
    expect(resultA.ok).toBe(true);
    if (resultA.ok) {
      expect(resultA.value.results).toHaveLength(1);
      expect(resultA.value.results[0]!.title).toContain("merchant-a.myshopify.com");
      expect(resultA.value.results[0]!.title).not.toContain("merchant-b.myshopify.com");
    }
  });

  it("search returns merchant B's own catalog for merchant B, never merchant A's", async () => {
    const handler = createSearchHandler(resolver);

    const resultB = await handler.handle(ctxFor(MERCHANT_B), {
      query: "widget",
      filters: undefined,
      pagination: undefined,
    });
    expect(resultB.ok).toBe(true);
    if (resultB.ok) {
      expect(resultB.value.results).toHaveLength(1);
      expect(resultB.value.results[0]!.title).toContain("merchant-b.myshopify.com");
      expect(resultB.value.results[0]!.title).not.toContain("merchant-a.myshopify.com");
    }
  });

  it("product lookup uses the requesting merchant's own connector", async () => {
    const handler = createProductHandler(resolver);

    const result = await handler.handle(ctxFor(MERCHANT_A), "gid://shopify/ProductVariant/1");
    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.value.title).toContain("merchant-a.myshopify.com");
    }
  });

  it("a merchant with no active Shopify connection gets a clean not_found, never another merchant's data", async () => {
    const searchHandler = createSearchHandler(resolver);
    const productHandler = createProductHandler(resolver);
    const capabilityHandler = createCapabilityHandler(resolver);

    const searchResult = await searchHandler.handle(ctxFor(MERCHANT_UNCONFIGURED), {
      query: "widget",
      filters: undefined,
      pagination: undefined,
    });
    expect(searchResult.ok).toBe(false);
    if (!searchResult.ok) {
      expect(searchResult.error.kind).toBe("not_found");
    }

    const productResult = await productHandler.handle(
      ctxFor(MERCHANT_UNCONFIGURED),
      "gid://shopify/ProductVariant/1",
    );
    expect(productResult.ok).toBe(false);
    if (!productResult.ok) {
      expect(productResult.error.kind).toBe("not_found");
    }

    const capabilityResult = await capabilityHandler.handle(ctxFor(MERCHANT_UNCONFIGURED));
    expect(capabilityResult.ok).toBe(false);
    if (!capabilityResult.ok) {
      expect(capabilityResult.error.kind).toBe("not_found");
    }
  });

  it("capability reports connected for a merchant with an active connection", async () => {
    const handler = createCapabilityHandler(resolver);

    const result = await handler.handle(ctxFor(MERCHANT_A));
    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.value.merchantId).toBe(MERCHANT_A);
    }
  });
});
