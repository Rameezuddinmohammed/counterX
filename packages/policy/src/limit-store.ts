/**
 * LimitStore port interface.
 *
 * Defines the contract for atomic rolling amount/count/quantity limit
 * reservation and release semantics. The interface supports a future
 * PostgreSQL-backed implementation with row-level locking.
 */

import type { Instant, IsoCurrencyCode, QuantityUnit, Result } from "@counter/domain";

// ---------------------------------------------------------------------------
// Limit types
// ---------------------------------------------------------------------------

export type LimitType = "amount" | "count" | "quantity";

export type ReservationStatus = "active" | "released" | "expired";

export interface LimitBucket {
  readonly bucketId: string;
  readonly ownerId: string;
  readonly limitType: LimitType;
  readonly currency: IsoCurrencyCode | undefined;
  readonly unit: QuantityUnit | undefined;
  readonly maxValue: bigint;
  readonly windowDurationMs: number;
  readonly windowStart: Instant;
}

export interface Reservation {
  readonly reservationId: string;
  readonly bucketId: string;
  readonly amount: bigint;
  readonly createdAt: Instant;
  readonly expiresAt: Instant;
  readonly status: ReservationStatus;
}

export interface CurrentUsage {
  readonly bucketId: string;
  readonly used: bigint;
  readonly reserved: bigint;
  readonly available: bigint;
  readonly maxValue: bigint;
}

export interface ReserveContext {
  readonly transactionId: string;
  readonly requestedAt: Instant;
  readonly expiresAt: Instant;
}

// ---------------------------------------------------------------------------
// LimitStore interface (pure port)
// ---------------------------------------------------------------------------

/**
 * Atomic check-and-reserve limit store.
 *
 * Implementations must guarantee:
 * - reserve() atomically checks usage + active reservations against bucket max
 * - Concurrent reserve() calls on the same bucket serialize properly
 * - Expired reservations do not count against the limit
 */
export interface LimitStore {
  /**
   * Atomically check current usage and create a reservation if within limits.
   * Returns an error Result if the limit would be exceeded.
   */
  reserve(bucketId: string, amount: bigint, context: ReserveContext): Promise<Result<Reservation>>;

  /**
   * Release a reservation, freeing the reserved amount.
   */
  release(reservationId: string): Promise<Result<void>>;

  /**
   * Get current usage within the specified window.
   */
  getCurrentUsage(bucketId: string, windowStart: Instant, windowEnd: Instant): Promise<Result<CurrentUsage>>;

  /**
   * Get all active (non-expired, non-released) reservations for a bucket.
   */
  getActiveReservations(bucketId: string): Promise<Result<readonly Reservation[]>>;
}
