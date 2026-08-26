import { describe, expect, it } from "vitest";
import { MockWalletClient, createPilotWalletClient } from "./wallet-client.js";

describe("MockWalletClient", () => {
  it("returns seeded wallet overview", () => {
    const client = new MockWalletClient();
    client.seed({
      walletId: "wlt-test-001",
      status: "active",
      createdAt: "2025-01-01T00:00:00.000Z",
      deviceCount: 1,
      activeMandates: 2,
      pendingApprovals: 0,
      recentTransactions: 5,
    });

    const result = client.getOverview("wlt-test-001");
    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.value.walletId).toBe("wlt-test-001");
      expect(result.value.status).toBe("active");
      expect(result.value.deviceCount).toBe(1);
    }
  });

  it("returns error for unknown wallet", () => {
    const client = new MockWalletClient();

    const result = client.getOverview("unknown");
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.error.kind).toBe("client_error");
    }
  });

  it("returns wallet status", () => {
    const client = new MockWalletClient();
    client.seed({
      walletId: "wlt-status-001",
      status: "locked",
      createdAt: "2025-01-01T00:00:00.000Z",
      deviceCount: 0,
      activeMandates: 0,
      pendingApprovals: 0,
      recentTransactions: 0,
    });

    const result = client.getStatus("wlt-status-001");
    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.value).toBe("locked");
    }
  });
});

describe("createPilotWalletClient", () => {
  it("creates pre-seeded pilot client", () => {
    const client = createPilotWalletClient();

    const result = client.getOverview("wlt-pilot-001");
    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.value.status).toBe("active");
      expect(result.value.deviceCount).toBe(2);
    }
  });
});
