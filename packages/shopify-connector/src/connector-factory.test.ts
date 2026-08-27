import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { createShopifyConnectorFromConfig } from "./connector-factory.js";

// ─── Fetch stub helpers ─────────────────────────────────────────────────────

interface CapturedRequest {
  readonly url: string;
  readonly method: string;
  readonly headers: Record<string, string>;
  readonly body: unknown;
}

function stubFetch(responseBody: unknown): {
  readonly calls: CapturedRequest[];
} {
  const calls: CapturedRequest[] = [];
  const impl = (async (input: unknown, init?: RequestInit): Promise<Response> => {
    const headers: Record<string, string> = {};
    const rawHeaders = (init?.headers ?? {}) as Record<string, string>;
    for (const [key, value] of Object.entries(rawHeaders)) {
      headers[key] = value;
    }
    calls.push({
      url: String(input),
      method: init?.method ?? "GET",
      headers,
      body: init?.body !== undefined ? JSON.parse(init.body as string) : undefined,
    });
    return {
      ok: true,
      status: 200,
      json: async (): Promise<unknown> => responseBody,
    } as unknown as Response;
  }) as typeof fetch;
  vi.stubGlobal("fetch", impl);
  return { calls };
}

describe("createShopifyConnectorFromConfig", () => {
  beforeEach(() => {
    vi.restoreAllMocks();
  });

  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it("builds a client that issues an authenticated request to the correct endpoint", async () => {
    const { calls } = stubFetch({
      data: {
        draftOrderCreate: {
          draftOrder: {
            id: "gid://shopify/DraftOrder/1",
            name: "#D1",
            status: "OPEN",
            totalPrice: "49.99",
            currencyCode: "INR",
            createdAt: "2025-01-01T00:00:00Z",
          },
          userErrors: [],
        },
      },
      errors: undefined,
      extensions: undefined,
    });

    const connector = createShopifyConnectorFromConfig({
      shopDomain: "counter-commerce-agent.myshopify.com",
      accessToken: "shpat_secret_token",
      apiVersion: "2025-07",
    });

    // A raw client call proves endpoint + header wiring.
    await connector.client.query("{ shop { name } }", {});

    expect(calls).toHaveLength(1);
    const call = calls[0]!;
    expect(call.url).toBe(
      "https://counter-commerce-agent.myshopify.com/admin/api/2025-07/graphql.json",
    );
    expect(call.method).toBe("POST");
    expect(call.headers["X-Shopify-Access-Token"]).toBe("shpat_secret_token");
    expect(call.headers["Content-Type"]).toBe("application/json");
  });

  it("wires the order actions to the same authenticated client", async () => {
    const { calls } = stubFetch({
      data: {
        draftOrderCreate: {
          draftOrder: {
            id: "gid://shopify/DraftOrder/42",
            name: "#D42",
            status: "OPEN",
            totalPrice: "10.00",
            currencyCode: "INR",
            createdAt: "2025-01-01T00:00:00Z",
          },
          userErrors: [],
        },
      },
      errors: undefined,
      extensions: undefined,
    });

    const connector = createShopifyConnectorFromConfig({
      shopDomain: "counter-commerce-agent.myshopify.com",
      accessToken: "shpat_action_token",
    });

    const outcome = await connector.draftOrderCreate.execute({
      payload: {
        lineItems: [{ variantId: "gid://shopify/ProductVariant/1", quantity: 1 }],
        customerId: undefined,
        note: undefined,
        tags: [],
        metadata: { correlationId: "corr-1", idempotencyKey: "txn-1" },
      },
      idempotencyKey: "txn-1",
      correlationId: "corr-1",
      preconditions: [],
      timeoutMs: 5_000,
    });

    expect(outcome.status).toBe("succeeded");
    if (outcome.status === "succeeded") {
      expect(outcome.result.draftOrderId).toBe("gid://shopify/DraftOrder/42");
    }
    // The action went through the factory's authenticated client.
    expect(calls).toHaveLength(1);
    expect(calls[0]!.headers["X-Shopify-Access-Token"]).toBe("shpat_action_token");
    expect(calls[0]!.url).toContain("/admin/api/2025-07/graphql.json");
  });

  it("does not build a health port when no auth config is supplied", () => {
    const connector = createShopifyConnectorFromConfig({
      shopDomain: "counter-commerce-agent.myshopify.com",
      accessToken: "shpat_x",
    });
    expect(connector.health).toBeUndefined();
  });

  it("builds a health port when an auth config is supplied", () => {
    const connector = createShopifyConnectorFromConfig(
      {
        shopDomain: "counter-commerce-agent.myshopify.com",
        accessToken: "shpat_x",
      },
      {
        shopDomain: "counter-commerce-agent.myshopify.com",
        accessToken: "shpat_x",
        apiVersion: "2025-07",
        scopes: ["read_products"],
      },
    );
    expect(connector.health).toBeDefined();
  });
});
