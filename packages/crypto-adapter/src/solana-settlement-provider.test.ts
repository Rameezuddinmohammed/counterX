/**
 * Tests for SolanaSettlementProvider.
 *
 * Uses a hand-written mock SolanaSettlementPort — no real network, no
 * @solana/kit calls anywhere in this file, matching the port seam's whole
 * purpose (see solana-port.ts's header).
 *
 * Covers:
 * - createInstruction: confirmed/declined/indeterminate outcomes
 * - createInstruction: missing/malformed metadata error case
 * - query(): confirmed/finalized/not_found/failed mapping
 * - capabilities(): direct_capture, INR, no webhook/refund
 * - the "not supported on this rail" methods (refund/queryRefund/verifyWebhook)
 * - verifyClientReturn always returns untrusted
 */
import { describe, expect, it } from "vitest";

import type { IsoCurrencyCode } from "@counter/domain";
import type {
  PaymentProvider,
  ProviderReference,
  ProviderRefundReference,
} from "@counter/payment-sdk";

import type {
  SolanaSettlementPort,
  SolanaTransferOutcome,
  TransferFixedParams,
} from "./solana-port.js";
import { encodeSolanaMetadata } from "./metadata-codec.js";
import { SolanaSettlementProvider } from "./solana-settlement-provider.js";
import type { FixedDelegationCoordinates } from "./types.js";

// ─── Test Helpers ────────────────────────────────────────────────────────────

const BASE_TIME = 1_700_000_000_000;

const COORDINATES: FixedDelegationCoordinates = Object.freeze({
  subscriptionAuthorityPda: "SubAuthPda11111111111111111111111111111111",
  fixedDelegationPda: "FixedDelPda1111111111111111111111111111111",
  delegatorAddress: "Delegator111111111111111111111111111111111",
  delegatorAta: "DelegatorAta11111111111111111111111111111",
  delegateeAddress: "Delegatee111111111111111111111111111111111",
  tokenMint: "TokenMint111111111111111111111111111111111",
});

const RECEIVER_ATA = "ReceiverAta1111111111111111111111111111111";

function validMetadata(): Record<string, string> {
  return encodeSolanaMetadata({ coordinates: COORDINATES, receiverAta: RECEIVER_ATA });
}

class MockSolanaSettlementPort implements SolanaSettlementPort {
  public transferCalls: TransferFixedParams[] = [];
  public statusCalls: string[] = [];
  #transferResult: SolanaTransferOutcome = { kind: "landed", signature: "sig_default" };
  #statusResult: "confirmed" | "finalized" | "not_found" | "failed" = "confirmed";

  public setTransferResult(result: SolanaTransferOutcome): void {
    this.#transferResult = result;
  }

  public setStatusResult(result: "confirmed" | "finalized" | "not_found" | "failed"): void {
    this.#statusResult = result;
  }

  public async transferFixed(params: TransferFixedParams): Promise<SolanaTransferOutcome> {
    this.transferCalls.push(params);
    return this.#transferResult;
  }

  public async getSignatureStatus(
    signature: string,
  ): Promise<"confirmed" | "finalized" | "not_found" | "failed"> {
    this.statusCalls.push(signature);
    return this.#statusResult;
  }
}

function createProvider(
  port: MockSolanaSettlementPort,
  clockTime = BASE_TIME,
): SolanaSettlementProvider {
  return new SolanaSettlementProvider({ port, clock: () => clockTime });
}

function baseCommand(overrides: Partial<{ metadata: Record<string, string> }> = {}) {
  return {
    authorizationRef: "auth_ref",
    amount: Object.freeze({ amountMinor: 10_000_000n, currency: "INR" as IsoCurrencyCode }),
    currency: "INR" as IsoCurrencyCode,
    merchantId: "m1" as unknown as never,
    idempotencyKey: "idem_001",
    metadata: validMetadata(),
    ...overrides,
  };
}

// ─── Tests ───────────────────────────────────────────────────────────────────

