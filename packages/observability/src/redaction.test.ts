import { describe, expect, it } from "vitest";
import { isSensitiveKey, redactObject, redactValue, REDACTED } from "./redaction.js";

describe("redaction", () => {
  describe("isSensitiveKey", () => {
    it("detects password keys", () => {
      expect(isSensitiveKey("password")).toBe(true);
      expect(isSensitiveKey("userPassword")).toBe(true);
      expect(isSensitiveKey("PASSWORD")).toBe(true);
    });

    it("detects token keys", () => {
      expect(isSensitiveKey("token")).toBe(true);
      expect(isSensitiveKey("accessToken")).toBe(true);
      expect(isSensitiveKey("refresh_token")).toBe(true);
    });

    it("detects API key variations", () => {
      expect(isSensitiveKey("apiKey")).toBe(true);
      expect(isSensitiveKey("api_key")).toBe(true);
      expect(isSensitiveKey("api-key")).toBe(true);
    });

    it("detects authorization headers", () => {
      expect(isSensitiveKey("authorization")).toBe(true);
      expect(isSensitiveKey("Authorization")).toBe(true);
    });

    it("detects credential keys", () => {
      expect(isSensitiveKey("credential")).toBe(true);
      expect(isSensitiveKey("private_key")).toBe(true);
      expect(isSensitiveKey("privateKey")).toBe(true);
    });

    it("does not flag safe keys", () => {
      expect(isSensitiveKey("correlationId")).toBe(false);
      expect(isSensitiveKey("environment")).toBe(false);
      expect(isSensitiveKey("name")).toBe(false);
      expect(isSensitiveKey("status")).toBe(false);
    });
  });

  describe("redactValue", () => {
    it("redacts values of sensitive keys", () => {
      expect(redactValue("password", "super-secret")).toBe(REDACTED);
      expect(redactValue("apiKey", "sk_live_abc123")).toBe(REDACTED);
      expect(redactValue("authorization", "Bearer token123")).toBe(REDACTED);
    });

    it("masks credit card numbers in values", () => {
      const result = redactValue("data", "card is 4111-1111-1111-1111 here");
      expect(result).toBe("card is [REDACTED_CARD] here");
    });

    it("masks credit card numbers without separators", () => {
      const result = redactValue("info", "card 4111111111111111 end");
      expect(result).toBe("card [REDACTED_CARD] end");
    });

    it("masks email addresses in values", () => {
      const result = redactValue("message", "contact user@example.com for help");
      expect(result).toBe("contact [REDACTED_EMAIL] for help");
    });

    it("masks Bearer tokens in values", () => {
      const result = redactValue("header", "Bearer eyJhbGciOiJIUzI1NiJ9.test");
      expect(result).toBe("Bearer [REDACTED]");
    });

    it("masks Basic auth in values", () => {
      const result = redactValue("header", "Basic dXNlcjpwYXNz");
      expect(result).toBe("Basic [REDACTED]");
    });

    it("passes through safe IDs unchanged", () => {
      const correlationId = "ctr_correlation_AAAAAAAAAAAAAAAAAAAAAA";
      expect(redactValue("correlationId", correlationId)).toBe(correlationId);
    });

    it("passes through numbers unchanged", () => {
      expect(redactValue("count", 42)).toBe(42);
    });

    it("passes through booleans unchanged", () => {
      expect(redactValue("active", true)).toBe(true);
    });

    it("handles null and undefined safely", () => {
      expect(redactValue("field", null)).toBeNull();
      expect(redactValue("field", undefined)).toBeUndefined();
    });
  });

  describe("redactObject", () => {
    it("redacts sensitive keys in flat objects", () => {
      const input = {
        name: "test",
        password: "secret123",
        apiKey: "key-abc",
      };
      const result = redactObject(input) as Record<string, unknown>;
      expect(result["name"]).toBe("test");
      expect(result["password"]).toBe(REDACTED);
      expect(result["apiKey"]).toBe(REDACTED);
    });

    it("redacts nested objects recursively", () => {
      const input = {
        user: {
          name: "Alice",
          auth_data: {
            password: "secret",
            token: "tok_123",
          },
        },
      };
      const result = redactObject(input) as Record<string, Record<string, unknown>>;
      const user = result["user"] as Record<string, unknown>;
      expect(user["name"]).toBe("Alice");
      const authData = user["auth_data"] as Record<string, unknown>;
      expect(authData["password"]).toBe(REDACTED);
      expect(authData["token"]).toBe(REDACTED);
    });

    it("redacts value patterns in nested string values", () => {
      const input = {
        details: {
          info: "Payment card 4111111111111111 processed",
        },
      };
      const result = redactObject(input) as Record<string, Record<string, unknown>>;
      const details = result["details"] as Record<string, unknown>;
      expect(details["info"]).toBe("Payment card [REDACTED_CARD] processed");
    });

    it("handles arrays", () => {
      const input = [{ password: "secret", name: "test" }, { email: "user@example.com" }];
      const result = redactObject(input) as Array<Record<string, unknown>>;
      expect(result[0]!["password"]).toBe(REDACTED);
      expect(result[0]!["name"]).toBe("test");
      // "email" is not a sensitive key name, but the value contains an email pattern
      expect(result[1]!["email"]).toBe("[REDACTED_EMAIL]");
    });

    it("handles null and undefined safely", () => {
      expect(redactObject(null)).toBeNull();
      expect(redactObject(undefined)).toBeUndefined();
    });

    it("handles primitive values", () => {
      expect(redactObject(42)).toBe(42);
      expect(redactObject(true)).toBe(true);
      expect(redactObject("hello")).toBe("hello");
    });

    it("redacts emails in top-level strings", () => {
      expect(redactObject("email is test@example.com here")).toBe("email is [REDACTED_EMAIL] here");
    });
  });
});
