import { describe, expect, it } from "vitest";
import { createTestBuyerIdentity } from "./identity.js";

describe("createTestBuyerIdentity", () => {
  it("creates a valid test buyer identity with all required fields", () => {
    const identity = createTestBuyerIdentity();

    expect(identity.walletId).toBeDefined();
    expect(identity.agentId).toBeDefined();
    expect(identity.merchantId).toBeDefined();
    expect(identity.signer).toBeDefined();
    expect(identity.kid).toBe("test-key-a-001");
  });

  it("produces deterministic IDs across invocations", () => {
    const identity1 = createTestBuyerIdentity();
    const identity2 = createTestBuyerIdentity();

    // Same seeded random source produces same IDs
    expect(identity1.walletId).toBe(identity2.walletId);
    expect(identity1.agentId).toBe(identity2.agentId);
    expect(identity1.merchantId).toBe(identity2.merchantId);
  });

  it("generates IDs with correct Counter ID format", () => {
    const identity = createTestBuyerIdentity();

    expect(identity.walletId).toMatch(/^ctr_wallet_[A-Za-z0-9_-]{22}$/);
    expect(identity.agentId).toMatch(/^ctr_agent_[A-Za-z0-9_-]{22}$/);
    expect(identity.merchantId).toMatch(/^ctr_merchant_[A-Za-z0-9_-]{22}$/);
  });

  it("returns a frozen object", () => {
    const identity = createTestBuyerIdentity();

    expect(Object.isFrozen(identity)).toBe(true);
  });

  it("provides a signer that can sign data", async () => {
    const identity = createTestBuyerIdentity();

    // The signer should have a sign method
    expect(typeof identity.signer.sign).toBe("function");
  });
});
