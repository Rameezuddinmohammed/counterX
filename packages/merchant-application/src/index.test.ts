import { describe, expect, it } from "vitest";
import {
  PACKAGE_NAME,
} from "./index.js";
import type {
  MerchantLifecycleState,
  MerchantProfile,
  ActivationRecord,
  MerchantEnvironment,
  ReadinessCheck,
  ReadinessFinding,
} from "./index.js";

describe("@counter/merchant-application", () => {
  it("exposes its package identity", () => {
    expect(PACKAGE_NAME).toBe("@counter/merchant-application");
  });

  it("MerchantLifecycleState type represents valid states", () => {
    const state: MerchantLifecycleState = "activated";
    expect(state).toBe("activated");
  });

  it("MerchantProfile type is structurally correct", () => {
    const profile: MerchantProfile = {
      merchantId: "m-1",
      displayName: "Test Store",
      legalName: "Test Store Inc.",
      contactEmail: "test@example.com",
      lifecycleState: "approved",
      createdAt: "2024-01-01T00:00:00Z",
      updatedAt: "2024-01-01T00:00:00Z",
    };
    expect(profile.merchantId).toBe("m-1");
  });

  it("ActivationRecord type is structurally correct", () => {
    const record: ActivationRecord = {
      merchantId: "m-1",
      activatedAt: "2024-01-01T00:00:00Z",
      activatedBy: "admin-1",
      environment: {
        mode: "test",
        region: "us-east-1",
        connectorIds: ["shopify-1"],
      },
    };
    expect(record.activatedBy).toBe("admin-1");
  });

  it("MerchantEnvironment type is structurally correct", () => {
    const env: MerchantEnvironment = {
      mode: "live",
      region: "eu-west-1",
      connectorIds: ["shopify-1", "razorpay-1"],
    };
    expect(env.mode).toBe("live");
  });

  it("ReadinessCheck type is structurally correct", () => {
    const check: ReadinessCheck = {
      checkId: "check-1",
      merchantId: "m-1",
      category: "payment",
      executedAt: "2024-01-01T00:00:00Z",
      findings: [],
      passed: true,
    };
    expect(check.passed).toBe(true);
  });

  it("ReadinessFinding type is structurally correct", () => {
    const finding: ReadinessFinding = {
      code: "MISSING_PAYMENT_CONFIG",
      severity: "error",
      message: "Payment provider not configured",
      remediation: "Configure at least one payment provider",
    };
    expect(finding.severity).toBe("error");
  });
});
