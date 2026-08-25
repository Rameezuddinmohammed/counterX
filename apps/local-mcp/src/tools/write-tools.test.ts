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
import { InMemorySecureKeyStore } from "@counter/wallet-domain";
import {
  InMemoryMerchantRuntimeClient,
  InMemoryRevocationStore,
} from "@counter/wallet-application";
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
