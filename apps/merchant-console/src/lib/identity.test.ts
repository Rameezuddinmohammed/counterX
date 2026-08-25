import { describe, expect, it } from "vitest";
import {
  APP_NAME,
  createMerchantIdentity,
  formatMerchantName,
  getEnvironmentLabel,
  getIdentitySummary,
  isValidEmail,
  isValidMerchantId,
  resolveEnvironment,
} from "./identity.js";

describe("@counter/merchant-console identity module", () => {
  describe("APP_NAME", () => {
    it("exposes the correct app identity", () => {
      expect(APP_NAME).toBe("@counter/merchant-console");
    });
  });

  describe("resolveEnvironment", () => {
    it("returns 'pilot' for undefined", () => {
      expect(resolveEnvironment(undefined)).toBe("pilot");
    });

    it("returns 'pilot' for null", () => {
      expect(resolveEnvironment(null)).toBe("pilot");
    });

    it("returns 'pilot' for empty string", () => {
      expect(resolveEnvironment("")).toBe("pilot");
    });

    it("returns 'pilot' for unknown value", () => {
      expect(resolveEnvironment("staging")).toBe("pilot");
    });

    it("returns 'production' only for explicit 'production'", () => {
      expect(resolveEnvironment("production")).toBe("production");
    });

    it("does not match partial 'prod'", () => {
      expect(resolveEnvironment("prod")).toBe("pilot");
    });
  });

  describe("isValidMerchantId", () => {
    it("accepts valid alphanumeric IDs", () => {
      expect(isValidMerchantId("merchant-pilot-001")).toBe(true);
    });

    it("accepts underscores", () => {
      expect(isValidMerchantId("merchant_test_123")).toBe(true);
    });

    it("rejects empty string", () => {
      expect(isValidMerchantId("")).toBe(false);
    });

    it("rejects spaces", () => {
      expect(isValidMerchantId("merchant 001")).toBe(false);
    });

    it("rejects special characters", () => {
      expect(isValidMerchantId("merchant@001")).toBe(false);
    });

    it("rejects IDs longer than 128 characters", () => {
      expect(isValidMerchantId("a".repeat(129))).toBe(false);
    });

    it("accepts IDs up to 128 characters", () => {
      expect(isValidMerchantId("a".repeat(128))).toBe(true);
    });
  });

  describe("isValidEmail", () => {
    it("accepts valid emails", () => {
      expect(isValidEmail("merchant@example.com")).toBe(true);
    });

    it("accepts emails with subdomains", () => {
      expect(isValidEmail("user@sub.domain.org")).toBe(true);
    });

    it("rejects empty string", () => {
      expect(isValidEmail("")).toBe(false);
    });

    it("rejects missing @", () => {
      expect(isValidEmail("merchantexample.com")).toBe(false);
    });

    it("rejects missing domain", () => {
      expect(isValidEmail("merchant@")).toBe(false);
    });

    it("rejects spaces", () => {
      expect(isValidEmail("user @example.com")).toBe(false);
    });
  });

  describe("formatMerchantName", () => {
    it("trims whitespace", () => {
      expect(formatMerchantName("  Acme Corp  ")).toBe("Acme Corp");
    });

    it("returns null for empty string", () => {
      expect(formatMerchantName("")).toBeNull();
    });

    it("returns null for whitespace-only", () => {
      expect(formatMerchantName("   ")).toBeNull();
    });

    it("returns null for names exceeding 256 characters", () => {
      expect(formatMerchantName("a".repeat(257))).toBeNull();
    });

    it("accepts names up to 256 characters", () => {
      const name = "a".repeat(256);
      expect(formatMerchantName(name)).toBe(name);
    });
  });

  describe("createMerchantIdentity", () => {
    it("creates a valid identity", () => {
      const identity = createMerchantIdentity(
        "merchant-001",
        "Acme Corp",
        "admin@acme.com",
        "pilot",
      );
      expect(identity).not.toBeNull();
      expect(identity!.merchantId).toBe("merchant-001");
      expect(identity!.merchantName).toBe("Acme Corp");
      expect(identity!.email).toBe("admin@acme.com");
      expect(identity!.environment).toBe("pilot");
    });

    it("returns null for invalid merchant ID", () => {
      const identity = createMerchantIdentity(
        "invalid id with spaces",
        "Acme Corp",
        "admin@acme.com",
        "pilot",
      );
      expect(identity).toBeNull();
    });

    it("returns null for invalid email", () => {
      const identity = createMerchantIdentity(
        "merchant-001",
        "Acme Corp",
        "not-an-email",
        "pilot",
      );
      expect(identity).toBeNull();
    });

    it("returns null for empty merchant name", () => {
      const identity = createMerchantIdentity(
        "merchant-001",
        "   ",
        "admin@acme.com",
        "pilot",
      );
      expect(identity).toBeNull();
    });

    it("uses pilot environment by default", () => {
      const identity = createMerchantIdentity(
        "merchant-001",
        "Acme Corp",
        "admin@acme.com",
        undefined,
      );
      expect(identity!.environment).toBe("pilot");
    });

    it("respects production environment", () => {
      const identity = createMerchantIdentity(
        "merchant-001",
        "Acme Corp",
        "admin@acme.com",
        "production",
      );
      expect(identity!.environment).toBe("production");
    });

    it("returns a frozen object", () => {
      const identity = createMerchantIdentity(
        "merchant-001",
        "Acme Corp",
        "admin@acme.com",
        "pilot",
      );
      expect(Object.isFrozen(identity)).toBe(true);
    });
  });

  describe("getEnvironmentLabel", () => {
    it("returns correct label for pilot", () => {
      expect(getEnvironmentLabel("pilot")).toBe("PILOT (Test Mode)");
    });

    it("returns correct label for production", () => {
      expect(getEnvironmentLabel("production")).toBe("PRODUCTION");
    });
  });

  describe("getIdentitySummary", () => {
    it("formats identity summary correctly", () => {
      const identity = createMerchantIdentity(
        "merchant-001",
        "Acme Corp",
        "admin@acme.com",
        "pilot",
      );
      const summary = getIdentitySummary(identity!);
      expect(summary).toBe("Acme Corp (merchant-001) - PILOT (Test Mode)");
    });
  });
});
