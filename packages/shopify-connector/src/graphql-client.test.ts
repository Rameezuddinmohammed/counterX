import { describe, expect, it } from "vitest";
import { createMockGraphQLClient } from "./mock-graphql-client.js";
import { validateShopDomainSsrf, isPrivateIp } from "./http-graphql-client.js";
import type { ShopifyGraphQLResponse } from "./graphql-client.js";

describe("MockShopifyClient", () => {
  it("returns configured responses", async () => {
    const mockClient = createMockGraphQLClient();
    const expectedResponse: ShopifyGraphQLResponse<{ shop: { name: string } }> = {
      data: { shop: { name: "Test" } },
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
    mockClient.setResponse("{ shop { name } }", expectedResponse);

    const result = await mockClient.query<{ shop: { name: string } }>("{ shop { name } }", {});
    expect(result.data).toEqual({ shop: { name: "Test" } });
  });

  it("tracks call history", async () => {
    const mockClient = createMockGraphQLClient();
    const response: ShopifyGraphQLResponse<null> = {
      data: null,
      errors: undefined,
      extensions: undefined,
    };
    mockClient.setResponse("query1", response);
    mockClient.setResponse("mutation1", response);

    await mockClient.query("query1", { id: "123" });
    await mockClient.mutate("mutation1", { input: "abc" });

    expect(mockClient.callHistory).toHaveLength(2);
    expect(mockClient.callHistory[0]!.type).toBe("query");
    expect(mockClient.callHistory[0]!.operation).toBe("query1");
    expect(mockClient.callHistory[0]!.variables).toEqual({ id: "123" });
    expect(mockClient.callHistory[1]!.type).toBe("mutate");
    expect(mockClient.callHistory[1]!.operation).toBe("mutation1");
  });

  it("injects rate limit error", async () => {
    const mockClient = createMockGraphQLClient();
    mockClient.setFault({ kind: "rate_limit", retryAfterMs: 1000 });

    await expect(mockClient.query("test", {})).rejects.toThrow("Rate limited");
  });

  it("injects auth failure", async () => {
    const mockClient = createMockGraphQLClient();
    mockClient.setFault({ kind: "auth_failure", message: "Token revoked" });

    await expect(mockClient.query("test", {})).rejects.toThrow("Authentication failed");
  });

  it("injects network error", async () => {
    const mockClient = createMockGraphQLClient();
    mockClient.setFault({ kind: "network_error", message: "DNS resolution failed" });

    await expect(mockClient.mutate("test", {})).rejects.toThrow("Network error");
  });

  it("resets state", async () => {
    const mockClient = createMockGraphQLClient();
    const response: ShopifyGraphQLResponse<null> = {
      data: null,
      errors: undefined,
      extensions: undefined,
    };
    mockClient.setResponse("test", response);
    await mockClient.query("test", {});
    expect(mockClient.callHistory).toHaveLength(1);

    mockClient.reset();
    expect(mockClient.callHistory).toHaveLength(0);
  });
});

describe("SSRF validation (validateShopDomainSsrf)", () => {
  it("accepts valid myshopify.com domains", () => {
    const result = validateShopDomainSsrf("my-store.myshopify.com");
    expect(result.valid).toBe(true);
    expect(result.reason).toBeUndefined();
  });

  it("rejects non-myshopify.com domains", () => {
    const result = validateShopDomainSsrf("evil.example.com");
    expect(result.valid).toBe(false);
    expect(result.reason).toContain("myshopify.com");
  });

  it("rejects empty string", () => {
    const result = validateShopDomainSsrf("");
    expect(result.valid).toBe(false);
  });

  it("rejects domains with path traversal", () => {
    const result = validateShopDomainSsrf("store.myshopify.com/../../etc/passwd");
    expect(result.valid).toBe(false);
  });
});

describe("isPrivateIp", () => {
  it("rejects 10.x.x.x range", () => {
    expect(isPrivateIp("10.0.0.1")).toBe(true);
    expect(isPrivateIp("10.255.255.255")).toBe(true);
  });

  it("rejects 172.16-31.x.x range", () => {
    expect(isPrivateIp("172.16.0.1")).toBe(true);
    expect(isPrivateIp("172.31.255.255")).toBe(true);
  });

  it("rejects 192.168.x.x range", () => {
    expect(isPrivateIp("192.168.0.1")).toBe(true);
    expect(isPrivateIp("192.168.255.255")).toBe(true);
  });

  it("rejects 127.x.x.x loopback", () => {
    expect(isPrivateIp("127.0.0.1")).toBe(true);
  });

  it("rejects 169.254.x.x link-local", () => {
    expect(isPrivateIp("169.254.1.1")).toBe(true);
  });

  it("rejects IPv6 loopback", () => {
    expect(isPrivateIp("::1")).toBe(true);
  });

  it("rejects IPv6 unique local", () => {
    expect(isPrivateIp("fc00::1")).toBe(true);
    expect(isPrivateIp("fd12::1")).toBe(true);
  });

  it("rejects IPv6 link-local", () => {
    expect(isPrivateIp("fe80::1")).toBe(true);
  });

  it("allows public IPs", () => {
    expect(isPrivateIp("8.8.8.8")).toBe(false);
    expect(isPrivateIp("203.0.113.1")).toBe(false);
  });
});
