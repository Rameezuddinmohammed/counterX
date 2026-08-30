/**
 * Verification repository port and in-memory implementation.
 *
 * Defines the persistence interface for MerchantOwnershipVerification records
 * and provides a simple array-backed implementation for testing.
 */

import type { Instant, Result } from "@counter/domain";
import { ok } from "@counter/domain";
import type { MerchantOwnershipVerification, VerificationTargetType } from "./verification.js";

// ─── Verification Repository Port ───────────────────────────────────────────

export interface VerificationRepository {
  readonly save: (record: MerchantOwnershipVerification) => Promise<Result<void>>;
  readonly findByMerchant: (
    merchantId: string,
  ) => Promise<Result<readonly MerchantOwnershipVerification[]>>;
  readonly findByTarget: (
    targetType: VerificationTargetType,
    targetId: string,
  ) => Promise<Result<readonly MerchantOwnershipVerification[]>>;
  readonly findExpiring: (
    before: Instant,
  ) => Promise<Result<readonly MerchantOwnershipVerification[]>>;
}

// ─── In-Memory Implementation ───────────────────────────────────────────────

/**
 * Simple array-backed VerificationRepository for tests.
 */
export class InMemoryVerificationRepository implements VerificationRepository {
  private readonly records: MerchantOwnershipVerification[] = [];

  async save(record: MerchantOwnershipVerification): Promise<Result<void>> {
    this.records.push(record);
    return ok(undefined);
  }

  async findByMerchant(
    merchantId: string,
  ): Promise<Result<readonly MerchantOwnershipVerification[]>> {
    const results = this.records.filter((r) => r.target_id === merchantId);
    return ok(Object.freeze([...results]));
  }

  async findByTarget(
    targetType: VerificationTargetType,
    targetId: string,
  ): Promise<Result<readonly MerchantOwnershipVerification[]>> {
    const results = this.records.filter(
      (r) => r.target_type === targetType && r.target_id === targetId,
    );
    return ok(Object.freeze([...results]));
  }

  async findExpiring(before: Instant): Promise<Result<readonly MerchantOwnershipVerification[]>> {
    const results = this.records.filter((r) => r.expiry_time < before);
    return ok(Object.freeze([...results]));
  }
}
