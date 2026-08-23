import { describe, expect, it } from "vitest";
import type { IsoCurrencyCode, MerchantId, WalletId, AgentId, Instant } from "@counter/domain";
import { CryptoIdGenerator } from "@counter/domain";
import { createTestSignerA, TEST_KID_A } from "@counter/trust-protocol";

import { CounterTestPaymentProvider } from "./test-provider.js";
import {
  createCounterTestAuthorization,
  isTestEnvironment,
  assertTestEnvironment,
  rejectTestAuthorizationInLive,
} from "./test-authorization.js";
import { assertNoRawCredentials, FORBIDDEN_CREDENTIAL_FIELDS } from "./authorization.js";
import { runProviderContractSuite } from "./contract-harness.js";
import type { ProviderContext } from "./types.js";

// ─── Shared Setup ────────────────────────────────────────────────────────────

const idGen = new CryptoIdGenerator();
const fixedClock = () => 1705312800000;

function createTestContext(): ProviderContext {
  return Object.freeze({
    environment: "test" as const,
    walletId: idGen.generate("wallet") as WalletId,
    agentId: idGen.generate("agent") as AgentId,
    merchantId: idGen.generate("merchant") as MerchantId,
  });
}

// ─── Contract Suite ──────────────────────────────────────────────────────────

describe("PaymentProvider contract - CounterTestPaymentProvider", () => {
  const signer = createTestSignerA();
  const provider = new CounterTestPaymentProvider({
    environment: "test",
    signer,
    kid: TEST_KID_A,
    clock: fixedClock,
  });
  const context = createTestContext();
  const options = { signer, kid: TEST_KID_A, clock: fixedClock };

  it("all contract scenarios pass", async () => {
    const results = await runProviderContractSuite(provider, context, options);

    const failures = results.filter((r) => !r.passed);
    if (failures.length > 0) {
      const details = failures.map((f) => `  ${f.scenarioName}: ${f.details}`).join("\n");
      expect.fail(`Contract scenarios failed:\n${details}`);
    }

    expect(results.length).toBe(10);
    for (const result of results) {
      expect(result.passed).toBe(true);
    }
  });
});

// ─── CounterTestAuthorization ────────────────────────────────────────────────

describe("CounterTestAuthorization", () => {
  const context = createTestContext();

  it("creates authorization with testOnly=true", () => {
    const auth = createCounterTestAuthorization({
      walletId: context.walletId,
      agentId: context.agentId,
      merchantId: context.merchantId,
      amountCeiling: 100000n,
      currency: "INR" as IsoCurrencyCode,
    });

    expect(auth.testOnly).toBe(true);
    expect(auth.environment).toBe("test");
    expect(auth.adapter).toBe("counter-test");
  });

  it("rejects live environments via assertTestEnvironment", () => {
    expect(() => assertTestEnvironment("production")).toThrow();
    try {
      assertTestEnvironment("production");
    } catch (error: unknown) {
      const e = error as { code?: string };
      expect(e.code).toBe("ENVIRONMENT_MISMATCH");
    }
  });

  it("accepts test environments", () => {
    expect(() => assertTestEnvironment("test")).not.toThrow();
    expect(() => assertTestEnvironment("local")).not.toThrow();
  });

  it("rejectTestAuthorizationInLive throws for production", () => {
    const auth = createCounterTestAuthorization({
      walletId: context.walletId,
      agentId: context.agentId,
      merchantId: context.merchantId,
      amountCeiling: 100000n,
      currency: "INR" as IsoCurrencyCode,
    });

    expect(() => rejectTestAuthorizationInLive(auth, "production")).toThrow();
  });

  it("rejectTestAuthorizationInLive throws for pilot", () => {
    const auth = createCounterTestAuthorization({
      walletId: context.walletId,
      agentId: context.agentId,
      merchantId: context.merchantId,
      amountCeiling: 100000n,
      currency: "INR" as IsoCurrencyCode,
    });

    expect(() => rejectTestAuthorizationInLive(auth, "pilot")).toThrow();
  });

  it("rejectTestAuthorizationInLive throws for sandbox", () => {
    const auth = createCounterTestAuthorization({
      walletId: context.walletId,
      agentId: context.agentId,
      merchantId: context.merchantId,
      amountCeiling: 100000n,
      currency: "INR" as IsoCurrencyCode,
    });

    expect(() => rejectTestAuthorizationInLive(auth, "sandbox")).toThrow();
  });

  it("rejectTestAuthorizationInLive allows test env", () => {
    const auth = createCounterTestAuthorization({
      walletId: context.walletId,
      agentId: context.agentId,
      merchantId: context.merchantId,
      amountCeiling: 100000n,
      currency: "INR" as IsoCurrencyCode,
    });

    expect(() => rejectTestAuthorizationInLive(auth, "test")).not.toThrow();
  });

  it("isTestEnvironment returns correct values", () => {
    expect(isTestEnvironment("local")).toBe(true);
    expect(isTestEnvironment("test")).toBe(true);
    expect(isTestEnvironment("sandbox")).toBe(false);
    expect(isTestEnvironment("pilot")).toBe(false);
    expect(isTestEnvironment("production")).toBe(false);
  });
});

// ─── Environment Enforcement ─────────────────────────────────────────────────

