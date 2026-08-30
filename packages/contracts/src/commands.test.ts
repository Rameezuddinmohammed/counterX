import { describe, expect, it } from "vitest";
import fc from "fast-check";
import {
  CryptoIdGenerator,
  instantFromEpochMilliseconds,
  sha256Digest,
  type Instant,
  type IsoCurrencyCode,
  type Money,
  type Result,
} from "@counter/domain";
import type { AuthorityContext } from "./authority-context.js";
import type { Command, CreateTransaction, SubmitQuote } from "./commands.js";
import { COMMAND_TYPES } from "./commands.js";
import { computeCommandMaterialDigest } from "./material-digest.js";

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function unwrap<Value>(result: Result<Value>): Value {
  if (!result.ok) {
    throw new Error(`${result.error.code}: ${result.error.message}`);
  }
  return result.value;
}

const idGen = new CryptoIdGenerator();

function makeInstant(epoch: number): Instant {
  return unwrap(instantFromEpochMilliseconds(epoch));
}

function makeMoney(amountMinor: bigint, currency: IsoCurrencyCode): Money {
  return Object.freeze({ amountMinor, currency });
}

function makeAuthority(overrides?: Partial<AuthorityContext>): AuthorityContext {
  return Object.freeze({
    mandateId: idGen.generate("mandate"),
    policyDecisionId: idGen.generate("policy-decision"),
    quoteDigest: sha256Digest(new Uint8Array([1, 2, 3])),
    paymentReference: idGen.generate("payment-reference"),
    destination: "merchant-wallet-001",
    idempotencyKey: idGen.generate("idempotency"),
    transactionVersion: 1,
    ...overrides,
  });
}

function makeCreateTransaction(overrides?: Partial<CreateTransaction>): CreateTransaction {
  return Object.freeze({
    type: "CreateTransaction" as const,
    commandId: idGen.generate("command"),
    transactionId: idGen.generate("transaction"),
    issuedAt: makeInstant(1700000000000),
    authority: makeAuthority(),
    currency: "USD" as IsoCurrencyCode,
    description: "Test transaction",
    ...overrides,
  });
}

function makeSubmitQuote(overrides?: Partial<SubmitQuote>): SubmitQuote {
  return Object.freeze({
    type: "SubmitQuote" as const,
    commandId: idGen.generate("command"),
    transactionId: idGen.generate("transaction"),
    issuedAt: makeInstant(1700000000000),
    authority: makeAuthority(),
    quoteId: idGen.generate("quote"),
    sourceAmount: makeMoney(10000n, "USD" as IsoCurrencyCode),
    targetAmount: makeMoney(8500n, "EUR" as IsoCurrencyCode),
    expiresAt: makeInstant(1700003600000),
    ...overrides,
  });
}

// ---------------------------------------------------------------------------
// Arbitrary generators for property-based tests
// ---------------------------------------------------------------------------

const arbInstant = fc.integer({ min: 0, max: 253_402_300_799_999 }).map(makeInstant);

const arbCurrency = fc.constantFrom(
  "USD" as IsoCurrencyCode,
  "EUR" as IsoCurrencyCode,
  "GBP" as IsoCurrencyCode,
  "JPY" as IsoCurrencyCode,
);

const arbAuthority: fc.Arbitrary<AuthorityContext> = fc
  .tuple(
    fc.constant(undefined),
    fc.integer({ min: 1, max: 100 }),
    fc.string({ minLength: 1, maxLength: 50 }),
  )
  .map(([_, version, destination]) => makeAuthority({ transactionVersion: version, destination }));

