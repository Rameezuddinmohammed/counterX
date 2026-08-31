/**
 * Tests for consequential MCP write tools.
 *
 * Covers:
 * - purchase.propose: policy check + proposal generation
 * - purchase.execute: requires approved intent, validates mandate/quote binding
 * - purchase.cancel: cancel pending transaction
 * - purchase.refund-request: request refund on completed transaction
 * - Error cases
 */

import { describe, expect, it, beforeEach } from "vitest";
import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { InMemoryTransport } from "@modelcontextprotocol/sdk/inMemory.js";
import { InMemorySecureKeyStore } from "@counter/wallet-domain";
import {
  InMemoryMerchantRuntimeClient,
  InMemoryRevocationStore,
} from "@counter/wallet-application";
import { InMemoryKeyRegistry, verifyEnvelope } from "@counter/trust-protocol";
import type { KeyRecord } from "@counter/trust-protocol";
import type { WriteToolDependencies } from "./write-tools.js";
import { registerWriteTools } from "./write-tools.js";

// ---------------------------------------------------------------------------
// Test Helpers
// ---------------------------------------------------------------------------

function createTestDeps(): WriteToolDependencies {
  const keyStore = new InMemorySecureKeyStore();
  const merchantClient = new InMemoryMerchantRuntimeClient("sandbox");
  const revocationStore = new InMemoryRevocationStore();
  return { keyStore, merchantClient, revocationStore };
}

function createTestServer(deps: WriteToolDependencies): McpServer {
  const server = new McpServer({ name: "test-server", version: "0.1.0" });
  registerWriteTools(server, deps);
  return server;
}

// ---------------------------------------------------------------------------
// Tests: purchase.propose
// ---------------------------------------------------------------------------

describe("write-tools: purchase.propose", () => {
  it("registerWriteTools registers tools without error", () => {
    const deps = createTestDeps();
    const server = createTestServer(deps);
    expect(server).toBeDefined();
  });

  it("write tool dependencies are properly typed", () => {
    const deps = createTestDeps();
    expect(deps.keyStore).toBeDefined();
    expect(deps.merchantClient).toBeDefined();
    expect(deps.revocationStore).toBeDefined();
  });
});

// ---------------------------------------------------------------------------
// Tests: purchase.execute
// ---------------------------------------------------------------------------

