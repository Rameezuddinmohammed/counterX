/**
 * Unit tests for PrepaidBalanceMandateBindingService: proves the
 * server-side verify + bind + persist gate for the prepaid-balance
 * authority model — using REAL Ed25519 signing/verification
 * (trust-protocol's committed public test fixtures — TEST_KID_A), not a
 * mocked crypto layer. Mirrors mandate-binding-store.test.ts's structure
 * so the two authority models' test coverage stays comparable.
 */
import { describe, expect, it } from "vitest";
import {
  buildUnsignedEnvelope,
  signEnvelope,
  InMemoryKeyRegistry,
  TEST_KID_A,
  TEST_KEY_RECORD_A,
  createTestSignerA,
  type MandatePayload,
} from "@counter/trust-protocol";
import { InMemoryMandateRepository, type WalletMandate } from "@counter/wallet-domain";
import {
  PrepaidBalanceMandateBindingService,
  prepaidBalancePaymentReference,
  type WalletBalanceAccountLookup,
} from "./prepaid-balance-mandate-binding-store.js";

const WALLET_ID = "ctr_wallet_AAAAAAAAAAAAAAAAAAAAAA";
const AGENT_ID = "ctr_agent_AAAAAAAAAAAAAAAAAAAAAAA";
const PRINCIPAL_ID = "ctr_actor_AAAAAAAAAAAAAAAAAAAAAA";
const MANDATE_ID = "ctr_mandate_AAAAAAAAAAAAAAAAAAAA";
const REFERENCE_ID = prepaidBalancePaymentReference(WALLET_ID);

class FakeWalletBalance implements WalletBalanceAccountLookup {
  constructor(private readonly hasAccount: boolean) {}
  async hasBalanceAccount(): Promise<boolean> {
    return this.hasAccount;
  }
}

async function signedMandateEnvelope(payloadOverrides: Partial<MandatePayload> = {}) {
  const payload: MandatePayload = {
    mandate_id: MANDATE_ID,
    principal_id: PRINCIPAL_ID,
    wallet_id: WALLET_ID,
    agent_id: AGENT_ID,
    kid: TEST_KID_A,
    allowed_merchants: ["ctr_merchant_allowed"],
    currencies: ["INR"],
    per_transaction_limit: { amount: 100_000, currency: "INR" },
    allowed_operations: ["purchase"],
    payment_authorization_ref: REFERENCE_ID,
    validity_start: "2025-06-01T00:00:00.000Z",
    validity_end: "2026-06-01T00:00:00.000Z",
    policy_version: "v1",
    policy_digest: "sha256:v1",
    ...payloadOverrides,
  };

  const unsignedResult = buildUnsignedEnvelope<MandatePayload>({
    type: "counter.mandate.v1",
    id: `mandate-${MANDATE_ID}`,
    issuer: `counter://wallet/${WALLET_ID}`,
    subject: `counter://agent/${AGENT_ID}`,
    audience: [`counter://wallet/${WALLET_ID}`, `counter://agent/${AGENT_ID}`],
    environment: "pilot",
    issued_at: "2025-06-01T00:00:00.000Z",
    not_before: payload.validity_start,
    expires_at: payload.validity_end,
    nonce: "prepaid-mandate-nonce-test-001",
    correlation_id: "corr-test-001",
    payload,
    kid: TEST_KID_A,
  });
  if (!unsignedResult.ok) {
    throw new Error(`fixture setup failed: ${unsignedResult.error.message}`);
  }
  const signedResult = await signEnvelope(unsignedResult.value, createTestSignerA());
  if (!signedResult.ok) {
    throw new Error(`fixture setup failed: ${signedResult.error.message}`);
  }
  return signedResult.value;
}

function buildService(hasBalanceAccount: boolean) {
  const mandateRepo = new InMemoryMandateRepository();
  const keyRegistry = new InMemoryKeyRegistry([TEST_KEY_RECORD_A]);
  const service = new PrepaidBalanceMandateBindingService(
    mandateRepo,
    keyRegistry,
    new FakeWalletBalance(hasBalanceAccount),
  );
  return { service, mandateRepo };
}

