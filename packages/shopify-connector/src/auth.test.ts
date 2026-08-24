import { describe, expect, it } from "vitest";
import {
  validateToken,
  verifyWebhookSignature,
  checkScopes,
  validateShopDomain,
  redactCredentials,
} from "./auth.js";
import type { ShopifyAuthConfig } from "./auth.js";

describe("validateToken", () => {
  it("accepts a valid token format", () => {
    const config: ShopifyAuthConfig = {
      shopDomain: "test-store.myshopify.com",
      accessToken: "shpat_abcdef1234567890abcdef",
      apiVersion: "2025-07",
      scopes: ["read_products"],
    };
    const result = validateToken(config);
    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.value.valid).toBe(true);
      expect(result.value.shopDomain).toBe("test-store.myshopify.com");
      expect(result.value.tokenPrefix).toBe("shpat_abcd");
    }
  });

  it("rejects a token without shpat_ prefix", () => {
    const config: ShopifyAuthConfig = {
      shopDomain: "test-store.myshopify.com",
      accessToken: "invalid_token_format_here",
      apiVersion: "2025-07",
      scopes: ["read_products"],
    };
    const result = validateToken(config);
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.error.code).toBe("UNAUTHENTICATED");
    }
  });

  it("rejects a token that is too short", () => {
    const config: ShopifyAuthConfig = {
      shopDomain: "test-store.myshopify.com",
      accessToken: "shpat_abc",
      apiVersion: "2025-07",
      scopes: ["read_products"],
    };
    const result = validateToken(config);
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.error.code).toBe("UNAUTHENTICATED");
    }
  });

  it("rejects a token with an invalid shop domain", () => {
    const config: ShopifyAuthConfig = {
      shopDomain: "evil-site.example.com",
      accessToken: "shpat_abcdef1234567890abcdef",
      apiVersion: "2025-07",
      scopes: ["read_products"],
    };
    const result = validateToken(config);
    expect(result.ok).toBe(false);
  });
});

describe("validateShopDomain", () => {
  it("accepts a valid myshopify.com domain", () => {
    const result = validateShopDomain("my-store.myshopify.com");
    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.value).toBe("my-store.myshopify.com");
    }
  });

  it("rejects a domain without .myshopify.com suffix", () => {
    const result = validateShopDomain("evil-store.example.com");
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.error.code).toBe("INVALID_FORMAT");
    }
  });

  it("rejects a domain that is a private IP", () => {
    const result = validateShopDomain("192-168-1-1.myshopify.com");
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.error.code).toBe("INVALID_FORMAT");
    }
  });

  it("rejects domain with 10.x private range pattern", () => {
    const result = validateShopDomain("10-0-0-1.myshopify.com");
    expect(result.ok).toBe(false);
  });

  it("rejects domain with 127.x loopback pattern", () => {
    const result = validateShopDomain("127-0-0-1.myshopify.com");
    expect(result.ok).toBe(false);
  });

  it("normalizes domain to lowercase", () => {
    const result = validateShopDomain("My-Store.myshopify.com");
    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.value).toBe("my-store.myshopify.com");
    }
  });
});