const arbCreateTransaction: fc.Arbitrary<CreateTransaction> = fc
  .tuple(arbCurrency, fc.string({ minLength: 1, maxLength: 100 }), arbAuthority, arbInstant)
  .map(([currency, description, authority, issuedAt]) =>
    makeCreateTransaction({ currency, description, authority, issuedAt }),
  );

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe("command schemas", () => {
  it("exports all 12 command types", () => {
    expect(COMMAND_TYPES).toHaveLength(12);
    expect(COMMAND_TYPES).toContain("CreateTransaction");
    expect(COMMAND_TYPES).toContain("SubmitQuote");
    expect(COMMAND_TYPES).toContain("SubmitIntent");
    expect(COMMAND_TYPES).toContain("ApproveIntent");
    expect(COMMAND_TYPES).toContain("CreatePaymentInstruction");
    expect(COMMAND_TYPES).toContain("RecordPaymentResult");
    expect(COMMAND_TYPES).toContain("CreateOrder");
    expect(COMMAND_TYPES).toContain("RecordOrderResult");
    expect(COMMAND_TYPES).toContain("RequestCancellation");
    expect(COMMAND_TYPES).toContain("RequestRefund");
    expect(COMMAND_TYPES).toContain("RecordRefundResult");
    expect(COMMAND_TYPES).toContain("ResolveIndeterminate");
  });

  it("discriminates commands by type field", () => {
    const cmd: Command = makeCreateTransaction();
    switch (cmd.type) {
      case "CreateTransaction":
        expect(cmd.currency).toBeDefined();
        break;
      default:
        throw new Error("unexpected type");
    }
  });
});

describe("material digest determinism", () => {
  it("produces the same digest for identical material fields", () => {
    const authority = makeAuthority();
    const transactionId = idGen.generate("transaction");

    const cmd1 = makeCreateTransaction({
      commandId: idGen.generate("command"),
      transactionId,
      issuedAt: makeInstant(1700000000000),
      authority,
      currency: "USD" as IsoCurrencyCode,
      description: "Test",
    });

    const cmd2 = makeCreateTransaction({
      commandId: idGen.generate("command"), // different commandId
      transactionId,
      issuedAt: makeInstant(1700099999999), // different issuedAt
      authority,
      currency: "USD" as IsoCurrencyCode,
      description: "Test",
    });

    const digest1 = computeCommandMaterialDigest(cmd1);
    const digest2 = computeCommandMaterialDigest(cmd2);

    expect(digest1).toBe(digest2);
  });

  it("is deterministic across multiple invocations (property)", () => {
    fc.assert(
      fc.property(arbCreateTransaction, (cmd) => {
        const d1 = computeCommandMaterialDigest(cmd);
        const d2 = computeCommandMaterialDigest(cmd);
        expect(d1).toBe(d2);
      }),
    );
  });

  it("produces a valid SHA-256 digest format", () => {
    const cmd = makeCreateTransaction();
    const digest = computeCommandMaterialDigest(cmd);
    expect(digest).toMatch(/^sha256:[0-9a-f]{64}$/u);
  });
});

describe("material change detection", () => {
  it("detects change in currency field", () => {
    const base = makeCreateTransaction({ currency: "USD" as IsoCurrencyCode });
    const changed = makeCreateTransaction({
      ...base,
      currency: "EUR" as IsoCurrencyCode,
    });

    expect(computeCommandMaterialDigest(base)).not.toBe(computeCommandMaterialDigest(changed));
  });

  it("detects change in description field", () => {
    const base = makeCreateTransaction({ description: "original" });
    const changed = makeCreateTransaction({ ...base, description: "modified" });

    expect(computeCommandMaterialDigest(base)).not.toBe(computeCommandMaterialDigest(changed));
  });

  it("detects change in transactionId", () => {
    const base = makeCreateTransaction();
    const changed = makeCreateTransaction({
      ...base,
      transactionId: idGen.generate("transaction"),
    });

    expect(computeCommandMaterialDigest(base)).not.toBe(computeCommandMaterialDigest(changed));
  });

  it("detects material change in SubmitQuote amounts", () => {
    const base = makeSubmitQuote();
    const changed = makeSubmitQuote({
      ...base,
      sourceAmount: makeMoney(99999n, "USD" as IsoCurrencyCode),
    });

    expect(computeCommandMaterialDigest(base)).not.toBe(computeCommandMaterialDigest(changed));
  });

  it("detects material change via property-based testing", () => {
    fc.assert(
      fc.property(
        arbCreateTransaction,
        fc.string({ minLength: 1, maxLength: 50 }),
        (cmd, newDescription) => {
          fc.pre(newDescription !== cmd.description);
          const changed: CreateTransaction = Object.freeze({
            ...cmd,
            description: newDescription,
          });
          expect(computeCommandMaterialDigest(cmd)).not.toBe(computeCommandMaterialDigest(changed));
        },
      ),
    );
  });
});

