/**
 * Claim ledger with receipt verification.
 *
 * Records source-labelled claims and consumes audience-scoped receipts.
 * Verifies receipts locally using the evidence package verifyReceipt
 * function (schema validation, Ed25519 signature, audience match,
 * canonical digest, supersession chain).
 */

import type {
  ReceiptVerifyOptions,
  ReceiptVerificationResult,
  TrustedPublicKey,
} from "@counter/evidence";
import { verifyReceipt } from "@counter/evidence";

// ---------------------------------------------------------------------------
// Claim Source Types
// ---------------------------------------------------------------------------

export const CLAIM_SOURCE_TYPES = [
  "model_request",
  "model_proposal",
  "model_decision",
  "intent",
  "merchant_response",
  "provider_evidence",
] as const;

export type ClaimSourceType = (typeof CLAIM_SOURCE_TYPES)[number];

const claimSourceTypeSet: ReadonlySet<string> = new Set(CLAIM_SOURCE_TYPES);

export function isClaimSourceType(value: unknown): value is ClaimSourceType {
  return typeof value === "string" && claimSourceTypeSet.has(value);
}

// ---------------------------------------------------------------------------
// Claim Record
// ---------------------------------------------------------------------------

export interface ClaimRecord {
  readonly claimId: string;
  readonly sourceType: ClaimSourceType;
  readonly sourceId: string;
  readonly timestamp: string;
  readonly data: Readonly<Record<string, unknown>>;
  readonly verified: boolean;
}

// ---------------------------------------------------------------------------
// Receipt Consumption Record
// ---------------------------------------------------------------------------

export interface ReceiptConsumption {
  readonly receiptId: string;
  readonly claimId: string;
  readonly audience: string;
  readonly consumedAt: string;
  readonly verificationResult: ReceiptVerificationResult;
}

// ---------------------------------------------------------------------------
// Claim Recording Input
// ---------------------------------------------------------------------------

export interface RecordClaimParams {
  readonly claimId: string;
  readonly sourceType: ClaimSourceType;
  readonly sourceId: string;
  readonly data: Readonly<Record<string, unknown>>;
  readonly verified?: boolean;
}

// ---------------------------------------------------------------------------
// Receipt Consumption Input
// ---------------------------------------------------------------------------

export interface ConsumeReceiptParams {
  readonly claimId: string;
  readonly receiptEnvelope: unknown;
  readonly expectedAudience: string;
  readonly trustedKeys: readonly TrustedPublicKey[];
  readonly currentTime?: string;
  readonly predecessorEnvelope?: unknown;
}

// ---------------------------------------------------------------------------
// Claim Ledger Result Types
// ---------------------------------------------------------------------------

export type ClaimRecordResult =
  | { readonly ok: true; readonly value: ClaimRecord }
  | { readonly ok: false; readonly error: ClaimLedgerError };

export type ReceiptConsumptionResult =
  | { readonly ok: true; readonly value: ReceiptConsumption }
  | { readonly ok: false; readonly error: ClaimLedgerError };

export interface ClaimLedgerError {
  readonly kind: "claim_ledger_error";
  readonly reason: string;
}

// ---------------------------------------------------------------------------
// Claim Ledger
// ---------------------------------------------------------------------------

/**
 * ClaimLedger maintains source-labelled claims and supports consuming
 * audience-scoped receipts with local verification via the evidence package.
 */
export class ClaimLedger {
  readonly #claims: Map<string, ClaimRecord>;
  readonly #consumptions: Map<string, ReceiptConsumption>;
  readonly #claimsBySource: Map<ClaimSourceType, ClaimRecord[]>;
  readonly #clock: () => number;

  constructor(clock?: () => number) {
    this.#claims = new Map();
    this.#consumptions = new Map();
    this.#claimsBySource = new Map();
    this.#clock = clock ?? (() => Date.now());
  }