describe("verifyWebhookSignature", () => {
  it("returns true for a valid base64-encoded HMAC signature", async () => {
    const secret = "my-webhook-secret";
    const body = new TextEncoder().encode('{"test":"data"}');

    // Compute expected HMAC as base64 (matching Shopify's wire format)
    const keyData = new TextEncoder().encode(secret);
    const cryptoKey = await crypto.subtle.importKey(
      "raw",
      keyData,
      { name: "HMAC", hash: "SHA-256" },
      false,
      ["sign"],
    );
    const sig = await crypto.subtle.sign("HMAC", cryptoKey, body);
    const expectedHmac = Buffer.from(sig).toString("base64");

    const result = await verifyWebhookSignature(body, expectedHmac, secret);
    expect(result).toBe(true);
  });

  it("returns false for an invalid HMAC signature", async () => {
    const secret = "my-webhook-secret";
    const body = new TextEncoder().encode('{"test":"data"}');
    // Invalid base64-encoded HMAC (32 bytes of 0xAA encoded in base64)
    const invalidHmac = Buffer.alloc(32, 0xaa).toString("base64");

    const result = await verifyWebhookSignature(body, invalidHmac, secret);
    expect(result).toBe(false);
  });

  it("returns false when body is tampered", async () => {
    const secret = "my-webhook-secret";
    const originalBody = new TextEncoder().encode('{"test":"original"}');
    const tamperedBody = new TextEncoder().encode('{"test":"tampered"}');

    // Sign the original body and encode as base64 (Shopify's format)
    const keyData = new TextEncoder().encode(secret);
    const cryptoKey = await crypto.subtle.importKey(
      "raw",
      keyData,
      { name: "HMAC", hash: "SHA-256" },
      false,
      ["sign"],
    );
    const sig = await crypto.subtle.sign("HMAC", cryptoKey, originalBody);
    const hmac = Buffer.from(sig).toString("base64");

    // Verify with tampered body
    const result = await verifyWebhookSignature(tamperedBody, hmac, secret);
    expect(result).toBe(false);
  });
});

describe("checkScopes", () => {
  it("returns satisfied when all required scopes are present", () => {
    const result = checkScopes(
      ["read_products", "write_orders", "read_orders"],
      ["read_products", "write_orders"],
    );
    expect(result.satisfied).toBe(true);
    expect(result.missing).toHaveLength(0);
  });

  it("identifies missing scopes", () => {
    const result = checkScopes(
      ["read_products"],
      ["read_products", "write_orders", "read_inventory"],
    );
    expect(result.satisfied).toBe(false);
    expect(result.missing).toContain("write_orders");
    expect(result.missing).toContain("read_inventory");
  });

  it("identifies extra scopes", () => {
    const result = checkScopes(
      ["read_products", "write_orders", "write_customers"],
      ["read_products", "write_orders"],
    );
    expect(result.satisfied).toBe(true);
    expect(result.extra).toContain("write_customers");
  });

  it("handles empty granted scopes", () => {
    const result = checkScopes([], ["read_products"]);
    expect(result.satisfied).toBe(false);
    expect(result.missing).toContain("read_products");
  });

  it("handles empty required scopes", () => {
    const result = checkScopes(["read_products"], []);
    expect(result.satisfied).toBe(true);
    expect(result.extra).toContain("read_products");
  });
});

describe("redactCredentials", () => {
  it("masks shpat_ tokens", () => {
    const text = "Token: shpat_abcdef1234567890";
    const redacted = redactCredentials(text);
    expect(redacted).not.toContain("abcdef1234567890");
    expect(redacted).toContain("shpat_a");
    expect(redacted).toContain("*");
  });

  it("masks shpss_ tokens", () => {
    const text = "Secret: shpss_mysecretvalue123";
    const redacted = redactCredentials(text);
    expect(redacted).not.toContain("mysecretvalue123");
    expect(redacted).toContain("shpss_m");
    expect(redacted).toContain("*");
  });

  it("masks multiple credentials in a string", () => {
    const text = "Token: shpat_token1234 and secret: shpss_secret5678";
    const redacted = redactCredentials(text);
    expect(redacted).not.toContain("token1234");
    expect(redacted).not.toContain("secret5678");
  });

  it("preserves text without credentials", () => {
    const text = "No secrets here, just normal text";
    const redacted = redactCredentials(text);
    expect(redacted).toBe(text);
  });

  it("handles partial tokens in longer strings", () => {
    const text = "Error in request with shpat_longtoken123456789 failed at endpoint";
    const redacted = redactCredentials(text);
    expect(redacted).not.toContain("longtoken123456789");
    expect(redacted).toContain("shpat_l");
  });
});