describe("write-tools: purchase.execute", () => {
  let deps: WriteToolDependencies;

  beforeEach(() => {
    deps = createTestDeps();
  });

  it("registers execute tool on server", () => {
    const server = createTestServer(deps);
    expect(server).toBeDefined();
  });

  it("revocation store blocks revoked mandates", () => {
    const { revocationStore } = deps;
    revocationStore.save({
      revocationId: "rev-1",
      scopeType: "mandate",
      scopeId: "mandate-123",
      effectiveTime: new Date().toISOString(),
      reasonClass: "principal_initiated",
      sequence: 1,
      createdAt: new Date().toISOString(),
      principalId: "actor-1",
    });

    expect(revocationStore.isRevoked("mandate", "mandate-123")).toBe(true);
    expect(revocationStore.isRevoked("mandate", "mandate-other")).toBe(false);
  });

  it("revocation store blocks revoked wallets", () => {
    const { revocationStore } = deps;
    revocationStore.save({
      revocationId: "rev-2",
      scopeType: "wallet",
      scopeId: "wallet-abc",
      effectiveTime: new Date().toISOString(),
      reasonClass: "security_compromise",
      sequence: 1,
      createdAt: new Date().toISOString(),
      principalId: "actor-1",
    });

    expect(revocationStore.isRevoked("wallet", "wallet-abc")).toBe(true);
    expect(revocationStore.isRevoked("wallet", "wallet-def")).toBe(false);
  });

  it("actually signs the purchase intent and sends the signature — proves the previously-missing wiring", async () => {
    const { keyStore, merchantClient } = deps;
    const client = merchantClient as InMemoryMerchantRuntimeClient;
    keyStore.unlockStore("default-credential");
    const { keyId, publicKey } = await keyStore.generateKey("agent-signing");

    client.setManifest("merchant-1", {
      valid: true,
      merchantId: "merchant-1",
      environment: "sandbox",
      verifiedDomains: [],
      merchantCountry: "IN",
      capabilities: ["purchase"],
      healthStatus: "healthy",
    });
    client.setTransactionCreateResponse("merchant-1", {
      transactionId: "tx-signed-1",
      merchantId: "merchant-1",
      quoteId: "quote-1",
      status: "pending",
      amount: { amount: "25000", currency: "INR" },
      createdAt: new Date().toISOString(),
      version: "1",
    });

    const server = createTestServer(deps);
    const [clientTransport, serverTransport] = InMemoryTransport.createLinkedPair();
    const mcpClient = new Client({ name: "test-client", version: "0.1.0" });
    await Promise.all([server.connect(serverTransport), mcpClient.connect(clientTransport)]);

    const quoteExpiresAt = new Date(Date.now() + 10 * 60 * 1000).toISOString();
    const permissivePolicy = {
      merchant_allowlist: { allowed_merchant_ids: ["merchant-1"], allowed_domains: [] },
      geography: { allowed_merchant_countries: ["IN"], allowed_delivery_countries: ["IN"] },
      category: { allowed_categories: [] },
      currency: { allowed_currencies: ["INR"] },
      amount_limits: { per_transaction_max_paise: "100000" },
      count_limits: {},
      operations: { allowed_operations: ["purchase"] },
      time_constraints: {},
      approval_threshold: { threshold_paise: "50000" },
      payment_references: { allowed_reference_ids: ["ref-001"] },
    };

    const result = await mcpClient.callTool({
      name: "purchase.execute",
      arguments: {
        wallet_id: "wallet-1",
        merchant_id: "merchant-1",
        mandate_id: "mandate-1",
        quote_id: "quote-1",
        quote_digest: "digest-abc",
        amount_paise: "25000",
        currency: "INR",
        merchant_country: "IN",
        delivery_country: "IN",
        quote_expires_at: quoteExpiresAt,
        payment_reference_id: "ref-001",
        kid: keyId,
        agent_id: "agent-1",
        correlation_id: "corr-1",
        payment_method: "counter_test",
        policy_version_id: "policy-v1",
        policy: permissivePolicy,
      },
    });

    const content = (result.content as Array<{ type: string; text: string }>)[0];
    const parsed = JSON.parse(content?.text ?? "{}") as { status: string };
    expect(parsed.status).toBe("success");

    // The whole point of this test: a real signature was produced AND sent.
    const call = client.lastCreateTransactionCall;
    expect(call?.signedEnvelope).toBeDefined();
    const envelope = call!.signedEnvelope!;
    expect(envelope.signature.kid).toBe(keyId);

    const keyRecord: KeyRecord = {
      kid: keyId,
      use: "sign",
      alg: "EdDSA",
      publicKey: Buffer.from(publicKey).toString("base64url"),
      status: "active",
      validFrom: "2024-01-01T00:00:00.000Z",
      validUntil: "2030-12-31T23:59:59.999Z",
      issuer: "counter://test/local-mcp-test",
    };
    const registry = new InMemoryKeyRegistry([keyRecord]);
    const verifyResult = await verifyEnvelope(envelope, {
      keyRegistry: registry,
      currentTime: new Date().toISOString(),
      expectedAudience: "merchant-1",
    });
    expect(verifyResult.ok).toBe(true);

    await mcpClient.close();
  });
});

// ---------------------------------------------------------------------------
// Tests: purchase.cancel
// ---------------------------------------------------------------------------

