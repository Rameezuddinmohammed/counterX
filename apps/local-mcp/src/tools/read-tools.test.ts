/**
 * Tests for read-only MCP tools.
 *
 * Covers both real-client behavior (product.details, quote.get,
 * transaction.status, receipt.verify - the four tools that map onto real
 * MerchantRuntimeClient methods) and the honest-fallback behavior for tools
 * with no reachable client (wallet.status, merchant.list, merchant.search,
 * pending-actions.list) and for the no-deps case generally.
 */

import { describe, expect, it } from "vitest";
import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { InMemoryTransport } from "@modelcontextprotocol/sdk/inMemory.js";
import { InMemoryMerchantRuntimeClient } from "@counter/wallet-application";
import type { ReadToolDependencies } from "./read-tools.js";
import { registerReadTools } from "./read-tools.js";

async function connectedClient(
  deps: ReadToolDependencies | undefined,
): Promise<{ server: McpServer; client: Client }> {
  const server = new McpServer({ name: "test-server", version: "0.1.0" });
  registerReadTools(server, deps);
  const [clientTransport, serverTransport] = InMemoryTransport.createLinkedPair();
  const mcpClient = new Client({ name: "test-client", version: "0.1.0" });
  await Promise.all([server.connect(serverTransport), mcpClient.connect(clientTransport)]);
  return { server, client: mcpClient };
}

function textOf(result: Awaited<ReturnType<Client["callTool"]>>): Record<string, unknown> {
  const content = (result.content as Array<{ type: string; text: string }>)[0];
  return JSON.parse(content?.text ?? "{}") as Record<string, unknown>;
}

describe("Read Tools Registration", () => {
  it("registers all read tools without errors, with or without deps", () => {
    const server1 = new McpServer({ name: "test", version: "0.1.0" });
    expect(() => registerReadTools(server1)).not.toThrow();

    const server2 = new McpServer({ name: "test", version: "0.1.0" });
    const merchantClient = new InMemoryMerchantRuntimeClient("sandbox");
    expect(() => registerReadTools(server2, { merchantClient })).not.toThrow();
  });
});

