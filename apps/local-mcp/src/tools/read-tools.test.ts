/**
 * Tests for read-only MCP tools.
 *
 * Covers both real-client behavior (product.details, quote.get,
 * transaction.status, receipt.verify - the four tools that map onto real
 * MerchantRuntimeClient methods; wallet.status, via WalletRuntimeClient) and
 * the honest-fallback behavior for tools with no reachable client
 * (merchant.list, merchant.search, pending-actions.list) and for the
 * no-deps case generally.
 */

import { describe, expect, it } from "vitest";
import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { InMemoryTransport } from "@modelcontextprotocol/sdk/inMemory.js";
import { InMemoryMerchantRuntimeClient } from "@counter/wallet-application";
import type { ReadToolDependencies } from "./read-tools.js";
import { registerReadTools } from "./read-tools.js";
import type {
  WalletBalanceResult,
  WalletClientResult,
  WalletMandatesResult,
  WalletNotificationsResult,
  WalletRuntimeClient,
} from "../wallet-runtime-client.js";

/** Minimal fake WalletRuntimeClient for notifications.list/invoices.get/wallet.status tests. */
class FakeWalletRuntimeClient implements WalletRuntimeClient {
  #responses = new Map<string, WalletNotificationsResult>();
  #mandateResponses = new Map<string, WalletMandatesResult>();
  #balanceResponses = new Map<string, WalletBalanceResult>();
  failWith: WalletClientResult<WalletNotificationsResult> | undefined;
  mandatesFailWith: WalletClientResult<WalletMandatesResult> | undefined;
  balanceFailWith: WalletClientResult<WalletBalanceResult> | undefined;
  lastCall:
    | { walletId: string; options?: { limit?: number; notificationType?: string } }
    | undefined;
  lastMandatesCall: { walletId: string } | undefined;
  lastBalanceCall: { walletId: string } | undefined;

  setResponse(walletId: string, response: WalletNotificationsResult): void {
    this.#responses.set(walletId, response);
  }

  setMandatesResponse(walletId: string, response: WalletMandatesResult): void {
    this.#mandateResponses.set(walletId, response);
  }

  setBalanceResponse(walletId: string, response: WalletBalanceResult): void {
    this.#balanceResponses.set(walletId, response);
  }

  async listNotifications(
    walletId: string,
    options?: { readonly limit?: number; readonly notificationType?: string },
  ): Promise<WalletClientResult<WalletNotificationsResult>> {
    this.lastCall = { walletId, ...(options !== undefined ? { options: { ...options } } : {}) };
    if (this.failWith !== undefined) return this.failWith;
    const response = this.#responses.get(walletId);
    return response !== undefined
      ? { ok: true, value: response }
      : { ok: true, value: { walletId, notifications: [], total: 0 } };
  }

  async getMandates(walletId: string): Promise<WalletClientResult<WalletMandatesResult>> {
    this.lastMandatesCall = { walletId };
    if (this.mandatesFailWith !== undefined) return this.mandatesFailWith;
    const response = this.#mandateResponses.get(walletId);
    return response !== undefined
      ? { ok: true, value: response }
      : { ok: true, value: { walletId, mandates: [], total: 0 } };
  }