describe("PrepaidBalanceMandateBindingService.bind", () => {
  it("binds a mandate whose requested authority is within the configured policy ceiling, for a wallet with a balance account", async () => {
    const { service, mandateRepo } = buildService(true);
    const envelope = await signedMandateEnvelope();

    const result = await service.bind(WALLET_ID, envelope, new Date("2025-06-15T00:00:00.000Z"));

    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.value.mandateId).toBe(MANDATE_ID);
      expect(result.value.paymentReferenceId).toBe(REFERENCE_ID);
      expect(result.value.status).toBe("active");
      expect(result.value.bindingKind).toBe("prepaid-balance");
    }
    const persisted = await mandateRepo.findById(MANDATE_ID as WalletMandate["mandateId"]);
    expect(persisted?.status).toBe("active");
    expect(persisted?.constraints.amountLimits.perTransactionMaxPaise).toBe(100_000n);
    expect(persisted?.paymentReferenceId).toBe(REFERENCE_ID);
  });

  it("fails closed when the wallet has no prepaid-balance account at all (never topped up)", async () => {
    const { service } = buildService(false);
    const envelope = await signedMandateEnvelope();

    const result = await service.bind(WALLET_ID, envelope, new Date("2025-06-15T00:00:00.000Z"));

    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.error.code).toBe("NO_PREPAID_BALANCE_ACCOUNT");
    }
  });

  it("rejects a requested per-transaction ceiling that exceeds the configured policy ceiling", async () => {
    const { service } = buildService(true);
    const envelope = await signedMandateEnvelope({
      per_transaction_limit: { amount: 999_999_999, currency: "INR" },
    });

    const result = await service.bind(WALLET_ID, envelope, new Date("2025-06-15T00:00:00.000Z"));

    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.error.code).toBe("EXCEEDS_PREPAID_POLICY");
    }
  });

  it("rejects requested validity extending beyond the configured maximum window", async () => {
    const { service } = buildService(true);
    const envelope = await signedMandateEnvelope({
      // ~2 years out from the bind time used below (max is 365 days).
      validity_end: "2027-06-15T00:00:00.000Z",
    });

    const result = await service.bind(WALLET_ID, envelope, new Date("2025-06-15T00:00:00.000Z"));

    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.error.code).toBe("EXCEEDS_PREPAID_POLICY");
    }
  });

  it("rejects a payment_authorization_ref that is not the wallet-scoped prepaid-balance sentinel", async () => {
    const { service } = buildService(true);
    // A DIFFERENT wallet's sentinel, or an arbitrary string — either way,
    // never a bare/global constant (see this service's header for why).
    const envelope = await signedMandateEnvelope({
      payment_authorization_ref: "prepaid-balance:ctr_wallet_SOMEONE_ELSE",
    });

    const result = await service.bind(WALLET_ID, envelope, new Date("2025-06-15T00:00:00.000Z"));

    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.error.code).toBe("WALLET_MISMATCH");
    }
  });

  it("rejects a tampered envelope (signature no longer matches the payload)", async () => {
    const { service } = buildService(true);
    const envelope = await signedMandateEnvelope();
    const tampered = {
      ...envelope,
      payload: {
        ...envelope.payload,
        per_transaction_limit: { amount: 999_999_999, currency: "INR" },
      },
    };

    const result = await service.bind(WALLET_ID, tampered, new Date("2025-06-15T00:00:00.000Z"));

    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.error.code).toBe("SIGNATURE_INVALID");
    }
  });

  it("rejects when the envelope's wallet_id does not match the route's walletId", async () => {
    const { service } = buildService(true);
    const envelope = await signedMandateEnvelope();

    const result = await service.bind(
      "ctr_wallet_BBBBBBBBBBBBBBBBBBBBBB",
      envelope,
      new Date("2025-06-15T00:00:00.000Z"),
    );

    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(["SIGNATURE_INVALID", "WALLET_MISMATCH"]).toContain(result.error.code);
    }
  });

  it("rejects a structurally invalid envelope", async () => {
    const { service } = buildService(true);

    const result = await service.bind(WALLET_ID, { not: "an envelope" }, new Date());

    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.error.code).toBe("INVALID_ENVELOPE");
    }
  });

  it("rejects a validly-signed envelope of the WRONG CTP type", async () => {
    const { service } = buildService(true);
    const envelope = await signedMandateEnvelope();
    const wrongType = { ...envelope, type: "counter.revocation.v1" };

    const result = await service.bind(WALLET_ID, wrongType, new Date("2025-06-15T00:00:00.000Z"));

    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.error.code).toBe("INVALID_ENVELOPE");
    }
  });
});
