import { describe, expect, expectTypeOf, it } from "vitest";
import fc from "fast-check";
import {
  CANONICAL_ERROR_CODES,
  COUNTER_ENVIRONMENTS,
  canonicalErrorToJson,
  createCanonicalError,
  createCounterId,
  createIndeterminate,
  createReviewRequired,
  environmentsEqual,
  err,
  flatMapResult,
  mapResult,
  merchantScope,
  ok,
  parseEnvironment,
  parseSha256Digest,
  platformScope,
  scopeKey,
  scopesEqual,
  sha256Digest,
  sha256DigestsEqual,
  walletScope,
  type CanonicalErrorInput,
  type MerchantUserId,
  type Result,
  type WalletUserId,
} from "./index.js";

const encoder = new TextEncoder();

function unwrap<Value>(result: Result<Value>): Value {
  if (!result.ok) {
    throw new Error(`${result.error.code}: ${result.error.message}`);
  }
  return result.value;
}

describe("environment and scope primitives", () => {
  it("round-trips the exhaustive environment vocabulary", () => {
    fc.assert(
      fc.property(fc.constantFrom(...COUNTER_ENVIRONMENTS), (environment) => {
        expect(unwrap(parseEnvironment(environment))).toBe(environment);
        expect(environmentsEqual(environment, environment)).toBe(true);
      }),
    );
  });

  it("keeps merchant, Wallet, platform, and environment scopes distinct", () => {
    const merchantId = unwrap(createCounterId("merchant", new Uint8Array(16).fill(1)));
    const walletId = unwrap(createCounterId("wallet", new Uint8Array(16).fill(2)));
    const merchantPilot = merchantScope("pilot", merchantId);
    const merchantSandbox = merchantScope("sandbox", merchantId);
    const walletPilot = walletScope("pilot", walletId);

    expect(scopesEqual(merchantPilot, merchantPilot)).toBe(true);
    expect(scopesEqual(merchantPilot, merchantSandbox)).toBe(false);
    expect(scopesEqual(merchantPilot, walletPilot)).toBe(false);
    expect(scopeKey(platformScope("pilot"))).toBe("pilot:platform");
  });

  it("nominally separates merchant and Wallet user principals", () => {
    expectTypeOf<MerchantUserId>().not.toEqualTypeOf<WalletUserId>();
  });
});

describe("SHA-256 digest primitive", () => {
  it("matches known vectors and uses an algorithm-tagged canonical encoding", () => {
    expect(sha256Digest(encoder.encode(""))).toBe(
      "sha256:e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855",
    );
    expect(sha256Digest(encoder.encode("abc"))).toBe(
      "sha256:ba7816bf8f01cfea414140de5dae2223b00361a396177a9cb410ff61f20015ad",
    );
  });

  it("round-trips arbitrary bytes and detects altered material", () => {
    fc.assert(
      fc.property(fc.uint8Array({ maxLength: 512 }), (bytes) => {
        const digest = sha256Digest(bytes);
        expect(unwrap(parseSha256Digest(digest))).toBe(digest);

        const altered = Uint8Array.from([...bytes, 0xff]);
        expect(sha256DigestsEqual(digest, sha256Digest(altered))).toBe(false);
      }),
    );
  });

  it.each([
    "SHA256:e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855",
    "sha256:E3B0C44298FC1C149AFBF4C8996FB92427AE41E4649B934CA495991B7852B855",
    "sha256:00",
    "e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855",
  ])("rejects malformed digest %s", (digest) => {
    expect(parseSha256Digest(digest).ok).toBe(false);
  });
});

describe("typed results and canonical errors", () => {
  it("maps success and composes heterogeneous failure types", () => {
    type FirstError = Readonly<{ kind: "first" }>;
    type SecondError = Readonly<{ kind: "second" }>;

    const mapped = mapResult(ok(2), (value) => value * 3);
    const flatMapped = flatMapResult(mapped, (value) => ok(value.toString(10)));
    expect(flatMapped).toEqual({ ok: true, value: "6" });

    const secondError = (): Result<string, SecondError> => err({ kind: "second" });
    const firstFailure: Result<number, FirstError> = err({ kind: "first" });
    const preserved = flatMapResult(firstFailure, secondError);
    expectTypeOf(preserved).toEqualTypeOf<Result<string, FirstError | SecondError>>();
    expect(preserved).toEqual({ ok: false, error: { kind: "first" } });

    const secondFailure = flatMapResult(
      ok(1) as Result<number, FirstError>,
      (): Result<string, SecondError> => err({ kind: "second" }),
    );
    expect(secondFailure).toEqual({ ok: false, error: { kind: "second" } });
  });

  it("derives a consistent category, message, and retry directive for every code", () => {
    for (const code of CANONICAL_ERROR_CODES) {
      const error = createCanonicalError(code);
      const json = canonicalErrorToJson(error);

      expect(json).toEqual(error);
      expect(json.message.length).toBeGreaterThan(0);
      expect(JSON.stringify(json)).not.toContain("undefined");
    }

    expect(createCanonicalError("RETRYABLE_FAILURE").retry).toBe("retry");
    expect(createCanonicalError("INDETERMINATE").retry).toBe("query_before_retry");
    expect(createCanonicalError("UNAUTHORIZED").category).toBe("authorization");

    const contradictory = { code: "OVERFLOW", category: "authorization" } as const;
    expectTypeOf(contradictory).not.toMatchTypeOf<CanonicalErrorInput>();
  });

  it("re-derives safe public errors instead of copying diagnostics", () => {
    const unsafeDiagnostic = "provider-secret-token unauthorized-resource-123";
    const forged = {
      code: "UNAUTHORIZED" as const,
      category: "internal",
      message: unsafeDiagnostic,
      retry: "retry",
      details: { token: unsafeDiagnostic, count: Number.POSITIVE_INFINITY },
      stack: unsafeDiagnostic,
      cause: unsafeDiagnostic,
    };
    const json = canonicalErrorToJson(forged);
    const serialized = JSON.stringify(json);

    expect(json).toEqual({
      kind: "canonical_error",
      category: "authorization",
      code: "UNAUTHORIZED",
      message: "The requested operation is not authorized",
      retry: "never",
    });
    expect(serialized).not.toContain(unsafeDiagnostic);
    expect(json).not.toHaveProperty("details");
    expect(json).not.toHaveProperty("stack");
    expect(json).not.toHaveProperty("cause");
  });

  it("models review-required and Indeterminate as structured states", () => {
    expect(createReviewRequired(["buyer.high_value"])).toEqual({
      kind: "review_required",
      code: "REVIEW_REQUIRED",
      message: "Review is required before the operation can continue",
      ruleIds: ["buyer.high_value"],
    });
    expect(createIndeterminate("payment:test:123")).toEqual({
      kind: "indeterminate",
      code: "INDETERMINATE",
      message: "The operation outcome is not yet authoritative",
      reference: "payment:test:123",
    });
  });
});