  /**
   * Records a source-labelled claim.
   */
  record(params: RecordClaimParams): ClaimRecordResult {
    if (!isClaimSourceType(params.sourceType)) {
      return {
        ok: false,
        error: {
          kind: "claim_ledger_error",
          reason: `Invalid source type: ${params.sourceType}`,
        },
      };
    }

    // Check for duplicate claimId
    if (this.#claims.has(params.claimId)) {
      const existing = this.#claims.get(params.claimId)!;
      return { ok: true, value: existing };
    }

    const claim: ClaimRecord = Object.freeze({
      claimId: params.claimId,
      sourceType: params.sourceType,
      sourceId: params.sourceId,
      timestamp: new Date(this.#clock()).toISOString(),
      data: Object.freeze({ ...params.data }),
      verified: params.verified ?? false,
    });

    this.#claims.set(claim.claimId, claim);

    const sourceList = this.#claimsBySource.get(params.sourceType) ?? [];
    sourceList.push(claim);
    this.#claimsBySource.set(params.sourceType, sourceList);

    return { ok: true, value: claim };
  }

  /**
   * Gets a claim by ID.
   */
  get(claimId: string): ClaimRecord | undefined {
    return this.#claims.get(claimId);
  }

  /**
   * Gets all claims for a given source type.
   */
  getBySource(sourceType: ClaimSourceType): readonly ClaimRecord[] {
    return this.#claimsBySource.get(sourceType) ?? [];
  }

  /**
   * Gets all claims.
   */
  getAll(): readonly ClaimRecord[] {
    return [...this.#claims.values()];
  }

  /**
   * Consumes an audience-scoped receipt and verifies it locally.
   *
   * Verification uses:
   * - Schema validation (CTP envelope structure)
   * - Ed25519 signature verification
   * - Audience match
   * - Canonical digest integrity
   * - Supersession chain (if predecessor provided)
   * - Timestamp validity (if currentTime provided)
   */
  async consumeReceipt(params: ConsumeReceiptParams): Promise<ReceiptConsumptionResult> {
    const {
      claimId,
      receiptEnvelope,
      expectedAudience,
      trustedKeys,
      currentTime,
      predecessorEnvelope,
    } = params;

    // Build verification options
    const verifyOptions: ReceiptVerifyOptions = {
      trustedKeys,
      expectedAudience,
      ...(currentTime !== undefined ? { currentTime } : {}),
      ...(predecessorEnvelope !== undefined ? { predecessorEnvelope } : {}),
    };

    // Verify the receipt
    const verificationResult = await verifyReceipt(receiptEnvelope, verifyOptions);

    // Extract receipt ID from envelope
    const receiptId = this.#extractReceiptId(receiptEnvelope);

    const consumption: ReceiptConsumption = Object.freeze({
      receiptId,
      claimId,
      audience: expectedAudience,
      consumedAt: new Date(this.#clock()).toISOString(),
      verificationResult: Object.freeze({ ...verificationResult }),
    });

    this.#consumptions.set(receiptId, consumption);

    // If verification passed, mark the associated claim as verified
    if (verificationResult.valid) {
      const existingClaim = this.#claims.get(claimId);
      if (existingClaim !== undefined) {
        const updatedClaim: ClaimRecord = Object.freeze({
          ...existingClaim,
          verified: true,
        });
        this.#claims.set(claimId, updatedClaim);
      }
    }

    if (!verificationResult.valid) {
      return {
        ok: false,
        error: {
          kind: "claim_ledger_error",
          reason: verificationResult.error ?? "Receipt verification failed",
        },
      };
    }

    return { ok: true, value: consumption };
  }

  /**
   * Gets a receipt consumption record.
   */
  getConsumption(receiptId: string): ReceiptConsumption | undefined {
    return this.#consumptions.get(receiptId);
  }

  // ─── Private Helpers ─────────────────────────────────────────────────────

  #extractReceiptId(envelope: unknown): string {
    if (envelope !== null && typeof envelope === "object") {
      const env = envelope as Record<string, unknown>;
      if (typeof env["id"] === "string") {
        return env["id"];
      }
    }
    return `receipt-${Date.now()}`;
  }
}