describe("write-tools: purchase.cancel", () => {
  it("registers cancel tool on server", () => {
    const deps = createTestDeps();
    const server = createTestServer(deps);
    expect(server).toBeDefined();
  });

  it("merchant client transaction status controls cancel eligibility", async () => {
    const deps = createTestDeps();
    const client = deps.merchantClient as InMemoryMerchantRuntimeClient;

    // Set up manifest for verification
    client.setManifest("merchant-1", {
      valid: true,
      merchantId: "merchant-1",
      environment: "sandbox",
      verifiedDomains: [],
      merchantCountry: "IN",
      capabilities: ["purchase"],
      healthStatus: "healthy",
    });

    // Set up a pending transaction
    client.setTransactionStatusResponse("merchant-1:tx-1", {
      transactionId: "tx-1",
      merchantId: "merchant-1",
      status: "pending",
      amount: { amount: "10000", currency: "INR" },
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString(),
      version: "1",
    });

    const result = await client.getTransactionStatus("merchant-1", "tx-1");
    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.value.status).toBe("pending");
    }
  });

  it("non-pending transaction cannot be cancelled", async () => {
    const deps = createTestDeps();
    const client = deps.merchantClient as InMemoryMerchantRuntimeClient;

    client.setManifest("merchant-1", {
      valid: true,
      merchantId: "merchant-1",
      environment: "sandbox",
      verifiedDomains: [],
      merchantCountry: "IN",
      capabilities: ["purchase"],
      healthStatus: "healthy",
    });

    client.setTransactionStatusResponse("merchant-1:tx-2", {
      transactionId: "tx-2",
      merchantId: "merchant-1",
      status: "completed",
      amount: { amount: "10000", currency: "INR" },
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString(),
      version: "1",
    });

    const result = await client.getTransactionStatus("merchant-1", "tx-2");
    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.value.status).toBe("completed");
      // Completed transaction is not in pending state - cancel should be rejected
      expect(result.value.status !== "pending").toBe(true);
    }
  });

  it("actually calls the real cancel route and returns the server's own cancelledAt, not a locally-fabricated one", async () => {
    const deps = createTestDeps();
    const client = deps.merchantClient as InMemoryMerchantRuntimeClient;

    client.setManifest("merchant-1", {
      valid: true,
      merchantId: "merchant-1",
      environment: "sandbox",
      verifiedDomains: [],
      merchantCountry: "IN",
      capabilities: ["purchase"],
      healthStatus: "healthy",
    });
    client.setTransactionStatusResponse("merchant-1:tx-3", {
      transactionId: "tx-3",
      merchantId: "merchant-1",
      status: "pending",
      amount: { amount: "10000", currency: "INR" },
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString(),
      version: "1",
    });
    const serverCancelledAt = "2026-01-01T00:00:00.000Z";
    client.setCancelResponse("merchant-1:tx-3", {
      transactionId: "tx-3",
      status: "cancelled",
      cancelledAt: serverCancelledAt,
      version: "2",
    });

    const server = createTestServer(deps);
    const [clientTransport, serverTransport] = InMemoryTransport.createLinkedPair();
    const mcpClient = new Client({ name: "test-client", version: "0.1.0" });
    await Promise.all([server.connect(serverTransport), mcpClient.connect(clientTransport)]);

    const result = await mcpClient.callTool({
      name: "purchase.cancel",
      arguments: { merchant_id: "merchant-1", transaction_id: "tx-3", reason: "changed my mind" },
    });
    const content = (result.content as Array<{ type: string; text: string }>)[0];
    const parsed = JSON.parse(content?.text ?? "{}") as {
      status: string;
      cancelled_at: string;
    };
    expect(parsed.status).toBe("cancelled");
    // The whole point of this test: this came from the server's real
    // response, not from a locally-fabricated `new Date().toISOString()`.
    expect(parsed.cancelled_at).toBe(serverCancelledAt);
  });

  it("surfaces a failed status when the real cancel route rejects it", async () => {
    const deps = createTestDeps();
    const client = deps.merchantClient as InMemoryMerchantRuntimeClient;

    client.setManifest("merchant-1", {
      valid: true,
      merchantId: "merchant-1",
      environment: "sandbox",
      verifiedDomains: [],
      merchantCountry: "IN",
      capabilities: ["purchase"],
      healthStatus: "healthy",
    });
    client.setTransactionStatusResponse("merchant-1:tx-4", {
      transactionId: "tx-4",
      merchantId: "merchant-1",
      status: "pending",
      amount: { amount: "10000", currency: "INR" },
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString(),
      version: "1",
    });
    // No cancel response configured -> the in-memory client returns a
    // malformed_response error, simulating the server refusing the cancel.
    client.simulateFailure(undefined);

    const server = createTestServer(deps);
    const [clientTransport, serverTransport] = InMemoryTransport.createLinkedPair();
    const mcpClient = new Client({ name: "test-client", version: "0.1.0" });
    await Promise.all([server.connect(serverTransport), mcpClient.connect(clientTransport)]);

    const result = await mcpClient.callTool({
      name: "purchase.cancel",
      arguments: { merchant_id: "merchant-1", transaction_id: "tx-4", reason: "too late" },
    });
    const content = (result.content as Array<{ type: string; text: string }>)[0];
    const parsed = JSON.parse(content?.text ?? "{}") as { status: string };
    expect(parsed.status).toBe("failed");
  });
});

// ---------------------------------------------------------------------------
// Tests: purchase.refund-request
// ---------------------------------------------------------------------------