describe("read-tools: real client wiring", () => {
  it("product.details returns real data from the client", async () => {
    const merchantClient = new InMemoryMerchantRuntimeClient("sandbox");
    merchantClient.setManifest("merchant-1", {
      valid: true,
      merchantId: "merchant-1",
      environment: "sandbox",
      verifiedDomains: [],
      merchantCountry: "IN",
      capabilities: [],
      healthStatus: "healthy",
    });
    merchantClient.setProductResponse("merchant-1:variant-1", {
      variantId: "variant-1",
      merchantId: "merchant-1",
      title: "Real Product",
      description: "A real product from the connector",
      price: { amount: "1999", currency: "INR" },
      available: true,
      version: "1",
      freshness: new Date().toISOString(),
    });

    const { client } = await connectedClient({ merchantClient });
    const result = await client.callTool({
      name: "product.details",
      arguments: { merchant_id: "merchant-1", variant_id: "variant-1" },
    });
    const parsed = textOf(result);
    expect(parsed["status"]).toBe("found");
    expect((parsed["product"] as { title: string }).title).toBe("Real Product");
  });

  it("quote.get returns real data from the client", async () => {
    const merchantClient = new InMemoryMerchantRuntimeClient("sandbox");
    merchantClient.setManifest("merchant-1", {
      valid: true,
      merchantId: "merchant-1",
      environment: "sandbox",
      verifiedDomains: [],
      merchantCountry: "IN",
      capabilities: [],
      healthStatus: "healthy",
    });
    merchantClient.setQuoteResponse("merchant-1", {
      quoteId: "quote-1",
      merchantId: "merchant-1",
      variantId: "variant-1",
      quantity: 2,
      unitPrice: { amount: "1999", currency: "INR" },
      totalPrice: { amount: "3998", currency: "INR" },
      expiresAt: new Date(Date.now() + 600_000).toISOString(),
      quoteDigest: "sha256:deadbeef",
      version: "1",
    });

    const { client } = await connectedClient({ merchantClient });
    const result = await client.callTool({
      name: "quote.get",
      arguments: {
        merchant_id: "merchant-1",
        variant_id: "variant-1",
        quantity: 2,
        currency: "INR",
      },
    });
    const parsed = textOf(result);
    expect(parsed["status"]).toBe("available");
    expect((parsed["quote"] as { quoteId: string }).quoteId).toBe("quote-1");
  });

  it("transaction.status returns real data from the client", async () => {
    const merchantClient = new InMemoryMerchantRuntimeClient("sandbox");
    merchantClient.setManifest("merchant-1", {
      valid: true,
      merchantId: "merchant-1",
      environment: "sandbox",
      verifiedDomains: [],
      merchantCountry: "IN",
      capabilities: [],
      healthStatus: "healthy",
    });
    merchantClient.setTransactionStatusResponse("merchant-1:tx-1", {
      transactionId: "tx-1",
      merchantId: "merchant-1",
      status: "completed",
      amount: { amount: "3998", currency: "INR" },
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString(),
      version: "1",
    });

    const { client } = await connectedClient({ merchantClient });
    const result = await client.callTool({
      name: "transaction.status",
      arguments: { merchant_id: "merchant-1", transaction_id: "tx-1" },
    });
    const parsed = textOf(result);
    expect(parsed["status"]).toBe("known");
    expect((parsed["state"] as { status: string }).status).toBe("completed");
  });

  it("receipt.verify returns real data from the client", async () => {
    const merchantClient = new InMemoryMerchantRuntimeClient("sandbox");
    merchantClient.setManifest("merchant-1", {
      valid: true,
      merchantId: "merchant-1",
      environment: "sandbox",
      verifiedDomains: [],
      merchantCountry: "IN",
      capabilities: [],
      healthStatus: "healthy",
    });
    merchantClient.setReceiptResponse("merchant-1:tx-1", {
      receiptId: "rcpt-1",
      transactionId: "tx-1",
      merchantId: "merchant-1",
      issuedAt: new Date().toISOString(),
      items: [],
      total: { amount: "3998", currency: "INR" },
      signature: "sig",
    });

    const { client } = await connectedClient({ merchantClient });
    const result = await client.callTool({
      name: "receipt.verify",
      arguments: { merchant_id: "merchant-1", transaction_id: "tx-1" },
    });
    const parsed = textOf(result);
    expect(parsed["status"]).toBe("found");
    expect((parsed["receipt"] as { receiptId: string }).receiptId).toBe("rcpt-1");
  });

  it("product.details surfaces a not_found status when the client errors", async () => {
    const merchantClient = new InMemoryMerchantRuntimeClient("sandbox");
    // No manifest configured -> the client's own verification fails.
    const { client } = await connectedClient({ merchantClient });
    const result = await client.callTool({
      name: "product.details",
      arguments: { merchant_id: "merchant-1", variant_id: "variant-1" },
    });
    const parsed = textOf(result);
    expect(parsed["status"]).toBe("not_found");
    expect(parsed["product"]).toBeNull();
  });
});

describe("read-tools: honest fallback for structurally-unreachable tools", () => {
  it("wallet.status, merchant.list, pending-actions.list, and wallet.list stay honestly stubbed even with a real client", async () => {
    const merchantClient = new InMemoryMerchantRuntimeClient("sandbox");
    const { client } = await connectedClient({ merchantClient });

    const walletStatus = textOf(
      await client.callTool({ name: "wallet.status", arguments: { wallet_id: "wallet-1" } }),
    );
    expect(walletStatus["status"]).toBe("active");
    expect(walletStatus["mandates"]).toEqual([]);

    const merchantList = textOf(
      await client.callTool({ name: "merchant.list", arguments: { wallet_id: "wallet-1" } }),
    );
    expect(merchantList["merchants"]).toEqual([]);

    const pendingActions = textOf(
      await client.callTool({
        name: "pending-actions.list",
        arguments: { wallet_id: "wallet-1" },
      }),
    );
    expect(pendingActions["pending_actions"]).toEqual([]);
  });

  it("every tool still works with no deps at all (backward compatible)", async () => {
    const { client } = await connectedClient(undefined);
    const result = textOf(
      await client.callTool({
        name: "product.details",
        arguments: { merchant_id: "merchant-1", variant_id: "variant-1" },
      }),
    );
    expect(result["status"]).toBe("not_found");
    expect(result["product"]).toBeNull();
  });
});
