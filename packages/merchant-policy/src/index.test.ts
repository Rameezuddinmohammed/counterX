import { describe, expect, it } from "vitest";
import {
  PACKAGE_NAME,
} from "./index.js";
import type {
  MerchantPolicyConfig,
  MerchantPolicyCompiler,
  MerchantPolicyRule,
  CompiledPolicyResult,
  PolicyValidationResult,
} from "./index.js";

describe("@counter/merchant-policy", () => {
  it("exposes its package identity", () => {
    expect(PACKAGE_NAME).toBe("@counter/merchant-policy");
  });

  it("MerchantPolicyConfig type is structurally correct", () => {
    const config: MerchantPolicyConfig = {
      merchantId: "m-1",
      policyVersion: "1.0.0",
      rules: [],
      effectiveFrom: "2024-01-01T00:00:00Z",
      effectiveUntil: null,
    };
    expect(config.merchantId).toBe("m-1");
  });

  it("MerchantPolicyRule type is structurally correct", () => {
    const rule: MerchantPolicyRule = {
      ruleId: "rule-1",
      category: "pricing",
      constraint: "max_discount_percent",
      parameters: { maxPercent: 50 },
      enabled: true,
    };
    expect(rule.ruleId).toBe("rule-1");
  });

  it("MerchantPolicyCompiler interface is implementable", () => {
    const compiler: MerchantPolicyCompiler = {
      compile(_config: MerchantPolicyConfig): CompiledPolicyResult {
        return { success: true, constraintCount: 0, compiledAt: "2024-01-01T00:00:00Z" };
      },
      validate(_config: MerchantPolicyConfig): PolicyValidationResult {
        return { valid: true, errors: [] };
      },
    };
    const result = compiler.compile({
      merchantId: "m-1",
      policyVersion: "1.0.0",
      rules: [],
      effectiveFrom: "2024-01-01T00:00:00Z",
      effectiveUntil: null,
    });
    expect(result.success).toBe(true);
  });

  it("CompiledPolicyResult type is structurally correct", () => {
    const result: CompiledPolicyResult = {
      success: true,
      constraintCount: 5,
      compiledAt: "2024-01-01T00:00:00Z",
    };
    expect(result.constraintCount).toBe(5);
  });

  it("PolicyValidationResult type is structurally correct", () => {
    const result: PolicyValidationResult = {
      valid: false,
      errors: ["Invalid rule category"],
    };
    expect(result.valid).toBe(false);
    expect(result.errors).toHaveLength(1);
  });
});