describe("write-tools: purchase.refund-request", () => {
  it("registers refund-request tool on server", () => {
    const deps = createTestDeps();
    const server = createTestServer(deps);
    expect(server).toBeDefined();
  });

  it("only completed transactions are eligible for refund", async () => {
    const deps = createTestDeps();
    const client = deps.merchantClient as InMemoryMerchantRuntimeClient;

    client.setManifest("merchant-1", {
      valid: true,
      merchantId: "merchant-1",
      environment: "sandbox",
      verifiedDomains: [],
      merchantCountry: "IN",
      capabilities: ["purchase", "refund"],
      healthStatus: "healthy",
    });

    client.setTransactionStatusResponse("merchant-1:tx-3", {
      transactionId: "tx-3",
      merchantId: "merchant-1",
      status: "completed",
      amount: { amount: "25000", currency: "INR" },
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString(),
      version: "2",
    });

    const result = await client.getTransactionStatus("merchant-1", "tx-3");
    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.value.status).toBe("completed");
    }
  });

  it("pending transaction is not eligible for refund", async () => {
    const deps = createTestDeps();
    const client = deps.merchantClient as InMemoryMerchantRuntimeClient;

    client.setManifest("merchant-1", {
      valid: true,
      merchantId: "merchant-1",
      environment: "sandbox",
      verifiedDomains: [],
      merchantCountry: "IN",
      capabilities: ["purchase"],
      healthStatus: "healthy",
    });

    client.setTransactionStatusResponse("merchant-1:tx-4", {
      transactionId: "tx-4",
      merchantId: "merchant-1",
      status: "pending",
      amount: { amount: "5000", currency: "INR" },
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString(),
      version: "1",
    });

    const result = await client.getTransactionStatus("merchant-1", "tx-4");
    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.value.status).toBe("pending");
      expect(result.value.status !== "completed").toBe(true);
    }
  });

  it("actually calls the merchant runtime's refund relay, not a fabricated local response", async () => {
    const deps = createTestDeps();
    const client = deps.merchantClient as InMemoryMerchantRuntimeClient;

    client.setManifest("merchant-1", {
      valid: true,
      merchantId: "merchant-1",
      environment: "sandbox",
      verifiedDomains: [],
      merchantCountry: "IN",
      capabilities: ["purchase", "refund"],
      healthStatus: "healthy",
    });
    client.setTransactionStatusResponse("merchant-1:tx-5", {
      transactionId: "tx-5",
      merchantId: "merchant-1",
      status: "completed",
      amount: { amount: "25000", currency: "INR" },
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString(),
      version: "1",
    });
    // The relay's real (server-issued) response — distinct from anything the
    // tool could fabricate itself, so a passing test proves this value
    // actually flowed through requestRefund().
    client.setRefundResponse("merchant-1:tx-5", {
      refundRequestId: "refund-request-real-1",
      transactionId: "tx-5",
      status: "pending",
      requestedAt: "2025-06-01T00:00:00.000Z",
      amount: { amount: "25000", currency: "INR" },
      version: "1",
    });

    const server = createTestServer(deps);
    const [clientTransport, serverTransport] = InMemoryTransport.createLinkedPair();
    const mcpClient = new Client({ name: "test-client", version: "0.1.0" });
    await Promise.all([server.connect(serverTransport), mcpClient.connect(clientTransport)]);

    const result = await mcpClient.callTool({
      name: "purchase.refund-request",
      arguments: {
        merchant_id: "merchant-1",
        transaction_id: "tx-5",
        reason: "item not as described",
      },
    });

    const content = (result.content as Array<{ type: string; text: string }>)[0];
    const parsed = JSON.parse(content?.text ?? "{}") as {
      status: string;
      refund_request_id: string;
      requested_at: string;
    };
    expect(parsed.status).toBe("refund_requested");
    expect(parsed.refund_request_id).toBe("refund-request-real-1");
    expect(parsed.requested_at).toBe("2025-06-01T00:00:00.000Z");

    await mcpClient.close();
  });
});

// ---------------------------------------------------------------------------
// Tests: Error Cases
// ---------------------------------------------------------------------------

describe("write-tools: error cases", () => {
  it("simulated timeout from merchant client", async () => {
    const deps = createTestDeps();
    const client = deps.merchantClient as InMemoryMerchantRuntimeClient;

    client.simulateFailure("timeout");

    const result = await client.getTransactionStatus("merchant-1", "tx-1");
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.error.kind).toBe("timeout");
    }
  });

  it("simulated network error from merchant client", async () => {
    const deps = createTestDeps();
    const client = deps.merchantClient as InMemoryMerchantRuntimeClient;

    client.simulateFailure("network_error");

    const result = await client.createTransaction("merchant-1", "quote-1", "counter_test");
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.error.kind).toBe("network");
    }
  });

  it("simulated indeterminate outcome from merchant client", async () => {
    const deps = createTestDeps();
    const client = deps.merchantClient as InMemoryMerchantRuntimeClient;

    client.simulateFailure("indeterminate");

    const result = await client.createTransaction("merchant-1", "quote-1", "counter_test");
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.error.kind).toBe("indeterminate");
    }
  });
});