describe("CounterTestPaymentProvider environment enforcement", () => {
  const signer = createTestSignerA();

  it("rejects production environment in constructor", () => {
    expect(
      () =>
        new CounterTestPaymentProvider({
          environment: "production" as "local" | "test",
          signer,
          kid: TEST_KID_A,
        }),
    ).toThrow();
  });

  it("rejects pilot environment in constructor", () => {
    expect(
      () =>
        new CounterTestPaymentProvider({
          environment: "pilot" as "local" | "test",
          signer,
          kid: TEST_KID_A,
        }),
    ).toThrow();
  });

  it("rejects sandbox environment in constructor", () => {
    expect(
      () =>
        new CounterTestPaymentProvider({
          environment: "sandbox" as "local" | "test",
          signer,
          kid: TEST_KID_A,
        }),
    ).toThrow();
  });

  it("accepts test environment", () => {
    expect(
      () =>
        new CounterTestPaymentProvider({
          environment: "test",
          signer,
          kid: TEST_KID_A,
        }),
    ).not.toThrow();
  });

  it("accepts local environment", () => {
    expect(
      () =>
        new CounterTestPaymentProvider({
          environment: "local",
          signer,
          kid: TEST_KID_A,
        }),
    ).not.toThrow();
  });
});

// ─── No Raw Credentials ──────────────────────────────────────────────────────

describe("No raw credentials", () => {
  const context = createTestContext();

  it("PaymentAuthorization has no forbidden credential fields", () => {
    const auth = createCounterTestAuthorization({
      walletId: context.walletId,
      agentId: context.agentId,
      merchantId: context.merchantId,
      amountCeiling: 100000n,
      currency: "INR" as IsoCurrencyCode,
    });

    expect(() => assertNoRawCredentials(auth)).not.toThrow();
  });

  it("assertNoRawCredentials detects pan field", () => {
    const obj = { pan: "4111111111111111" };
    expect(() => assertNoRawCredentials(obj)).toThrow();
  });

  it("assertNoRawCredentials detects nested forbidden fields", () => {
    const obj = { details: { cvv: "123" } };
    expect(() => assertNoRawCredentials(obj)).toThrow();
  });

  it("assertNoRawCredentials detects in arrays", () => {
    const obj = [{ token: "x" }];
    expect(() => assertNoRawCredentials(obj)).toThrow();
  });

  it("CounterTestPaymentProvider evidence contains no credentials", async () => {
    const signer = createTestSignerA();
    const provider = new CounterTestPaymentProvider({
      environment: "test",
      signer,
      kid: TEST_KID_A,
      clock: fixedClock,
    });

    const result = await provider.createInstruction({
      authorizationRef: "cred-test-auth",
      amount: { amountMinor: 10000n, currency: "INR" as IsoCurrencyCode },
      currency: "INR" as IsoCurrencyCode,
      merchantId: context.merchantId,
      idempotencyKey: "cred-test-success-key",
    });

    expect(result.kind).toBe("confirmed");
    if (result.kind === "confirmed") {
      expect(() => assertNoRawCredentials(result.evidence)).not.toThrow();
    }
  });

  it("FORBIDDEN_CREDENTIAL_FIELDS contains expected fields", () => {
    const expected = [
      "pan",
      "cvv",
      "pin",
      "password",
      "secret",
      "token",
      "upi_pin",
      "bank_credential",
      "raw_token",
    ];
    for (const field of expected) {
      expect(FORBIDDEN_CREDENTIAL_FIELDS).toContain(field);
    }
  });
});

// ─── verifyClientReturn Semantics ────────────────────────────────────────────

describe("verifyClientReturn semantics", () => {
  const signer = createTestSignerA();
  const provider = new CounterTestPaymentProvider({
    environment: "test",
    signer,
    kid: TEST_KID_A,
    clock: fixedClock,
  });
  const context = createTestContext();

  it("browser return is untrusted by default", async () => {
    const result = await provider.verifyClientReturn({
      queryParams: { ref: "unknown-reference" },
      returnedAt: fixedClock() as unknown as Instant,
    });

    expect(result.kind).toBe("untrusted");
  });

  it("browser return can be verified with known evidence", async () => {
    // Create a successful payment first
    const payResult = await provider.createInstruction({
      authorizationRef: "verify-return-auth",
      amount: { amountMinor: 10000n, currency: "INR" as IsoCurrencyCode },
      currency: "INR" as IsoCurrencyCode,
      merchantId: context.merchantId,
      idempotencyKey: "verify-return-key",
    });

    expect(payResult.kind).toBe("confirmed");
    if (payResult.kind !== "confirmed") return;

    const reference = payResult.evidence.reference;
    const result = await provider.verifyClientReturn({
      queryParams: { ref: reference },
      returnedAt: fixedClock() as unknown as Instant,
    });

    expect(result.kind).toBe("verified");
    if (result.kind === "verified") {
      expect(result.evidence).toBeDefined();
    }
  });

  /**
   * Even when "verified", the browser return is correlation evidence only.
   * The provider query is the authoritative source for payment truth.
   */
  it("verified return includes correlation evidence only - requires provider query for truth", async () => {
    const payResult = await provider.createInstruction({
      authorizationRef: "verify-return-auth-2",
      amount: { amountMinor: 5000n, currency: "INR" as IsoCurrencyCode },
      currency: "INR" as IsoCurrencyCode,
      merchantId: context.merchantId,
      idempotencyKey: "verify-return-correlation-key",
    });

    expect(payResult.kind).toBe("confirmed");
    if (payResult.kind !== "confirmed") return;

    const reference = payResult.evidence.reference;
    const clientReturn = await provider.verifyClientReturn({
      queryParams: { ref: reference },
      returnedAt: fixedClock() as unknown as Instant,
    });

    // Even when verified, correlationId is present - this is correlation only
    expect(clientReturn.correlationId).toBeDefined();
    expect(typeof clientReturn.correlationId).toBe("string");
  });
});
