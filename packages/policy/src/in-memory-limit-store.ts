/**
 * In-memory LimitStore implementation with concurrency-safe reservation.
 *
 * Uses a per-bucket async lock (mutex) to ensure atomicity of
 * check-and-reserve operations without a real database.
 */

import { createCanonicalError, ok, err } from "@counter/domain";
import type { Instant, Result } from "@counter/domain";
import type {
  CurrentUsage,
  LimitBucket,
  LimitStore,
  Reservation,
  ReserveContext,
  ReservationStatus,
} from "./limit-store.js";

// ---------------------------------------------------------------------------
// Internal mutable reservation record
// ---------------------------------------------------------------------------

interface MutableReservation {
  readonly reservationId: string;
  readonly bucketId: string;
  readonly amount: bigint;
  readonly createdAt: Instant;
  readonly expiresAt: Instant;
  status: ReservationStatus;
}

// ---------------------------------------------------------------------------
// Simple async mutex per bucket
// ---------------------------------------------------------------------------

type ReleaseLock = () => void;

class AsyncMutex {
  #queue: Array<() => void> = [];
  #locked = false;

  async acquire(): Promise<ReleaseLock> {
    if (!this.#locked) {
      this.#locked = true;
      return () => this.#release();
    }

    return new Promise<ReleaseLock>((resolve) => {
      this.#queue.push(() => {
        resolve(() => this.#release());
      });
    });
  }

  #release(): void {
    const next = this.#queue.shift();
    if (next !== undefined) {
      next();
    } else {
      this.#locked = false;
    }
  }
}

// ---------------------------------------------------------------------------
// InMemoryLimitStore
// ---------------------------------------------------------------------------

let reservationCounter = 0;

function generateReservationId(): string {
  reservationCounter += 1;
  return `rsv_${Date.now()}_${reservationCounter}`;
}

export class InMemoryLimitStore implements LimitStore {
  readonly #buckets: Map<string, LimitBucket> = new Map();
  readonly #reservations: Map<string, MutableReservation[]> = new Map();
  readonly #locks: Map<string, AsyncMutex> = new Map();

  /**
   * Register a bucket definition. Must be called before reserving against it.
   */
  registerBucket(bucket: LimitBucket): void {
    this.#buckets.set(bucket.bucketId, bucket);
    if (!this.#reservations.has(bucket.bucketId)) {
      this.#reservations.set(bucket.bucketId, []);
    }
  }

  private getLock(bucketId: string): AsyncMutex {
    let lock = this.#locks.get(bucketId);
    if (lock === undefined) {
      lock = new AsyncMutex();
      this.#locks.set(bucketId, lock);
    }
    return lock;
  }

  private getActiveReservationsInternal(bucketId: string, now: Instant): MutableReservation[] {
    const reservations = this.#reservations.get(bucketId);
    if (reservations === undefined) {
      return [];
    }

    // Lazily expire old reservations
    for (const r of reservations) {
      if (r.status === "active" && (r.expiresAt as number) <= (now as number)) {
        r.status = "expired";
      }
    }

    return reservations.filter((r) => r.status === "active");
  }

  async reserve(
    bucketId: string,
    amount: bigint,
    context: ReserveContext,
  ): Promise<Result<Reservation>> {
    const bucket = this.#buckets.get(bucketId);
    if (bucket === undefined) {
      return err(
        createCanonicalError({
          category: "validation",
          code: "INVALID_FORMAT",
          message: "Limit bucket not found",
        }),
      );
    }

    const lock = this.getLock(bucketId);
    const release = await lock.acquire();
    try {
      const active = this.getActiveReservationsInternal(bucketId, context.requestedAt);
      const currentReserved = active.reduce((sum, r) => sum + r.amount, 0n);

      if (currentReserved + amount > bucket.maxValue) {
        return err(
          createCanonicalError({
            category: "policy_denial",
            code: "POLICY_DENIED",
            message: "Reservation would exceed bucket limit",
          }),
        );
      }

      const reservation: MutableReservation = {
        reservationId: generateReservationId(),
        bucketId,
        amount,
        createdAt: context.requestedAt,
        expiresAt: context.expiresAt,
        status: "active",
      };

      const bucketReservations = this.#reservations.get(bucketId);
      if (bucketReservations !== undefined) {
        bucketReservations.push(reservation);
      } else {
        this.#reservations.set(bucketId, [reservation]);
      }

      const frozen: Reservation = Object.freeze({
        reservationId: reservation.reservationId,
        bucketId: reservation.bucketId,
        amount: reservation.amount,
        createdAt: reservation.createdAt,
        expiresAt: reservation.expiresAt,
        status: reservation.status,
      });

      return ok(frozen);
    } finally {
      release();
    }
  }

  async release(reservationId: string): Promise<Result<void>> {
    for (const [bucketId, reservations] of this.#reservations) {
      const lock = this.getLock(bucketId);
      const releaseLock = await lock.acquire();
      try {
        const reservation = reservations.find((r) => r.reservationId === reservationId);
        if (reservation !== undefined) {
          reservation.status = "released";
          return ok(undefined);
        }
      } finally {
        releaseLock();
      }
    }

    return err(
      createCanonicalError({
        category: "validation",
        code: "INVALID_FORMAT",
        message: "Reservation not found",
      }),
    );
  }

  async getCurrentUsage(
    bucketId: string,
    _windowStart: Instant,
    windowEnd: Instant,
  ): Promise<Result<CurrentUsage>> {
    const bucket = this.#buckets.get(bucketId);
    if (bucket === undefined) {
      return err(
        createCanonicalError({
          category: "validation",
          code: "INVALID_FORMAT",
          message: "Limit bucket not found",
        }),
      );
    }

    const lock = this.getLock(bucketId);
    const release = await lock.acquire();
    try {
      const active = this.getActiveReservationsInternal(bucketId, windowEnd);
      const reserved = active.reduce((sum, r) => sum + r.amount, 0n);
      const available = bucket.maxValue - reserved;

      const usage: CurrentUsage = Object.freeze({
        bucketId,
        used: 0n,
        reserved,
        available: available > 0n ? available : 0n,
        maxValue: bucket.maxValue,
      });

      return ok(usage);
    } finally {
      release();
    }
  }

  async getActiveReservations(bucketId: string): Promise<Result<readonly Reservation[]>> {
    const bucket = this.#buckets.get(bucketId);
    if (bucket === undefined) {
      return err(
        createCanonicalError({
          category: "validation",
          code: "INVALID_FORMAT",
          message: "Limit bucket not found",
        }),
      );
    }

    const lock = this.getLock(bucketId);
    const release = await lock.acquire();
    try {
      const now = Date.now() as Instant;
      const active = this.getActiveReservationsInternal(bucketId, now);
      const frozen: readonly Reservation[] = Object.freeze(
        active.map((r) =>
          Object.freeze({
            reservationId: r.reservationId,
            bucketId: r.bucketId,
            amount: r.amount,
            createdAt: r.createdAt,
            expiresAt: r.expiresAt,
            status: r.status as "active",
          }),
        ),
      );
      return ok(frozen);
    } finally {
      release();
    }
  }
}
