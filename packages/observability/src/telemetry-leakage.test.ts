import { describe, expect, it } from "vitest";
import { isSensitiveKey, redactObject, redactValue, REDACTED } from "./redaction.js";

describe("Telemetry leakage - secret/PII redaction", () => {
  describe("sensitive key detection", () => {
    const sensitiveKeys = [
      "password",
      "Password",
      "USER_PASSWORD",
      "secret",
      "client_secret",
      "token",
      "access_token",
      "refresh_token",
      "api_key",
      "apiKey",
      "API-KEY",
      "authorization",
      "Authorization",
      "auth_header",
      "auth-header",
      "credential",
      "credentials",
      "private_key",
      "private-key",
      "access_key",
      "access-key",
      "session_id",
      "sessionId",
      "cookie",
      "Cookie",
      "bearer",
      "Bearer",
      "ssn",
      "SSN",
      "social_security",
      "social-security",
      "card_number",
      "card-number",
      "cvv",
      "CVV",
      "cvc",
      "CVC",
      "pin",
      "PIN",
    ];

    for (const key of sensitiveKeys) {
      it(`detects "${key}" as sensitive`, () => {
        expect(isSensitiveKey(key)).toBe(true);
      });
    }
  });

  describe("value pattern redaction", () => {
    it("redacts credit card numbers (spaces)", () => {
      const result = redactValue("note", "Card: 4111 1111 1111 1111");
      expect(result).not.toContain("4111");
      expect(result).toContain("[REDACTED_CARD]");
    });

    it("redacts credit card numbers (dashes)", () => {
      const result = redactValue("note", "Card: 4111-1111-1111-1111");
      expect(result).not.toContain("4111");
    });

    it("redacts credit card numbers (no separators)", () => {
      const result = redactValue("note", "Card: 4111111111111111");
      expect(result).not.toContain("4111111111111111");
    });

    it("redacts email addresses", () => {
      const result = redactValue("note", "Contact: user@example.com");
      expect(result).not.toContain("user@example.com");
      expect(result).toContain("[REDACTED_EMAIL]");
    });

    it("redacts phone numbers with leading +", () => {
      const result = redactValue("note", "Call: +1-555-123-4567");
      expect(result).toContain("[REDACTED_PHONE]");
    });

    it("redacts phone numbers with parenthesized area code", () => {
      const result = redactValue("note", "Call: (555) 123-4567");
      expect(result).toContain("[REDACTED_PHONE]");
    });

    it("does not redact plain 7-digit numeric IDs", () => {
      const result = redactValue("note", "Transaction ID: 1234567");
      expect(result).not.toContain("[REDACTED_PHONE]");
    });

    it("redacts Bearer tokens", () => {
      const result = redactValue("header", "Bearer eyJhbGciOiJIUzI1NiJ9.payload.sig");
      expect(result).not.toContain("eyJhbGciOiJIUzI1NiJ9");
      expect(result).toContain("Bearer [REDACTED]");
    });

    it("redacts Basic auth headers", () => {
      const result = redactValue("header", "Basic dXNlcjpwYXNzd29yZA==");
      expect(result).not.toContain("dXNlcjpwYXNzd29yZA==");
      expect(result).toContain("Basic [REDACTED]");
    });
  });

  describe("key-based redaction takes precedence", () => {
    it("redacts any value for sensitive keys", () => {
      expect(redactValue("password", "my-secret-value")).toBe(REDACTED);
      expect(redactValue("api_key", "sk_live_1234")).toBe(REDACTED);
      expect(redactValue("token", "abc123")).toBe(REDACTED);
    });
  });

  describe("deep object redaction", () => {
    it("redacts nested objects with sensitive keys", () => {
      const input = {
        user: {
          name: "Alice",
          password: "hunter2",
          email: "alice@example.com",
        },
      };
      const result = redactObject(input) as Record<string, Record<string, unknown>>;
      expect(result["user"]!["password"]).toBe(REDACTED);
      expect(result["user"]!["email"]).toContain("[REDACTED_EMAIL]");
      expect(result["user"]!["name"]).toBe("Alice");
    });

    it("redacts arrays with sensitive content", () => {
      const input = ["Contact: user@example.com", "Safe text"];
      const result = redactObject(input) as string[];
      expect(result[0]).toContain("[REDACTED_EMAIL]");
      expect(result[1]).toBe("Safe text");
    });

    it("never mutates the input", () => {
      const input = Object.freeze({ password: "secret", data: "clean" });
      const result = redactObject(input) as Record<string, unknown>;
      expect(result["password"]).toBe(REDACTED);
      expect(input.password).toBe("secret");
    });
  });

  describe("safe attribute helpers emit no credentials", () => {
    it("null and undefined pass through unchanged", () => {
      expect(redactValue("anything", null)).toBeNull();
      expect(redactValue("anything", undefined)).toBeUndefined();
    });

    it("non-string non-sensitive values pass through", () => {
      expect(redactValue("count", 42)).toBe(42);
      expect(redactValue("enabled", true)).toBe(true);
    });

    it("safe strings without patterns pass through", () => {
      expect(redactValue("message", "Hello world")).toBe("Hello world");
    });
  });
});