  async getBalance(walletId: string): Promise<WalletClientResult<WalletBalanceResult>> {
    this.lastBalanceCall = { walletId };
    if (this.balanceFailWith !== undefined) return this.balanceFailWith;
    const response = this.#balanceResponses.get(walletId);
    return response !== undefined
      ? { ok: true, value: response }
      : {
          ok: true,
          value: { walletId, hasBalanceAccount: false, balanceMinor: "0", currency: "INR" },
        };
  }
}

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

  it("merchant.list returns real directory data from the client", async () => {
    const merchantClient = new InMemoryMerchantRuntimeClient("sandbox");
    merchantClient.setDirectoryResponse({
      merchants: [
        {
          merchantId: "merchant-1",
          displayName: "Real Merchant",
          goodsTypes: [],
          capabilities: [],
        },
      ],
      total: 1,
    });

    const { client } = await connectedClient({ merchantClient });
    const result = textOf(
      await client.callTool({ name: "merchant.list", arguments: { wallet_id: "wallet-1" } }),
    );
    expect(result["total"]).toBe(1);
    expect((result["merchants"] as Array<{ merchantId: string }>)[0]?.merchantId).toBe(
      "merchant-1",
    );
  });

  it("merchant.search filters real directory data by query and category", async () => {
    const merchantClient = new InMemoryMerchantRuntimeClient("sandbox");
    merchantClient.setDirectoryResponse({
      merchants: [
        {
          merchantId: "merchant-1",
          displayName: "Alpha Apparel",
          goodsTypes: ["fulfillment.physical.ship"],
          capabilities: [],
        },
        {
          merchantId: "merchant-2",
          displayName: "Alpha Digital",
          goodsTypes: ["fulfillment.digital.deliver"],
          capabilities: [],
        },
      ],
      total: 2,
    });

    const { client } = await connectedClient({ merchantClient });
    const result = textOf(
      await client.callTool({
        name: "merchant.search",
        arguments: { wallet_id: "wallet-1", query: "alpha", category: "fulfillment.physical.ship" },
      }),
    );
    expect(result["total"]).toBe(1);
    expect((result["results"] as Array<{ merchantId: string }>)[0]?.merchantId).toBe("merchant-1");
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
  it("pending-actions.list stays honestly stubbed even with a real client (no durable pending-approval concept exists)", async () => {
    const merchantClient = new InMemoryMerchantRuntimeClient("sandbox");
    const { client } = await connectedClient({ merchantClient });

    const pendingActions = textOf(
      await client.callTool({
        name: "pending-actions.list",
        arguments: { wallet_id: "wallet-1" },
      }),
    );
    expect(pendingActions["pending_actions"]).toEqual([]);
  });

  it("merchant.list falls back to an honest empty directory with no merchantClient", async () => {
    const { client } = await connectedClient(undefined);
    const merchantList = textOf(
      await client.callTool({ name: "merchant.list", arguments: { wallet_id: "wallet-1" } }),
    );
    expect(merchantList["merchants"]).toEqual([]);
    expect(merchantList["total"]).toBe(0);
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

  it("notifications.list, invoices.get, and wallet.status stay honestly unavailable with no walletClient", async () => {
    const merchantClient = new InMemoryMerchantRuntimeClient("sandbox");
    const { client } = await connectedClient({ merchantClient });

    const notifications = textOf(
      await client.callTool({ name: "notifications.list", arguments: { wallet_id: "wallet-1" } }),
    );
    expect(notifications["status"]).toBe("unavailable");
    expect(notifications["notifications"]).toEqual([]);

    const invoices = textOf(
      await client.callTool({ name: "invoices.get", arguments: { wallet_id: "wallet-1" } }),
    );
    expect(invoices["status"]).toBe("unavailable");
    expect(invoices["invoices"]).toEqual([]);

    const walletStatus = textOf(
      await client.callTool({ name: "wallet.status", arguments: { wallet_id: "wallet-1" } }),
    );
    expect(walletStatus["status"]).toBe("unavailable");
    expect(walletStatus["mandates"]).toEqual([]);
    expect(walletStatus["balance"]).toBeNull();
  });
});

describe("read-tools: wallet.status (Phase 4)", () => {
  it("reports active when the wallet has at least one active mandate, with real mandate data", async () => {
    const walletClient = new FakeWalletRuntimeClient();
    walletClient.setMandatesResponse("wallet-1", {
      walletId: "wallet-1",
      mandates: [
        {
          mandateId: "ctr_mandate_1",
          agentId: "ctr_agent_1",
          principalId: "ctr_actor_1",
          kid: "kid-1",
          paymentReferenceId: "prepaid-balance:wallet-1",
          validFrom: new Date().toISOString(),
          validUntil: new Date(Date.now() + 3_600_000).toISOString(),
          issuedAt: new Date().toISOString(),
          status: "active",
          policyVersionId: "v1",
          constraints: {},
        },
      ],
      total: 1,
    });

    const { client } = await connectedClient({ walletClient });
    const result = textOf(
      await client.callTool({ name: "wallet.status", arguments: { wallet_id: "wallet-1" } }),
    );
    expect(result["status"]).toBe("active");
    expect((result["mandates"] as unknown[]).length).toBe(1);
    expect(walletClient.lastMandatesCall?.walletId).toBe("wallet-1");
  });

  it("reports no_active_mandate (never fabricates 'active') when the wallet has zero active mandates", async () => {
    const walletClient = new FakeWalletRuntimeClient();
    const { client } = await connectedClient({ walletClient });
    const result = textOf(
      await client.callTool({ name: "wallet.status", arguments: { wallet_id: "wallet-1" } }),
    );
    expect(result["status"]).toBe("no_active_mandate");
    expect(result["mandates"]).toEqual([]);
  });

  it("a DIFFERENT wallet's mandates never leak into this wallet's status", async () => {
    const walletClient = new FakeWalletRuntimeClient();
    walletClient.setMandatesResponse("wallet-1", {
      walletId: "wallet-1",
      mandates: [
        {
          mandateId: "ctr_mandate_1",
          agentId: "ctr_agent_1",
          principalId: "ctr_actor_1",
          kid: "kid-1",
          paymentReferenceId: "prepaid-balance:wallet-1",
          validFrom: new Date().toISOString(),
          validUntil: new Date(Date.now() + 3_600_000).toISOString(),
          issuedAt: new Date().toISOString(),
          status: "active",
          policyVersionId: "v1",
          constraints: {},
        },
      ],
      total: 1,
    });

    const { client } = await connectedClient({ walletClient });
    const result = textOf(
      await client.callTool({ name: "wallet.status", arguments: { wallet_id: "wallet-2" } }),
    );
    expect(result["status"]).toBe("no_active_mandate");
    expect(result["mandates"]).toEqual([]);
  });

  it("surfaces indeterminate on a timeout, unavailable on other errors", async () => {
    const walletClient = new FakeWalletRuntimeClient();
    walletClient.mandatesFailWith = {
      ok: false,
      error: { kind: "timeout", message: "Request timed out" },
    };
    const { client } = await connectedClient({ walletClient });
    const result = textOf(
      await client.callTool({ name: "wallet.status", arguments: { wallet_id: "wallet-1" } }),
    );
    expect(result["status"]).toBe("indeterminate");

    walletClient.mandatesFailWith = {
      ok: false,
      error: { kind: "network", message: "Network request failed" },
    };
    const result2 = textOf(
      await client.callTool({ name: "wallet.status", arguments: { wallet_id: "wallet-1" } }),
    );
    expect(result2["status"]).toBe("unavailable");
  });

  it("includes the wallet's real prepaid balance", async () => {
    const walletClient = new FakeWalletRuntimeClient();
    walletClient.setBalanceResponse("wallet-1", {
      walletId: "wallet-1",
      hasBalanceAccount: true,
      balanceMinor: "150000",
      currency: "INR",
    });

    const { client } = await connectedClient({ walletClient });
    const result = textOf(
      await client.callTool({ name: "wallet.status", arguments: { wallet_id: "wallet-1" } }),
    );
    expect(result["balance"]).toEqual({
      hasBalanceAccount: true,
      balanceMinor: "150000",
      currency: "INR",
    });
    expect(walletClient.lastBalanceCall?.walletId).toBe("wallet-1");
  });

  it("reports mandates normally even when the balance fetch fails — one failure never masks the other", async () => {
    const walletClient = new FakeWalletRuntimeClient();
    walletClient.setMandatesResponse("wallet-1", {
      walletId: "wallet-1",
      mandates: [
        {
          mandateId: "ctr_mandate_1",
          agentId: "ctr_agent_1",
          principalId: "ctr_actor_1",
          kid: "kid-1",
          paymentReferenceId: "prepaid-balance:wallet-1",
          validFrom: new Date().toISOString(),
          validUntil: new Date(Date.now() + 3_600_000).toISOString(),
          issuedAt: new Date().toISOString(),
          status: "active",
          policyVersionId: "v1",
          constraints: {},
        },
      ],
      total: 1,
    });
    walletClient.balanceFailWith = {
      ok: false,
      error: { kind: "network", message: "Network request failed" },
    };

    const { client } = await connectedClient({ walletClient });
    const result = textOf(
      await client.callTool({ name: "wallet.status", arguments: { wallet_id: "wallet-1" } }),
    );
    expect(result["status"]).toBe("active");
    expect((result["mandates"] as unknown[]).length).toBe(1);
    expect(result["balance"]).toBeNull();
  });
});

describe("read-tools: notifications.list / invoices.get (Phase 2)", () => {
  it("notifications.list returns real data from the wallet client, scoped to the requested wallet", async () => {
    const walletClient = new FakeWalletRuntimeClient();
    walletClient.setResponse("wallet-1", {
      walletId: "wallet-1",
      notifications: [
        {
          id: "ctr_buyer-notification_1",
          notificationType: "merchant.order.created.v1",
          transactionId: "ctr_transaction_1",
          payload: { amountMinor: 122882 },
          createdAt: new Date().toISOString(),
        },
      ],
      total: 1,
    });

    const { client } = await connectedClient({ walletClient });
    const result = await client.callTool({
      name: "notifications.list",
      arguments: { wallet_id: "wallet-1" },
    });
    const parsed = textOf(result);
    expect(parsed["status"]).toBe("available");
    expect(parsed["total"]).toBe(1);
    expect(walletClient.lastCall?.walletId).toBe("wallet-1");
  });

  it("notifications.list for a DIFFERENT wallet never sees another wallet's data", async () => {
    const walletClient = new FakeWalletRuntimeClient();
    walletClient.setResponse("wallet-1", {
      walletId: "wallet-1",
      notifications: [
        {
          id: "ctr_buyer-notification_1",
          notificationType: "merchant.order.created.v1",
          transactionId: "ctr_transaction_1",
          payload: {},
          createdAt: new Date().toISOString(),
        },
      ],
      total: 1,
    });

    const { client } = await connectedClient({ walletClient });
    const result = await client.callTool({
      name: "notifications.list",
      arguments: { wallet_id: "wallet-2" },
    });
    const parsed = textOf(result);
    expect(parsed["total"]).toBe(0);
    expect(parsed["notifications"]).toEqual([]);
  });

  it("notifications.list surfaces indeterminate on a timeout, unavailable on other errors", async () => {
    const walletClient = new FakeWalletRuntimeClient();
    walletClient.failWith = { ok: false, error: { kind: "timeout", message: "Request timed out" } };
    const { client } = await connectedClient({ walletClient });
    const result = textOf(
      await client.callTool({ name: "notifications.list", arguments: { wallet_id: "wallet-1" } }),
    );
    expect(result["status"]).toBe("indeterminate");

    walletClient.failWith = {
      ok: false,
      error: { kind: "network", message: "Network request failed" },
    };
    const result2 = textOf(
      await client.callTool({ name: "notifications.list", arguments: { wallet_id: "wallet-1" } }),
    );
    expect(result2["status"]).toBe("unavailable");
  });

  it("invoices.get filters to merchant.order.created.v1 notifications only", async () => {
    const walletClient = new FakeWalletRuntimeClient();
    const { client } = await connectedClient({ walletClient });

    await client.callTool({ name: "invoices.get", arguments: { wallet_id: "wallet-1" } });

    expect(walletClient.lastCall?.options?.notificationType).toBe("merchant.order.created.v1");
  });
});