describe("non-material field exclusion", () => {
  it("commandId does not affect digest", () => {
    const authority = makeAuthority();
    const transactionId = idGen.generate("transaction");

    const cmd1 = makeCreateTransaction({
      commandId: idGen.generate("command"),
      transactionId,
      authority,
    });
    const cmd2: CreateTransaction = Object.freeze({
      ...cmd1,
      commandId: idGen.generate("command"),
    });

    expect(computeCommandMaterialDigest(cmd1)).toBe(computeCommandMaterialDigest(cmd2));
  });

  it("issuedAt does not affect digest", () => {
    const authority = makeAuthority();
    const transactionId = idGen.generate("transaction");

    const cmd1 = makeCreateTransaction({
      issuedAt: makeInstant(1700000000000),
      transactionId,
      authority,
    });
    const cmd2: CreateTransaction = Object.freeze({
      ...cmd1,
      issuedAt: makeInstant(1700099999999),
    });

    expect(computeCommandMaterialDigest(cmd1)).toBe(computeCommandMaterialDigest(cmd2));
  });

  it("non-material fields excluded across all command types (property)", () => {
    fc.assert(
      fc.property(arbCreateTransaction, arbInstant, (cmd, newIssuedAt) => {
        const withDifferentTimestamp: CreateTransaction = Object.freeze({
          ...cmd,
          issuedAt: newIssuedAt,
          commandId: idGen.generate("command"),
        });
        expect(computeCommandMaterialDigest(cmd)).toBe(
          computeCommandMaterialDigest(withDifferentTimestamp),
        );
      }),
    );
  });
});

describe("authority context materiality", () => {
  it("change in mandateId produces different digest", () => {
    const base = makeCreateTransaction();
    const changed: CreateTransaction = Object.freeze({
      ...base,
      authority: Object.freeze({
        ...base.authority,
        mandateId: idGen.generate("mandate"),
      }),
    });

    expect(computeCommandMaterialDigest(base)).not.toBe(computeCommandMaterialDigest(changed));
  });

  it("change in policyDecisionId produces different digest", () => {
    const base = makeCreateTransaction();
    const changed: CreateTransaction = Object.freeze({
      ...base,
      authority: Object.freeze({
        ...base.authority,
        policyDecisionId: idGen.generate("policy-decision"),
      }),
    });

    expect(computeCommandMaterialDigest(base)).not.toBe(computeCommandMaterialDigest(changed));
  });

  it("change in quoteDigest produces different digest", () => {
    const base = makeCreateTransaction();
    const changed: CreateTransaction = Object.freeze({
      ...base,
      authority: Object.freeze({
        ...base.authority,
        quoteDigest: sha256Digest(new Uint8Array([9, 9, 9])),
      }),
    });

    expect(computeCommandMaterialDigest(base)).not.toBe(computeCommandMaterialDigest(changed));
  });

  it("change in paymentReference produces different digest", () => {
    const base = makeCreateTransaction();
    const changed: CreateTransaction = Object.freeze({
      ...base,
      authority: Object.freeze({
        ...base.authority,
        paymentReference: idGen.generate("payment-reference"),
      }),
    });

    expect(computeCommandMaterialDigest(base)).not.toBe(computeCommandMaterialDigest(changed));
  });

  it("change in destination produces different digest", () => {
    const base = makeCreateTransaction();
    const changed: CreateTransaction = Object.freeze({
      ...base,
      authority: Object.freeze({
        ...base.authority,
        destination: "different-destination",
      }),
    });

    expect(computeCommandMaterialDigest(base)).not.toBe(computeCommandMaterialDigest(changed));
  });

  it("change in idempotencyKey produces different digest", () => {
    const base = makeCreateTransaction();
    const changed: CreateTransaction = Object.freeze({
      ...base,
      authority: Object.freeze({
        ...base.authority,
        idempotencyKey: idGen.generate("idempotency"),
      }),
    });

    expect(computeCommandMaterialDigest(base)).not.toBe(computeCommandMaterialDigest(changed));
  });

  it("change in transactionVersion produces different digest", () => {
    const base = makeCreateTransaction();
    const changed: CreateTransaction = Object.freeze({
      ...base,
      authority: Object.freeze({
        ...base.authority,
        transactionVersion: base.authority.transactionVersion + 1,
      }),
    });

    expect(computeCommandMaterialDigest(base)).not.toBe(computeCommandMaterialDigest(changed));
  });
});
