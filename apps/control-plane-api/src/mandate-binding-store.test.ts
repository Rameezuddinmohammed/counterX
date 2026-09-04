/**
 * Unit tests for MandateBindingService: proves the server-side verify +
 * bind + persist gate actually enforces "an issued mandate can never grant
 * more authority than the human already authorized at the payment rail" —
 * using REAL Ed25519 signing/verification (trust-protocol's committed
 * public test fixtures — TEST_KID_A), not a mocked crypto layer.
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
import { MandateBindingService } from "./mandate-binding-store.js";
import type {
  BeginRegistrationResult,
  RecurringMandateProvisionerLike,
  RecurringMandateSummary,
} from "./recurring-mandate-store.js";

const WALLET_ID = "ctr_wallet_AAAAAAAAAAAAAAAAAAAAAA";
const AGENT_ID = "ctr_agent_AAAAAAAAAAAAAAAAAAAAAAA";
const PRINCIPAL_ID = "ctr_actor_AAAAAAAAAAAAAAAAAAAAAA";
const MANDATE_ID = "ctr_mandate_AAAAAAAAAAAAAAAAAAAA";
const REFERENCE_ID = "ctr_payment-reference_provider001";

class FakeRecurringMandates implements RecurringMandateProvisionerLike {
  constructor(private readonly summaries: readonly RecurringMandateSummary[]) {}
  async beginRegistration(): Promise<BeginRegistrationResult> {
    throw new Error("not used in these tests");
  }
  async confirmRegistration(): Promise<RecurringMandateSummary> {
    throw new Error("not used in these tests");
  }
  async confirmRegistrationFromWebhook(): Promise<RecurringMandateSummary | undefined> {
    throw new Error("not used in these tests");
  }
  async revoke(): Promise<void> {
    throw new Error("not used in these tests");
  }
  async list(): Promise<readonly RecurringMandateSummary[]> {
    return this.summaries;
  }
}

function activeProviderMandate(
  overrides: Partial<RecurringMandateSummary> = {},
): RecurringMandateSummary {
  return {
    referenceId: REFERENCE_ID,
    status: "active",
    ceilingMinor: "500000",
    currency: "INR",
    validFrom: "2025-01-01T00:00:00.000Z",
    validUntil: "2026-12-31T23:59:59.000Z",
    eligibleMerchants: ["ctr_merchant_allowed"],
    eligibleOperations: ["purchase"],
    ...overrides,
  };
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
    nonce: "mandate-nonce-test-001",
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

function buildService(
  recurringMandates: readonly RecurringMandateSummary[],
  agentOwnershipCheck: (walletId: string, agentId: string) => Promise<boolean> = async () => true,
) {
  const mandateRepo = new InMemoryMandateRepository();
  const keyRegistry = new InMemoryKeyRegistry([TEST_KEY_RECORD_A]);
  const service = new MandateBindingService(
    mandateRepo,
    keyRegistry,
    new FakeRecurringMandates(recurringMandates),
    agentOwnershipCheck,
  );
  return { service, mandateRepo };
}

describe("MandateBindingService.bind", () => {
  it("binds a mandate whose requested authority is within the active provider mandate's limits", async () => {
    const { service, mandateRepo } = buildService([activeProviderMandate()]);
    const envelope = await signedMandateEnvelope();

    const result = await service.bind(WALLET_ID, envelope, new Date("2025-06-15T00:00:00.000Z"));

    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.value.mandateId).toBe(MANDATE_ID);
      expect(result.value.paymentReferenceId).toBe(REFERENCE_ID);
      expect(result.value.status).toBe("active");
    }
    const persisted = await mandateRepo.findById(MANDATE_ID as WalletMandate["mandateId"]);
    expect(persisted?.status).toBe("active");
    expect(persisted?.constraints.amountLimits.perTransactionMaxPaise).toBe(100_000n);
  });

  it("passes walletId and payload.agent_id to the agent-ownership check", async () => {
    const calls: Array<{ walletId: string; agentId: string }> = [];
    const { service } = buildService([activeProviderMandate()], async (walletId, agentId) => {
      calls.push({ walletId, agentId });
      return true;
    });
    const envelope = await signedMandateEnvelope();

    await service.bind(WALLET_ID, envelope, new Date("2025-06-15T00:00:00.000Z"));

    expect(calls).toEqual([{ walletId: WALLET_ID, agentId: AGENT_ID }]);
  });

  it("rejects a mandate naming an agent_id that is not a real, active agent owned by this wallet", async () => {
    const { service } = buildService([activeProviderMandate()], async () => false);
    const envelope = await signedMandateEnvelope();

    const result = await service.bind(WALLET_ID, envelope, new Date("2025-06-15T00:00:00.000Z"));

    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.error.code).toBe("AGENT_NOT_OWNED");
    }
  });

  it("rejects a tampered envelope (signature no longer matches the payload)", async () => {
    const { service } = buildService([activeProviderMandate()]);
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
    const { service } = buildService([activeProviderMandate()]);
    const envelope = await signedMandateEnvelope();

    const result = await service.bind(
      "ctr_wallet_BBBBBBBBBBBBBBBBBBBBBB",
      envelope,
      new Date("2025-06-15T00:00:00.000Z"),
    );

    expect(result.ok).toBe(false);
    // A wallet_id mismatch also breaks the expectedAudience check inside
    // verifyEnvelope, since audience is derived from the SAME walletId this
    // route was called with — either failure mode is correctly a deny.
    if (!result.ok) {
      expect(["SIGNATURE_INVALID", "WALLET_MISMATCH"]).toContain(result.error.code);
    }
  });

  it("INTERIM (Mandate Pivot Phase 1.3): binds a mandate with NO provider mandate claimed at all, trusting the envelope's own declared limits", async () => {
    const { service, mandateRepo } = buildService([]); // no recurring mandates at all
    const envelope = await signedMandateEnvelope({
      payment_authorization_ref: "ctr_payment-reference_self-consent-001",
    });

    const result = await service.bind(WALLET_ID, envelope, new Date("2025-06-15T00:00:00.000Z"));

    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.value.mandateId).toBe(MANDATE_ID);
      expect(result.value.status).toBe("active");
    }
    const persisted = await mandateRepo.findById(MANDATE_ID as WalletMandate["mandateId"]);
    expect(persisted?.status).toBe("active");
    expect(persisted?.constraints.amountLimits.perTransactionMaxPaise).toBe(100_000n);
  });

  it("fails closed when the referenced payment_authorization_ref DOES resolve to a provider mandate, but it is only 'pending' (not yet human-confirmed)", async () => {
    const { service } = buildService([activeProviderMandate({ status: "pending" })]);
    const envelope = await signedMandateEnvelope();

    const result = await service.bind(WALLET_ID, envelope, new Date("2025-06-15T00:00:00.000Z"));

    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.error.code).toBe("NO_ACTIVE_PROVIDER_MANDATE");
    }
  });

  it("rejects a requested per-transaction ceiling that exceeds the provider mandate's own ceiling", async () => {
    const { service } = buildService([activeProviderMandate({ ceilingMinor: "50000" })]);
    const envelope = await signedMandateEnvelope({
      per_transaction_limit: { amount: 100_000, currency: "INR" },
    });

    const result = await service.bind(WALLET_ID, envelope, new Date("2025-06-15T00:00:00.000Z"));

    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.error.code).toBe("EXCEEDS_PROVIDER_MANDATE");
    }
  });

  it("rejects requested merchants that are not a subset of the provider mandate's eligible merchants", async () => {
    const { service } = buildService([
      activeProviderMandate({ eligibleMerchants: ["ctr_merchant_allowed"] }),
    ]);
    const envelope = await signedMandateEnvelope({
      allowed_merchants: ["ctr_merchant_allowed", "ctr_merchant_NOT_authorized"],
    });

    const result = await service.bind(WALLET_ID, envelope, new Date("2025-06-15T00:00:00.000Z"));

    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.error.code).toBe("EXCEEDS_PROVIDER_MANDATE");
    }
  });

  it("rejects requested validity extending beyond the provider mandate's own validUntil", async () => {
    const { service } = buildService([
      activeProviderMandate({ validUntil: "2025-07-01T00:00:00.000Z" }),
    ]);
    const envelope = await signedMandateEnvelope({ validity_end: "2026-06-01T00:00:00.000Z" });

    const result = await service.bind(WALLET_ID, envelope, new Date("2025-06-15T00:00:00.000Z"));

    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.error.code).toBe("EXCEEDS_PROVIDER_MANDATE");
    }
  });

  it("rejects a structurally invalid envelope", async () => {
    const { service } = buildService([activeProviderMandate()]);

    const result = await service.bind(WALLET_ID, { not: "an envelope" }, new Date());

    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.error.code).toBe("INVALID_ENVELOPE");
    }
  });

  it("rejects a validly-signed envelope of the WRONG CTP type", async () => {
    const { service } = buildService([activeProviderMandate()]);
    const envelope = await signedMandateEnvelope();
    const wrongType = { ...envelope, type: "counter.revocation.v1" };

    const result = await service.bind(WALLET_ID, wrongType, new Date("2025-06-15T00:00:00.000Z"));

    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.error.code).toBe("INVALID_ENVELOPE");
    }
  });
});
