import { describe, expect, it } from "vitest";
import {
  APP_NAME,
  isDeniedTool,
  DENIED_TOOL_PATTERNS,
  createMcpServer,
  registerReadTools,
} from "./index.js";

describe("@counter/local-mcp", () => {
  it("exposes its app identity", () => {
    expect(APP_NAME).toBe("@counter/local-mcp");
  });
});

describe("Tool Denylist", () => {
  it("defines denied tool patterns", () => {
    expect(DENIED_TOOL_PATTERNS.length).toBeGreaterThan(0);
    expect(DENIED_TOOL_PATTERNS).toContain("policy.mutate");
    expect(DENIED_TOOL_PATTERNS).toContain("key.export");
    expect(DENIED_TOOL_PATTERNS).toContain("payment-secret.read");
  });

  it("isDeniedTool returns true for denied tools", () => {
    expect(isDeniedTool("policy.mutate")).toBe(true);
    expect(isDeniedTool("key.export")).toBe(true);
    expect(isDeniedTool("key.rotate")).toBe(true);
    expect(isDeniedTool("payment-secret.read")).toBe(true);
    expect(isDeniedTool("payment-secret.write")).toBe(true);
  });

  it("isDeniedTool returns false for allowed tools", () => {
    expect(isDeniedTool("wallet.status")).toBe(false);
    expect(isDeniedTool("wallet.list")).toBe(false);
    expect(isDeniedTool("transaction.view")).toBe(false);
  });

  it("includes key.derive in denied patterns", () => {
    expect(isDeniedTool("key.derive")).toBe(true);
  });

  it("includes policy.override in denied patterns", () => {
    expect(isDeniedTool("policy.override")).toBe(true);
  });

  it("includes approval.grant and approval.override in denied patterns", () => {
    expect(isDeniedTool("approval.grant")).toBe(true);
    expect(isDeniedTool("approval.override")).toBe(true);
  });

  it("includes recovery.initiate and recovery.complete in denied patterns", () => {
    expect(isDeniedTool("recovery.initiate")).toBe(true);
    expect(isDeniedTool("recovery.complete")).toBe(true);
  });

  it("includes settlement.assert and settlement.override in denied patterns", () => {
    expect(isDeniedTool("settlement.assert")).toBe(true);
    expect(isDeniedTool("settlement.override")).toBe(true);
  });

  it("contains exactly 13 denied patterns", () => {
    expect(DENIED_TOOL_PATTERNS).toHaveLength(13);
  });

  it("all required denied patterns are present", () => {
    const requiredPatterns = [
      "key.export",
      "key.rotate",
      "key.derive",
      "policy.mutate",
      "policy.override",
      "approval.grant",
      "approval.override",
      "recovery.initiate",
      "recovery.complete",
      "settlement.assert",
      "settlement.override",
      "payment-secret.read",
      "payment-secret.write",
    ];
    for (const pattern of requiredPatterns) {
      expect(DENIED_TOOL_PATTERNS).toContain(pattern);
    }
  });
});

describe("MCP Server", () => {
  it("createMcpServer returns a configured server", () => {
    const server = createMcpServer();
    expect(server).toBeDefined();
  });

  it("registerReadTools is exported for testing", () => {
    expect(typeof registerReadTools).toBe("function");
  });
});