describe("SolanaSettlementProvider", () => {
  describe("capabilities", () => {
    it("reports direct_capture lifecycle, INR only, no webhook/refund support", async () => {
      const port = new MockSolanaSettlementPort();
      const provider = createProvider(port);
      const caps = await provider.capabilities({
        environment: "test" as never,
        walletId: "w1" as never,
        agentId: "a1" as never,
        merchantId: "m1" as never,
      });

      expect(caps.lifecycleType).toBe("direct_capture");
      expect(caps.currencies).toContain("INR");
      expect(caps.currencies).toHaveLength(1);
      expect(caps.idempotency).toBe(true);
      expect(caps.webhookVerification).toBe(false);
      expect(caps.refundSupported).toBe(false);
    });
  });

  describe("createInstruction", () => {
    it("maps a landed transfer to a confirmed result with reference = signature", async () => {
      const port = new MockSolanaSettlementPort();
      port.setTransferResult({ kind: "landed", signature: "sig_abc123" });
      const provider = createProvider(port);

      const result = await provider.createInstruction(baseCommand());

      expect(result.kind).toBe("confirmed");
      if (result.kind === "confirmed") {
        expect(result.evidence.reference).toBe("sig_abc123");
        expect(result.evidence.status).toBe("confirmed");
        expect(result.evidence.confirmedAt).toBeDefined();
        expect(result.evidence.providerData?.["signature"]).toBe("sig_abc123");
        expect(result.evidence.providerData?.["chain"]).toBe("solana-devnet");
        expect(result.evidence.providerData?.["tokenMint"]).toBe(COORDINATES.tokenMint);
      }
    });

    it("passes amount.amountMinor straight through as the token minor-unit amount (documented simplification)", async () => {
      const port = new MockSolanaSettlementPort();
      port.setTransferResult({ kind: "landed", signature: "sig_amt" });
      const provider = createProvider(port);

      await provider.createInstruction(
        baseCommand({
          metadata: validMetadata(),
        }) as never,
      );

      expect(port.transferCalls).toHaveLength(1);
      expect(port.transferCalls[0]?.amountMinor).toBe(10_000_000n);
      expect(port.transferCalls[0]?.receiverAta).toBe(RECEIVER_ATA);
      expect(port.transferCalls[0]?.coordinates).toEqual(COORDINATES);
    });

    it("includes remainingCapMinor in providerData when the port reports it", async () => {
      const port = new MockSolanaSettlementPort();
      port.setTransferResult({
        kind: "landed",
        signature: "sig_cap",
        remainingCapMinor: 5_000_000n,
      });
      const provider = createProvider(port);

      const result = await provider.createInstruction(baseCommand());

      expect(result.kind).toBe("confirmed");
      if (result.kind === "confirmed") {
        expect(result.evidence.providerData?.["remainingCapMinor"]).toBe("5000000");
      }
    });

    it("maps a declined outcome to a declined result", async () => {
      const port = new MockSolanaSettlementPort();
      port.setTransferResult({
        kind: "declined",
        reason:
          "AMOUNT_EXCEEDS_LIMIT: this transfer would exceed the mandate's remaining spend cap",
      });
      const provider = createProvider(port);

      const result = await provider.createInstruction(baseCommand());

      expect(result.kind).toBe("declined");
      if (result.kind === "declined") {
        expect(result.reason.retryable).toBe(false);
        expect(result.reason.reason).toContain("AMOUNT_EXCEEDS_LIMIT");
      }
    });

    it("maps an indeterminate outcome to an indeterminate result with a near-future queryAfter", async () => {
      const port = new MockSolanaSettlementPort();
      port.setTransferResult({
        kind: "indeterminate",
        reason: "Solana devnet RPC transport error",
      });
      const provider = createProvider(port, BASE_TIME);

      const result = await provider.createInstruction(baseCommand());

      expect(result.kind).toBe("indeterminate");
      if (result.kind === "indeterminate") {
        expect(result.reference).toBe("idem_001");
        expect(Number(result.queryAfter)).toBeGreaterThan(BASE_TIME);
      }
    });

    it("throws a validation error when metadata is missing", async () => {
      const port = new MockSolanaSettlementPort();
      const provider = createProvider(port);

      await expect(
        provider.createInstruction(baseCommand({ metadata: undefined as never })),
      ).rejects.toMatchObject({ code: "INVALID_FORMAT" });
      expect(port.transferCalls).toHaveLength(0);
    });

    it("throws a validation error when metadata is missing a required field", async () => {
      const port = new MockSolanaSettlementPort();
      const provider = createProvider(port);
      const { fixedDelegationPda: _omitted, ...incomplete } = validMetadata();

      await expect(
        provider.createInstruction(baseCommand({ metadata: incomplete })),
      ).rejects.toMatchObject({ code: "INVALID_FORMAT" });
      expect(port.transferCalls).toHaveLength(0);
    });
  });

  describe("query", () => {
    it("maps confirmed status to confirmed evidence", async () => {
      const port = new MockSolanaSettlementPort();
      port.setStatusResult("confirmed");
      const provider = createProvider(port);

      const evidence = await provider.query("sig_xyz" as ProviderReference);

      expect(evidence.status).toBe("confirmed");
      expect(evidence.reference).toBe("sig_xyz");
      expect(evidence.confirmedAt).toBeDefined();
    });

    it("maps finalized status to confirmed evidence", async () => {
      const port = new MockSolanaSettlementPort();
      port.setStatusResult("finalized");
      const provider = createProvider(port);

      const evidence = await provider.query("sig_xyz" as ProviderReference);

      expect(evidence.status).toBe("confirmed");
    });

    it("maps not_found status to pending evidence", async () => {
      const port = new MockSolanaSettlementPort();
      port.setStatusResult("not_found");
      const provider = createProvider(port);

      const evidence = await provider.query("sig_unknown" as ProviderReference);

      expect(evidence.status).toBe("pending");
    });

    it("maps failed status to declined evidence", async () => {
      const port = new MockSolanaSettlementPort();
      port.setStatusResult("failed");
      const provider = createProvider(port);

      const evidence = await provider.query("sig_failed" as ProviderReference);

      expect(evidence.status).toBe("declined");
    });
  });

  describe("verifyClientReturn", () => {
    it("always returns untrusted (no hosted checkout page on this rail)", async () => {
      const port = new MockSolanaSettlementPort();
      const provider = createProvider(port);

      const result = await provider.verifyClientReturn({
        queryParams: { reference: "sig_abc" },
        returnedAt: BASE_TIME as never,
      });

      expect(result.kind).toBe("untrusted");
    });
  });

  describe("not supported on this rail", () => {
    it("refund throws UNSUPPORTED_VALUE", async () => {
      const port = new MockSolanaSettlementPort();
      const provider = createProvider(port);

      await expect(
        provider.refund({
          reference: "sig_abc" as ProviderReference,
          amount: Object.freeze({ amountMinor: 1000n, currency: "INR" as IsoCurrencyCode }),
          idempotencyKey: "refund_key",
        }),
      ).rejects.toMatchObject({ code: "UNSUPPORTED_VALUE" });
    });

    it("queryRefund throws UNSUPPORTED_VALUE", async () => {
      const port = new MockSolanaSettlementPort();
      const provider = createProvider(port);

      await expect(
        provider.queryRefund("refund_ref" as ProviderRefundReference),
      ).rejects.toMatchObject({ code: "UNSUPPORTED_VALUE" });
    });

    it("verifyWebhook throws UNSUPPORTED_VALUE", async () => {
      const port = new MockSolanaSettlementPort();
      const provider = createProvider(port);

      await expect(
        provider.verifyWebhook({
          headers: {},
          body: new Uint8Array(),
          receivedAt: BASE_TIME as never,
        }),
      ).rejects.toMatchObject({ code: "UNSUPPORTED_VALUE" });
    });

    it("does not implement authorize/capture/void (left undefined for direct_capture fallthrough)", () => {
      const port = new MockSolanaSettlementPort();
      // Typed as the PaymentProvider interface (not the concrete class) so
      // the optional-but-undefined members are legal to check at all — the
      // concrete SolanaSettlementProvider class doesn't declare them. Uses
      // `in` rather than a direct property read to avoid referencing an
      // unbound optional method (@typescript-eslint/unbound-method).
      const provider: PaymentProvider = createProvider(port);

      expect("authorize" in provider).toBe(false);
      expect("capture" in provider).toBe(false);
      expect("void" in provider).toBe(false);
    });
  });
});
