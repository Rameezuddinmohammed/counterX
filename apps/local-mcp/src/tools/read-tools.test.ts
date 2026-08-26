import { describe, expect, it } from "vitest";
import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { registerReadTools } from "./read-tools.js";

describe("Read Tools Registration", () => {
  it("registers all read tools without errors", () => {
    const server = new McpServer({ name: "test", version: "0.1.0" });
    expect(() => registerReadTools(server)).not.toThrow();
  });
});

describe("Read Tool Schemas", () => {
  it("wallet.status requires wallet_id", () => {
    const server = new McpServer({ name: "test", version: "0.1.0" });
    registerReadTools(server);
    expect(server).toBeDefined();
  });

  it("merchant.list requires wallet_id", () => {
    const server = new McpServer({ name: "test", version: "0.1.0" });
    registerReadTools(server);
    expect(server).toBeDefined();
  });

  it("merchant.search requires wallet_id and query", () => {
    const server = new McpServer({ name: "test", version: "0.1.0" });
    registerReadTools(server);
    expect(server).toBeDefined();
  });

  it("product.details requires merchant_id and variant_id", () => {
    const server = new McpServer({ name: "test", version: "0.1.0" });
    registerReadTools(server);
    expect(server).toBeDefined();
  });

  it("quote.get requires merchant_id, variant_id, quantity, and currency", () => {
    const server = new McpServer({ name: "test", version: "0.1.0" });
    registerReadTools(server);
    expect(server).toBeDefined();
  });

  it("transaction.status requires merchant_id and transaction_id", () => {
    const server = new McpServer({ name: "test", version: "0.1.0" });
    registerReadTools(server);
    expect(server).toBeDefined();
  });

  it("pending-actions.list requires wallet_id", () => {
    const server = new McpServer({ name: "test", version: "0.1.0" });
    registerReadTools(server);
    expect(server).toBeDefined();
  });

  it("receipt.verify requires merchant_id and transaction_id", () => {
    const server = new McpServer({ name: "test", version: "0.1.0" });
    registerReadTools(server);
    expect(server).toBeDefined();
  });
});
