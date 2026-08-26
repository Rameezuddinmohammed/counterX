import { describe, expect, it } from "vitest";
import {
  PACKAGE_NAME,
  WALLET_ENDPOINTS,
  WALLET_ERROR_CODES,
  isWalletErrorCode,
} from "./index.js";
import type {
  CreateWalletRequest,
  CreateWalletResponse,
  WalletStatusRequest,
  WalletStatusResponse,
  WalletApiError,
} from "./index.js";
import type { CounterId } from "@counter/domain";

describe("@counter/wallet-contracts", () => {
  it("exposes its package identity", () => {
    expect(PACKAGE_NAME).toBe("@counter/wallet-contracts");
  });
});

describe("Wallet Endpoints", () => {
  it("defines all 7 wallet endpoints", () => {
    expect(WALLET_ENDPOINTS).toHaveLength(7);
    expect(WALLET_ENDPOINTS).toContain("wallet.create");
    expect(WALLET_ENDPOINTS).toContain("wallet.invite");
    expect(WALLET_ENDPOINTS).toContain("wallet.enroll");
    expect(WALLET_ENDPOINTS).toContain("wallet.verify");
    expect(WALLET_ENDPOINTS).toContain("wallet.status");
    expect(WALLET_ENDPOINTS).toContain("wallet.suspend");
    expect(WALLET_ENDPOINTS).toContain("wallet.close");
  });
});

describe("Wallet Error Codes", () => {
  it("defines expected error codes", () => {
    expect(WALLET_ERROR_CODES).toContain("WALLET_NOT_FOUND");
    expect(WALLET_ERROR_CODES).toContain("WALLET_ALREADY_EXISTS");
    expect(WALLET_ERROR_CODES).toContain("INVALID_STATE_TRANSITION");
    expect(WALLET_ERROR_CODES).toContain("INVITATION_EXPIRED");
    expect(WALLET_ERROR_CODES).toContain("UNAUTHORIZED");
  });

  it("isWalletErrorCode accepts valid codes", () => {
    expect(isWalletErrorCode("WALLET_NOT_FOUND")).toBe(true);
    expect(isWalletErrorCode("UNAUTHORIZED")).toBe(true);
  });

  it("isWalletErrorCode rejects invalid codes", () => {
    expect(isWalletErrorCode("UNKNOWN")).toBe(false);
    expect(isWalletErrorCode(42)).toBe(false);
    expect(isWalletErrorCode(null)).toBe(false);
  });
});

describe("Wallet Contract Types", () => {
  it("CreateWalletRequest is structurally valid", () => {
    const request: CreateWalletRequest = {
      principal_id: "ctr_actor_test" as CounterId<"actor">,
      display_name: "Test Wallet",
    };
    expect(request.principal_id).toBeDefined();
  });

  it("CreateWalletResponse is structurally valid", () => {
    const response: CreateWalletResponse = {
      wallet_id: "ctr_wallet_test" as CounterId<"wallet">,
      state: "INVITED",
      created_at: "2025-01-15T10:00:00.000Z",
    };
    expect(response.wallet_id).toBeDefined();
  });

  it("WalletStatusRequest and Response are structurally valid", () => {
    const request: WalletStatusRequest = {
      wallet_id: "ctr_wallet_test" as CounterId<"wallet">,
    };
    const response: WalletStatusResponse = {
      wallet_id: "ctr_wallet_test" as CounterId<"wallet">,
      principal_id: "ctr_actor_test" as CounterId<"actor">,
      state: "ACTIVE",
      created_at: "2025-01-15T10:00:00.000Z",
      updated_at: "2025-01-15T10:00:00.000Z",
    };
    expect(request.wallet_id).toBeDefined();
    expect(response.state).toBe("ACTIVE");
  });

  it("WalletApiError is structurally valid", () => {
    const error: WalletApiError = {
      code: "WALLET_NOT_FOUND",
      message: "The specified wallet does not exist",
      details: { wallet_id: "ctr_wallet_test" },
    };
    expect(error.code).toBe("WALLET_NOT_FOUND");
  });
});
