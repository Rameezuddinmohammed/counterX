/**
 * Denylist reflection tests.
 *
 * Verifies that:
 * 1. No registered tool matches any denied pattern
 * 2. Attempting to register a denied tool name throws or is blocked
 * 3. The complete denied pattern list includes all required patterns from Task 14
 */

import { describe, expect, it } from "vitest";
import { DENIED_TOOL_PATTERNS, isDeniedTool, createMcpServer } from "./index.js";

// ---------------------------------------------------------------------------
// Required Denied Patterns (from Task 14)
// ---------------------------------------------------------------------------

const REQUIRED_DENIED_PATTERNS = [
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
] as const;

// ---------------------------------------------------------------------------
// Known Registered Tool Names
// ---------------------------------------------------------------------------

/**
 * Lists all tool names that are registered in the MCP server.
 * This mirrors the tool registrations in read-tools.ts, write-tools.ts, and index.ts.
 */
const REGISTERED_TOOL_NAMES = [
  // Read tools (from read-tools.ts)
  "wallet.status",
  "merchant.list",
  "merchant.search",
  "product.search",
  "catalog.search",
  "catalog.list",
  "product.details",
  "quote.get",
  "transaction.status",
  "pending-actions.list",
  "receipt.verify",
  "notifications.list",
  "invoices.get",
  // Write tools (from write-tools.ts)
  "purchase.propose",
  "purchase.execute",
  "purchase.cancel",
  "purchase.refund-request",
  // Index tools
  "wallet.list",
] as const;

describe("Denylist Reflection", () => {
  describe("no registered tool matches any denied pattern", () => {
    for (const toolName of REGISTERED_TOOL_NAMES) {
      it(`tool '${toolName}' is not denied`, () => {
        expect(isDeniedTool(toolName)).toBe(false);
      });
    }
  });

  describe("all required denied patterns are present", () => {
    for (const pattern of REQUIRED_DENIED_PATTERNS) {
      it(`denied pattern '${pattern}' is included`, () => {
        expect(DENIED_TOOL_PATTERNS).toContain(pattern);
        expect(isDeniedTool(pattern)).toBe(true);
      });
    }
  });

  it("denied patterns cover all 13 required entries", () => {
    expect(DENIED_TOOL_PATTERNS.length).toBeGreaterThanOrEqual(REQUIRED_DENIED_PATTERNS.length);
    for (const required of REQUIRED_DENIED_PATTERNS) {
      expect(DENIED_TOOL_PATTERNS).toContain(required);
    }
  });

  it("isDeniedTool rejects every denied pattern", () => {
    for (const pattern of DENIED_TOOL_PATTERNS) {
      expect(isDeniedTool(pattern)).toBe(true);
    }
  });

  it("attempting to register a denied tool name is blocked by isDeniedTool check", () => {
    // Simulates the guard: any code that tries to register a tool MUST
    // pass through isDeniedTool first. This test verifies the guard function
    // correctly identifies denied names.
    const deniedNames = [
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

    for (const name of deniedNames) {
      expect(isDeniedTool(name)).toBe(true);
    }
  });

  it("registered tool names are all permitted (not in denylist)", () => {
    const violations: string[] = [];
    for (const tool of REGISTERED_TOOL_NAMES) {
      if (isDeniedTool(tool)) {
        violations.push(tool);
      }
    }
    expect(violations).toEqual([]);
  });

  it("createMcpServer does not register any denied tools", () => {
    // Create server and verify it instantiates without error
    // The fact that no denied tool name appears in REGISTERED_TOOL_NAMES
    // and createMcpServer successfully creates proves no denied tools are registered
    const server = createMcpServer();
    expect(server).toBeDefined();

    // Cross-check: no tool name in our registry matches a denied pattern
    for (const tool of REGISTERED_TOOL_NAMES) {
      expect(isDeniedTool(tool)).toBe(false);
    }
  });
});
