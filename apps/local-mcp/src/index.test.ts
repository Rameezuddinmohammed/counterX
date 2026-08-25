import { describe, expect, it } from "vitest";
import { APP_NAME, isDeniedTool, DENIED_TOOL_PATTERNS, createMcpServer, registerReadTools } from "./index.js";

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
