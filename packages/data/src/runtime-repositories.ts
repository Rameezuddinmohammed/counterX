/**
 * Async PostgreSQL implementations of the runtime workflow repositories.
 *
 * The workflow package defines synchronous interfaces (for in-memory use).
 * These async variants mirror the same semantics but return Promises,
 * since they perform actual SQL queries against PostgreSQL.
 */

import {
  type CanonicalError,
  type CounterId,
  type Environment,
  type Instant,
  type Result,
  type Sha256Digest,
  createCanonicalError,
  err,
  instantFromEpochMilliseconds,
  ok,
  parseSha256Digest,
  sha256DigestsEqual,
} from "@counter/domain";
import type {
  IdempotencyAcquireResult,
  IdempotencyEntry,
  IdempotencyKeyStatus,
} from "@counter/workflow";
import type { InboxEvent, InboxEventInput, InboxReceiveResult } from "@counter/workflow";
import type { Job, JobInput } from "@counter/workflow";
import type { OutboxEvent, OutboxEventInput } from "@counter/workflow";
import type { TransactionalDatabase } from "./database.js";

// ─── Async Interface Variants ───────────────────────────────────────────────

export interface AsyncIdempotencyStore {
  acquire(
    key: string,
    digest: Sha256Digest,
    now: Instant,
  ): Promise<Result<IdempotencyAcquireResult, CanonicalError>>;
  complete(
    key: string,
    responseSnapshot: unknown,
    now: Instant,
  ): Promise<Result<void, CanonicalError>>;
  fail(key: string): Promise<Result<void, CanonicalError>>;
}

export interface AsyncOutboxRepository {
  append(
    events: readonly OutboxEventInput[],
    now: Instant,
  ): Promise<Result<readonly OutboxEvent[], CanonicalError>>;
  claim(
    limit: number,
    owner: string,
    now: Instant,
  ): Promise<Result<readonly OutboxEvent[], CanonicalError>>;
  markDispatched(
    ids: readonly CounterId<"outbox-event">[],
    now: Instant,
  ): Promise<Result<void, CanonicalError>>;
  markFailed(
    id: CounterId<"outbox-event">,
    errorClass: string,
    now: Instant,
  ): Promise<Result<void, CanonicalError>>;
  markDeadLetter(
    id: CounterId<"outbox-event">,
    owner: string,
  ): Promise<Result<void, CanonicalError>>;
}

export interface AsyncInboxRepository {
  receive(
    input: InboxEventInput,
    now: Instant,
  ): Promise<Result<InboxReceiveResult, CanonicalError>>;
  markProcessed(id: CounterId<"inbox-event">, now: Instant): Promise<Result<void, CanonicalError>>;
}

export interface AsyncJobRepository {
  enqueue(input: JobInput, now: Instant): Promise<Result<Job, CanonicalError>>;
  claim(
    types: readonly string[],
    leaseOwner: string,
    leaseDurationMs: number,
    now: Instant,
    limit?: number,
  ): Promise<Result<readonly Job[], CanonicalError>>;
  renewLease(
    id: CounterId<"job">,
    owner: string,
    leaseDurationMs: number,
    now: Instant,
  ): Promise<Result<void, CanonicalError>>;
  complete(
    id: CounterId<"job">,
    owner: string,
    now: Instant,
  ): Promise<Result<void, CanonicalError>>;
  fail(
    id: CounterId<"job">,
    owner: string,
    errorClass: string,
    errorMessage: string,
    baseDelayMs: number,
    now: Instant,
  ): Promise<Result<void, CanonicalError>>;
  deadLetter(
    id: CounterId<"job">,
    owner: string,
    reason: string,
  ): Promise<Result<void, CanonicalError>>;
}

// ─── Row Types ──────────────────────────────────────────────────────────────

interface IdempotencyKeyRow {
  id: string;
  environment: string;
  scope_kind: string;
  scope_id: string;
  operation: string;
  key: string;
  material_request_digest: string;
  status: string;
  response_snapshot: unknown;
  created_at: Date;
  completed_at: Date | null;
  expires_at: Date;
}

interface OutboxEventRow {
  id: string;
  environment: string;
  scope_kind: string;
  scope_id: string;
  event_type: string;
  event_version: number;
  payload: unknown;
  correlation_id: string | null;
  idempotency_key: string | null;
  status: string;
  attempts: number;
  next_attempt_at: Date | null;
  created_at: Date;
  dispatched_at: Date | null;
  error_class: string | null;
  owner: string | null;
}

interface InboxEventRow {
  id: string;
  environment: string;
  source: string;
  source_event_id: string;
  event_type: string;
  payload: unknown;
  correlation_id: string | null;
  status: string;
  received_at: Date;
  processed_at: Date | null;
}

interface JobRow {
  id: string;
  environment: string;
  scope_kind: string;
  scope_id: string;
  type: string;
  payload_reference: string | null;
  status: string;
  available_at: Date;
  lease_owner: string | null;
  lease_expires_at: Date | null;
  attempt_count: number;
  max_attempts: number;
  last_error_class: string | null;
  correlation_id: string | null;
  created_at: Date;
  completed_at: Date | null;
}

// ─── PostgresIdempotencyStore ───────────────────────────────────────────────

export class PostgresIdempotencyStore implements AsyncIdempotencyStore {
  constructor(
    private readonly database: TransactionalDatabase,
    private readonly environment: Environment,
  ) {}

  async acquire(
    key: string,
    digest: Sha256Digest,
    now: Instant,
  ): Promise<Result<IdempotencyAcquireResult, CanonicalError>> {
    return this.database.transaction(async (session) => {
      // Attempt INSERT with ON CONFLICT DO NOTHING
      const insertResult = await session.query<IdempotencyKeyRow>(
        `INSERT INTO runtime.idempotency_keys (
           environment, scope_kind, scope_id, operation, key,
           material_request_digest, status, created_at, expires_at
         ) VALUES ($1, 'platform', 'platform', 'default', $2, $3, 'pending', $4, $5)
         ON CONFLICT (environment, scope_kind, scope_id, operation, key)
         DO NOTHING
         RETURNING *`,
        [this.environment, key, digest, asDate(now), asDate((now + 86_400_000) as Instant)],
      );

      if ((insertResult.rowCount ?? 0) > 0) {
        // New entry acquired
        const row = insertResult.rows[0]!;
        const entry = idempotencyEntryFromRow(row);
        return ok({ outcome: "acquired", entry } as IdempotencyAcquireResult);
      }

      // Existing row: SELECT it
      const selectResult = await session.query<IdempotencyKeyRow>(
        `SELECT * FROM runtime.idempotency_keys
         WHERE environment = $1
           AND scope_kind = 'platform'
           AND scope_id = 'platform'
           AND operation = 'default'
           AND key = $2
         FOR UPDATE`,
        [this.environment, key],
      );

      const existing = selectResult.rows[0];
      if (existing === undefined) {
        return err(
          createCanonicalError({
            category: "conflict",
            code: "CONFLICT",
            message: "Idempotency key conflict: row disappeared unexpectedly",
          }),
        );
      }

      const existingDigestResult = parseSha256Digest(existing.material_request_digest);
      if (!existingDigestResult.ok) {
        return err(
          createCanonicalError({
            category: "internal",
            code: "INTERNAL",
            message: "Corrupt idempotency key digest in database",
          }),
        );
      }

      // Compare digests
      if (!sha256DigestsEqual(existingDigestResult.value, digest)) {
        return ok({ outcome: "digest_conflict" } as IdempotencyAcquireResult);
      }

      // Same digest - check status
      if (existing.status === "completed") {
        return ok({
          outcome: "replay",
          responseSnapshot: existing.response_snapshot,
        } as IdempotencyAcquireResult);
      }

      if (existing.status === "pending") {
        return ok({ outcome: "in_flight" } as IdempotencyAcquireResult);
      }

      // status === "failed" with same digest: delete and re-insert
      await session.query(
        `DELETE FROM runtime.idempotency_keys
         WHERE environment = $1
           AND scope_kind = 'platform'
           AND scope_id = 'platform'
           AND operation = 'default'
           AND key = $2`,
        [this.environment, key],
      );

      const reInsertResult = await session.query<IdempotencyKeyRow>(
        `INSERT INTO runtime.idempotency_keys (
           environment, scope_kind, scope_id, operation, key,
           material_request_digest, status, created_at, expires_at
         ) VALUES ($1, 'platform', 'platform', 'default', $2, $3, 'pending', $4, $5)
         RETURNING *`,
        [this.environment, key, digest, asDate(now), asDate((now + 86_400_000) as Instant)],
      );

      const reInsertedRow = reInsertResult.rows[0]!;
      const entry = idempotencyEntryFromRow(reInsertedRow);
      return ok({ outcome: "acquired", entry } as IdempotencyAcquireResult);
    });
  }

  async complete(
    key: string,
    responseSnapshot: unknown,
    now: Instant,
  ): Promise<Result<void, CanonicalError>> {
    if (responseSnapshot === undefined) {
      return err(
        createCanonicalError({
          category: "validation",
          code: "INVALID_FORMAT",
          message:
            "responseSnapshot must not be undefined; use null or an empty object for no-content responses",
        }),
      );
    }

    const result = await this.database.query(
      `UPDATE runtime.idempotency_keys
       SET status = 'completed',
           response_snapshot = $3,
           completed_at = $4
       WHERE environment = $1
         AND scope_kind = 'platform'
         AND scope_id = 'platform'
         AND operation = 'default'
         AND key = $2
         AND status = 'pending'`,
      [this.environment, key, JSON.stringify(responseSnapshot), asDate(now)],
    );

    if ((result.rowCount ?? 0) === 0) {
      return err(
        createCanonicalError({
          category: "validation",
          code: "INVALID_FORMAT",
          message: "Idempotency key not found or not in pending state",
        }),
      );
    }

    return ok(undefined);
  }

  async fail(key: string): Promise<Result<void, CanonicalError>> {
    const result = await this.database.query(
      `UPDATE runtime.idempotency_keys
       SET status = 'failed',
           completed_at = clock_timestamp()
       WHERE environment = $1
         AND scope_kind = 'platform'
         AND scope_id = 'platform'
         AND operation = 'default'
         AND key = $2
         AND status = 'pending'`,
      [this.environment, key],
    );

    if ((result.rowCount ?? 0) === 0) {
      return err(
        createCanonicalError({
          category: "validation",
          code: "INVALID_FORMAT",
          message: "Idempotency key not found or not in pending state",
        }),
      );
    }

    return ok(undefined);
  }
}

// ─── PostgresOutboxRepository ───────────────────────────────────────────────

export class PostgresOutboxRepository implements AsyncOutboxRepository {
  constructor(private readonly database: TransactionalDatabase) {}

  async append(
    events: readonly OutboxEventInput[],
    now: Instant,
  ): Promise<Result<readonly OutboxEvent[], CanonicalError>> {
    const created: OutboxEvent[] = [];

    for (const input of events) {
      const result = await this.database.query<OutboxEventRow>(
        `INSERT INTO runtime.outbox_events (
           id, environment, scope_kind, scope_id, event_type, event_version,
           payload, correlation_id, idempotency_key, status, attempts,
           next_attempt_at, created_at
         ) VALUES ($1, 'local', 'platform', 'platform', $2, $3, $4, $5, $6, 'pending', 0, $7, $7)
         RETURNING *`,
        [
          input.id,
          input.eventType,
          input.eventVersion,
          JSON.stringify(input.payload),
          input.correlationId ?? null,
          input.idempotencyKey ?? null,
          asDate(now),
        ],
      );

      const row = result.rows[0];
      if (row !== undefined) {
        created.push(outboxEventFromRow(row));
      }
    }

    return ok(Object.freeze(created));
  }

  async claim(
    limit: number,
    owner: string,
    now: Instant,
  ): Promise<Result<readonly OutboxEvent[], CanonicalError>> {
    return this.database.transaction(async (session) => {
      // Select claimable events with FOR UPDATE SKIP LOCKED
      const selectResult = await session.query<OutboxEventRow>(
        `SELECT * FROM runtime.outbox_events
         WHERE status IN ('pending', 'failed')
           AND (next_attempt_at IS NULL OR next_attempt_at <= $1)
         ORDER BY created_at
         LIMIT $2
         FOR UPDATE SKIP LOCKED`,
        [asDate(now), limit],
      );

      const claimed: OutboxEvent[] = [];
      for (const row of selectResult.rows) {
        await session.query(
          `UPDATE runtime.outbox_events
           SET owner = $2
           WHERE id = $1`,
          [row.id, owner],
        );
        claimed.push(outboxEventFromRow({ ...row, owner }));
      }

      return ok(Object.freeze(claimed));
    });
  }

  async markDispatched(
    ids: readonly CounterId<"outbox-event">[],
    now: Instant,
  ): Promise<Result<void, CanonicalError>> {
    for (const id of ids) {
      const result = await this.database.query(
        `UPDATE runtime.outbox_events
         SET status = 'dispatched', dispatched_at = $2
         WHERE id = $1`,
        [id, asDate(now)],
      );
      if ((result.rowCount ?? 0) === 0) {
        return err(
          createCanonicalError({
            category: "validation",
            code: "INVALID_FORMAT",
            message: "Outbox event not found",
          }),
        );
      }
    }
    return ok(undefined);
  }

  async markFailed(
    id: CounterId<"outbox-event">,
    errorClass: string,
    now: Instant,
  ): Promise<Result<void, CanonicalError>> {
    // Atomic UPDATE: increment attempts and compute exponential backoff in a single statement
    const result = await this.database.query<{ attempts: number }>(
      `UPDATE runtime.outbox_events
       SET status = 'failed',
           attempts = attempts + 1,
           error_class = $2,
           next_attempt_at = $3::timestamptz + (interval '1 second' * power(2, attempts))
       WHERE id = $1
       RETURNING attempts`,
      [id, errorClass, asDate(now)],
    );

    if ((result.rowCount ?? 0) === 0) {
      return err(
        createCanonicalError({
          category: "validation",
          code: "INVALID_FORMAT",
          message: "Outbox event not found",
        }),
      );
    }

    return ok(undefined);
  }

  async markDeadLetter(
    id: CounterId<"outbox-event">,
    owner: string,
  ): Promise<Result<void, CanonicalError>> {
    const result = await this.database.query(
      `UPDATE runtime.outbox_events
       SET status = 'dead_letter', owner = $2
       WHERE id = $1`,
      [id, owner],
    );

    if ((result.rowCount ?? 0) === 0) {
      return err(
        createCanonicalError({
          category: "validation",
          code: "INVALID_FORMAT",
          message: "Outbox event not found",
        }),
      );
    }

    return ok(undefined);
  }
}

// ─── PostgresInboxRepository ────────────────────────────────────────────────

export class PostgresInboxRepository implements AsyncInboxRepository {
  constructor(private readonly database: TransactionalDatabase) {}

  async receive(
    input: InboxEventInput,
    now: Instant,
  ): Promise<Result<InboxReceiveResult, CanonicalError>> {
    // Use INSERT ... ON CONFLICT to detect duplicates atomically
    const result = await this.database.query<InboxEventRow>(
      `INSERT INTO runtime.inbox_events (
         id, environment, source, source_event_id, event_type,
         payload, correlation_id, status, received_at
       ) VALUES ($1, 'local', $2, $3, $4, $5, $6, 'received', $7)
       ON CONFLICT (environment, source, source_event_id)
       DO NOTHING
       RETURNING *`,
      [
        input.id,
        input.source,
        input.sourceEventId,
        input.eventType,
        JSON.stringify(input.payload),
        input.correlationId ?? null,
        asDate(now),
      ],
    );

    if ((result.rowCount ?? 0) === 0) {
      return ok({ outcome: "duplicate" } as InboxReceiveResult);
    }

    const row = result.rows[0]!;
    const event = inboxEventFromRow(row);
    return ok({ outcome: "new", event } as InboxReceiveResult);
  }

  async markProcessed(
    id: CounterId<"inbox-event">,
    now: Instant,
  ): Promise<Result<void, CanonicalError>> {
    const result = await this.database.query(
      `UPDATE runtime.inbox_events
       SET status = 'processed', processed_at = $2
       WHERE id = $1`,
      [id, asDate(now)],
    );

    if ((result.rowCount ?? 0) === 0) {
      return err(
        createCanonicalError({
          category: "validation",
          code: "INVALID_FORMAT",
          message: "Inbox event not found",
        }),
      );
    }

    return ok(undefined);
  }
}

// ─── PostgresJobRepository ──────────────────────────────────────────────────

export class PostgresJobRepository implements AsyncJobRepository {
  constructor(private readonly database: TransactionalDatabase) {}

  async enqueue(input: JobInput, now: Instant): Promise<Result<Job, CanonicalError>> {
    const result = await this.database.query<JobRow>(
      `INSERT INTO runtime.jobs (
         id, environment, scope_kind, scope_id, type, payload_reference,
         status, available_at, attempt_count, max_attempts,
         correlation_id, created_at
       ) VALUES ($1, 'local', 'platform', 'platform', $2, $3, 'available', $4, 0, $5, $6, $7)
       RETURNING *`,
      [
        input.id,
        input.type,
        input.payload !== undefined ? JSON.stringify(input.payload) : null,
        asDate(input.availableAt),
        input.maxAttempts,
        input.correlationId ?? null,
        asDate(now),
      ],
    );

    const row = result.rows[0];
    if (row === undefined) {
      return err(
        createCanonicalError({
          category: "internal",
          code: "INTERNAL",
          message: "Failed to insert job",
        }),
      );
    }

    return ok(jobFromRow(row));
  }

  async claim(
    types: readonly string[],
    leaseOwner: string,
    leaseDurationMs: number,
    now: Instant,
    limit: number = 10,
  ): Promise<Result<readonly Job[], CanonicalError>> {
    return this.database.transaction(async (session) => {
      const leaseExpiresAt = new Date(now + leaseDurationMs);

      // Pre-claim sweep: transition expired-lease jobs back to available
      await session.query(
        `UPDATE runtime.jobs
         SET status = 'available',
             lease_owner = NULL,
             lease_expires_at = NULL
         WHERE status = 'leased'
           AND type = ANY($1)
           AND lease_expires_at < $2`,
        [types as unknown as string[], asDate(now)],
      );

      // Select available jobs with FOR UPDATE SKIP LOCKED
      const selectResult = await session.query<JobRow>(
        `SELECT * FROM runtime.jobs
         WHERE status = 'available'
           AND type = ANY($1)
           AND available_at <= $2
         ORDER BY available_at
         LIMIT $3
         FOR UPDATE SKIP LOCKED`,
        [types as unknown as string[], asDate(now), limit],
      );

      const claimed: Job[] = [];
      for (const row of selectResult.rows) {
        const newAttemptCount = row.attempt_count + 1;

        await session.query(
          `UPDATE runtime.jobs
           SET status = 'leased',
               lease_owner = $2,
               lease_expires_at = $3,
               attempt_count = $4
           WHERE id = $1`,
          [row.id, leaseOwner, leaseExpiresAt, newAttemptCount],
        );

        // Record the attempt
        await session.query(
          `INSERT INTO runtime.job_attempts (
             job_id, attempt_number, started_at, status
           ) VALUES ($1, $2, $3, 'running')`,
          [row.id, newAttemptCount, asDate(now)],
        );

        claimed.push(
          jobFromRow({
            ...row,
            status: "leased",
            lease_owner: leaseOwner,
            lease_expires_at: leaseExpiresAt,
            attempt_count: newAttemptCount,
          }),
        );
      }

      return ok(Object.freeze(claimed));
    });
  }

  async renewLease(
    id: CounterId<"job">,
    owner: string,
    leaseDurationMs: number,
    now: Instant,
  ): Promise<Result<void, CanonicalError>> {
    const leaseExpiresAt = new Date(now + leaseDurationMs);
    const result = await this.database.query(
      `UPDATE runtime.jobs
       SET lease_expires_at = $3
       WHERE id = $1
         AND status = 'leased'
         AND lease_owner = $2`,
      [id, owner, leaseExpiresAt],
    );

    if ((result.rowCount ?? 0) === 0) {
      return err(
        createCanonicalError({
          category: "conflict",
          code: "CONFLICT",
          message: "Job is not leased by the specified owner",
        }),
      );
    }

    return ok(undefined);
  }

  async complete(
    id: CounterId<"job">,
    owner: string,
    now: Instant,
  ): Promise<Result<void, CanonicalError>> {
    return this.database.transaction(async (session) => {
      const result = await session.query<JobRow>(
        `UPDATE runtime.jobs
         SET status = 'completed',
             completed_at = $3,
             lease_owner = NULL,
             lease_expires_at = NULL
         WHERE id = $1
           AND status = 'leased'
           AND lease_owner = $2
         RETURNING *`,
        [id, owner, asDate(now)],
      );

      if ((result.rowCount ?? 0) === 0) {
        return err(
          createCanonicalError({
            category: "conflict",
            code: "CONFLICT",
            message: "Job is not leased by the specified owner",
          }),
        );
      }

      const row = result.rows[0]!;
      // Mark the current attempt as succeeded
      await session.query(
        `UPDATE runtime.job_attempts
         SET status = 'succeeded', completed_at = $3
         WHERE job_id = $1 AND attempt_number = $2`,
        [id, row.attempt_count, asDate(now)],
      );

      return ok(undefined);
    });
  }

  async fail(
    id: CounterId<"job">,
    owner: string,
    errorClass: string,
    errorMessage: string,
    baseDelayMs: number,
    now: Instant,
  ): Promise<Result<void, CanonicalError>> {
    return this.database.transaction(async (session) => {
      // Get the job to check ownership and determine next state
      const selectResult = await session.query<JobRow>(
        `SELECT * FROM runtime.jobs
         WHERE id = $1
           AND status = 'leased'
           AND lease_owner = $2
         FOR UPDATE`,
        [id, owner],
      );

      const row = selectResult.rows[0];
      if (row === undefined) {
        return err(
          createCanonicalError({
            category: "conflict",
            code: "CONFLICT",
            message: "Job is not leased by the specified owner",
          }),
        );
      }

      // Mark the current attempt as failed
      await session.query(
        `UPDATE runtime.job_attempts
         SET status = 'failed', completed_at = $3, error_class = $4, error_message = $5
         WHERE job_id = $1 AND attempt_number = $2`,
        [id, row.attempt_count, asDate(now), errorClass, errorMessage],
      );

      // If max attempts reached, move to dead_letter
      if (row.attempt_count >= row.max_attempts) {
        await session.query(
          `UPDATE runtime.jobs
           SET status = 'dead_letter',
               last_error_class = $2,
               lease_owner = NULL,
               lease_expires_at = NULL
           WHERE id = $1`,
          [id, errorClass],
        );
        return ok(undefined);
      }

      // Exponential backoff: baseDelay * 2^(attemptCount - 1)
      const backoffMs = baseDelayMs * Math.pow(2, row.attempt_count - 1);
      const nextAvailableAt = new Date(now + backoffMs);

      await session.query(
        `UPDATE runtime.jobs
         SET status = 'available',
             last_error_class = $2,
             lease_owner = NULL,
             lease_expires_at = NULL,
             available_at = $3
         WHERE id = $1`,
        [id, errorClass, nextAvailableAt],
      );

      return ok(undefined);
    });
  }

  async deadLetter(
    id: CounterId<"job">,
    owner: string,
    reason: string,
  ): Promise<Result<void, CanonicalError>> {
    const result = await this.database.query(
      `UPDATE runtime.jobs
       SET status = 'dead_letter',
           last_error_class = $3,
           lease_owner = NULL,
           lease_expires_at = NULL
       WHERE id = $1
         AND status = 'leased'
         AND lease_owner = $2`,
      [id, owner, reason],
    );

    if ((result.rowCount ?? 0) === 0) {
      return err(
        createCanonicalError({
          category: "conflict",
          code: "CONFLICT",
          message: "Job is not leased by the specified owner",
        }),
      );
    }

    return ok(undefined);
  }
}

// ─── Row Mapping Helpers ────────────────────────────────────────────────────

function asDate(value: Instant): Date {
  return new Date(value);
}

function instantFromDate(value: Date): Instant {
  const result = instantFromEpochMilliseconds(value.getTime());
  if (!result.ok) {
    throw new Error("Persisted runtime record contains invalid timestamp");
  }
  return result.value;
}

function optionalInstantFromDate(value: Date | null): Instant | undefined {
  return value === null ? undefined : instantFromDate(value);
}

function idempotencyEntryFromRow(row: IdempotencyKeyRow): IdempotencyEntry {
  const digestResult = parseSha256Digest(row.material_request_digest);
  if (!digestResult.ok) {
    throw new Error("Persisted idempotency key contains invalid digest");
  }
  return Object.freeze({
    key: row.key,
    digest: digestResult.value,
    status: row.status as IdempotencyKeyStatus,
    responseSnapshot: row.response_snapshot ?? undefined,
    createdAt: instantFromDate(row.created_at),
    completedAt: optionalInstantFromDate(row.completed_at),
  });
}

function outboxEventFromRow(row: OutboxEventRow): OutboxEvent {
  return Object.freeze({
    id: row.id as CounterId<"outbox-event">,
    eventType: row.event_type,
    eventVersion: row.event_version,
    payload: row.payload,
    correlationId: (row.correlation_id as CounterId<"correlation"> | null) ?? undefined,
    idempotencyKey: row.idempotency_key ?? undefined,
    status: row.status as OutboxEvent["status"],
    attempts: row.attempts,
    nextAttemptAt: optionalInstantFromDate(row.next_attempt_at),
    createdAt: instantFromDate(row.created_at),
    dispatchedAt: optionalInstantFromDate(row.dispatched_at),
    errorClass: row.error_class ?? undefined,
    owner: row.owner ?? undefined,
  });
}

function inboxEventFromRow(row: InboxEventRow): InboxEvent {
  return Object.freeze({
    id: row.id as CounterId<"inbox-event">,
    source: row.source,
    sourceEventId: row.source_event_id,
    eventType: row.event_type,
    payload: row.payload,
    correlationId: (row.correlation_id as CounterId<"correlation"> | null) ?? undefined,
    status: row.status as InboxEvent["status"],
    receivedAt: instantFromDate(row.received_at),
    processedAt: optionalInstantFromDate(row.processed_at),
  });
}

function jobFromRow(row: JobRow): Job {
  return Object.freeze({
    id: row.id as CounterId<"job">,
    type: row.type,
    payload:
      row.payload_reference !== null ? (JSON.parse(row.payload_reference) as unknown) : undefined,
    correlationId: (row.correlation_id as CounterId<"correlation"> | null) ?? undefined,
    status: row.status as Job["status"],
    availableAt: instantFromDate(row.available_at),
    leaseOwner: row.lease_owner ?? undefined,
    leaseExpiresAt: optionalInstantFromDate(row.lease_expires_at),
    attemptCount: row.attempt_count,
    maxAttempts: row.max_attempts,
    lastErrorClass: row.last_error_class ?? undefined,
    createdAt: instantFromDate(row.created_at),
    completedAt: optionalInstantFromDate(row.completed_at),
  });
}

// ─── PostgresStepLedger ──────────────────────────────────────────────────────

/**
 * A durable, per-step outcome for one external-effect leg of the transaction
 * lifecycle. Recorded keyed on (idempotencyKey, step) so a retry after a WORKER
 * RESTART resumes from the last completed step instead of re-driving it.
 *
 * SECURITY: `reference` and `snapshot` carry provider references (order ids)
 * and terminal status only — never raw payment credentials, PAN, CVV, UPI PIN,
 * access tokens, or key secrets.
 */
export interface StepLedgerEntry {
  readonly step: string;
  readonly status: "completed" | "declined";
  readonly reference: string | undefined;
  readonly snapshot: unknown;
}

/**
 * Async durable step ledger. `lookup` returns a previously recorded outcome for
 * (key, step) or `undefined`. `record` persists a terminal step outcome exactly
 * once; a racing concurrent writer loses the INSERT and the recorded outcome is
 * returned instead. Only terminal outcomes ('completed' / 'declined') are
 * persisted — an indeterminate step is never recorded so a later attempt can
 * re-drive it to resolve the unknown state.
 */
export interface AsyncStepLedger {
  lookup(key: string, step: string): Promise<Result<StepLedgerEntry | undefined, CanonicalError>>;
  record(
    key: string,
    entry: StepLedgerEntry,
    now: Instant,
  ): Promise<Result<StepLedgerEntry, CanonicalError>>;
  /**
   * Durable pre-claim of an external-effect step. Atomically inserts a claim row
   * for (key, `${step}.claim`) under the SAME UNIQUE(environment, idempotency_key,
   * step) index and reports whether THIS caller won the insert. Only the winner
   * is authorised to drive the external effect (e.g. draftOrderCreate); a racing
   * loser observes `won=false` and must resolve the effect from the durable
   * ledger instead of creating a second one. This closes the cross-instance race
   * on effects (like the Shopify draft) that have no provider-side idempotency,
   * because the connector's in-memory idempotency store is not shared between
   * worker instances. The claim row carries NO reference and status 'completed'
   * (a claim is itself a terminal fact); the real outcome is still recorded on
   * the base `step`.
   */
  claim(
    key: string,
    step: string,
    now: Instant,
  ): Promise<Result<{ readonly won: boolean }, CanonicalError>>;
}

interface LifecycleStepRow {
  id: string;
  environment: string;
  idempotency_key: string;
  step: string;
  status: string;
  reference: string | null;
  snapshot: unknown;
  created_at: Date;
  completed_at: Date | null;
}

function stepEntryFromRow(row: LifecycleStepRow): StepLedgerEntry {
  return Object.freeze({
    step: row.step,
    status: row.status as StepLedgerEntry["status"],
    reference: row.reference ?? undefined,
    snapshot: row.snapshot ?? undefined,
  });
}

export class PostgresStepLedger implements AsyncStepLedger {
  constructor(
    private readonly database: TransactionalDatabase,
    private readonly environment: Environment,
  ) {}

  async lookup(
    key: string,
    step: string,
  ): Promise<Result<StepLedgerEntry | undefined, CanonicalError>> {
    const result = await this.database.query<LifecycleStepRow>(
      `SELECT * FROM runtime.lifecycle_steps
       WHERE environment = $1 AND idempotency_key = $2 AND step = $3`,
      [this.environment, key, step],
    );
    const row = result.rows[0];
    return ok(row === undefined ? undefined : stepEntryFromRow(row));
  }

  async record(
    key: string,
    entry: StepLedgerEntry,
    now: Instant,
  ): Promise<Result<StepLedgerEntry, CanonicalError>> {
    // Insert the terminal step outcome exactly once. A racing concurrent writer
    // loses the INSERT (ON CONFLICT DO NOTHING); we then read the winner's row
    // so both callers observe the SAME durable outcome and neither re-drives.
    const insert = await this.database.query<LifecycleStepRow>(
      `INSERT INTO runtime.lifecycle_steps (
         environment, idempotency_key, step, status, reference, snapshot,
         created_at, completed_at
       ) VALUES ($1, $2, $3, $4, $5, $6, $7, $7)
       ON CONFLICT (environment, idempotency_key, step) DO NOTHING
       RETURNING *`,
      [
        this.environment,
        key,
        entry.step,
        entry.status,
        entry.reference ?? null,
        entry.snapshot === undefined ? null : JSON.stringify(entry.snapshot),
        asDate(now),
      ],
    );

    const inserted = insert.rows[0];
    if (inserted !== undefined) {
      return ok(stepEntryFromRow(inserted));
    }

    const existing = await this.database.query<LifecycleStepRow>(
      `SELECT * FROM runtime.lifecycle_steps
       WHERE environment = $1 AND idempotency_key = $2 AND step = $3`,
      [this.environment, key, entry.step],
    );
    const row = existing.rows[0];
    if (row === undefined) {
      return err(
        createCanonicalError({
          category: "conflict",
          code: "CONFLICT",
          message: "Lifecycle step ledger row disappeared unexpectedly",
        }),
      );
    }
    return ok(stepEntryFromRow(row));
  }

  async claim(
    key: string,
    step: string,
    now: Instant,
  ): Promise<Result<{ readonly won: boolean }, CanonicalError>> {
    // Atomic pre-claim: insert a claim row for `${step}.claim`. A RETURNING row
    // means THIS caller won the insert (and may drive the external effect); an
    // empty result means a concurrent caller already claimed it (loser). The
    // claim row is itself a terminal fact, so status 'completed' satisfies the
    // CHECK constraint; it carries no reference.
    const insert = await this.database.query<{ id: string }>(
      `INSERT INTO runtime.lifecycle_steps (
         environment, idempotency_key, step, status, reference, snapshot,
         created_at, completed_at
       ) VALUES ($1, $2, $3, 'completed', NULL, NULL, $4, $4)
       ON CONFLICT (environment, idempotency_key, step) DO NOTHING
       RETURNING id`,
      [this.environment, key, `${step}.claim`, asDate(now)],
    );
    return ok({ won: insert.rows[0] !== undefined });
  }
}

// ─── PostgresKillSwitchStore ─────────────────────────────────────────────────

/**
 * Kill-switch scopes. Kept in sync with the vocabulary in
 * `@counter/observability` (KILL_SWITCH_SCOPES); it is duplicated locally rather
 * than imported so `@counter/data` does not take a new package dependency edge
 * that would violate dependency-cruiser. Any change here MUST mirror
 * packages/observability/src/kill-switch.ts and the migration 0008 CHECK.
 */
export const KILL_SWITCH_SCOPES = [
  "platform",
  "merchant",
  "wallet",
  "agent",
  "mandate",
  "connector",
  "payment_adapter",
] as const;

export type KillSwitchScope = (typeof KILL_SWITCH_SCOPES)[number];

/**
 * A durable kill-switch row. `entityId` is `undefined` (NULL) for a
 * platform-wide switch and the target entity id for a scoped switch.
 *
 * SECURITY: carries only operator metadata (reason, activatedBy) and the
 * scope/entity target — never credentials or secrets.
 */
export interface KillSwitchRow {
  readonly scope: KillSwitchScope;
  readonly entityId: string | undefined;
  readonly status: "active" | "inactive";
  readonly reason: string;
  readonly activatedBy: string;
  readonly activatedAt: Instant;
  readonly expiresAt: Instant | undefined;
}

/** Input for activating (upserting) a kill switch. */
export interface KillSwitchActivateInput {
  readonly scope: KillSwitchScope;
  readonly entityId?: string | undefined;
  readonly reason: string;
  readonly activatedBy: string;
  readonly expiresAt?: Instant | undefined;
}

/**
 * Async durable kill-switch store. A switch is ACTIVE when
 * status = 'active' AND (expires_at IS NULL OR expires_at > now); an expired
 * row is inert without any sweep. `isActive` is the pre-effect gate the worker
 * consults before any consequential external effect.
 */
export interface AsyncKillSwitchStore {
  recordActivate(
    input: KillSwitchActivateInput,
    now: Instant,
  ): Promise<Result<KillSwitchRow, CanonicalError>>;
  deactivate(
    scope: KillSwitchScope,
    entityId: string | undefined,
  ): Promise<Result<void, CanonicalError>>;
  listActive(now: Instant): Promise<Result<readonly KillSwitchRow[], CanonicalError>>;
  isActive(
    scope: KillSwitchScope,
    entityId: string | undefined,
    now: Instant,
  ): Promise<Result<boolean, CanonicalError>>;
}

interface KillSwitchDbRow {
  id: string;
  environment: string;
  scope: string;
  entity_id: string | null;
  status: string;
  reason: string;
  activated_by: string;
  activated_at: Date;
  expires_at: Date | null;
}

function killSwitchRowFromDb(row: KillSwitchDbRow): KillSwitchRow {
  return Object.freeze({
    scope: row.scope as KillSwitchScope,
    entityId: row.entity_id ?? undefined,
    status: row.status as KillSwitchRow["status"],
    reason: row.reason,
    activatedBy: row.activated_by,
    activatedAt: instantFromDate(row.activated_at),
    expiresAt: optionalInstantFromDate(row.expires_at),
  });
}

/**
 * Postgres-backed durable kill-switch store over `runtime.kill_switches`.
 * Mirrors the PostgresStepLedger / PostgresIdempotencyStore style (Result
 * returns, Instant times, explicit environment scope).
 */
export class PostgresKillSwitchStore implements AsyncKillSwitchStore {
  constructor(
    private readonly database: TransactionalDatabase,
    private readonly environment: Environment,
  ) {}

  async recordActivate(
    input: KillSwitchActivateInput,
    now: Instant,
  ): Promise<Result<KillSwitchRow, CanonicalError>> {
    // Platform switches carry no entity; scoped switches must name one. The two
    // partial unique indexes require a matching ON CONFLICT target, so branch on
    // whether entity_id is NULL.
    const entityId = input.scope === "platform" ? null : (input.entityId ?? null);
    if (input.scope !== "platform" && (entityId === null || entityId.length === 0)) {
      return err(
        createCanonicalError({
          category: "validation",
          code: "INVALID_FORMAT",
          message: `Kill switch scope '${input.scope}' requires an entityId`,
        }),
      );
    }

    const conflictTarget =
      entityId === null
        ? "(environment, scope) WHERE entity_id IS NULL"
        : "(environment, scope, entity_id) WHERE entity_id IS NOT NULL";

    const result = await this.database.query<KillSwitchDbRow>(
      `INSERT INTO runtime.kill_switches (
         environment, scope, entity_id, status, reason, activated_by, activated_at, expires_at
       ) VALUES ($1, $2, $3, 'active', $4, $5, $6, $7)
       ON CONFLICT ${conflictTarget} DO UPDATE SET
         status = 'active',
         reason = EXCLUDED.reason,
         activated_by = EXCLUDED.activated_by,
         activated_at = EXCLUDED.activated_at,
         expires_at = EXCLUDED.expires_at
       RETURNING *`,
      [
        this.environment,
        input.scope,
        entityId,
        input.reason,
        input.activatedBy,
        asDate(now),
        input.expiresAt === undefined ? null : asDate(input.expiresAt),
      ],
    );
    const row = result.rows[0];
    if (row === undefined) {
      return err(
        createCanonicalError({
          category: "conflict",
          code: "CONFLICT",
          message: "Kill switch row disappeared unexpectedly after upsert",
        }),
      );
    }
    return ok(killSwitchRowFromDb(row));
  }

  async deactivate(
    scope: KillSwitchScope,
    entityId: string | undefined,
  ): Promise<Result<void, CanonicalError>> {
    if (entityId === undefined) {
      await this.database.query(
        `UPDATE runtime.kill_switches SET status = 'inactive'
         WHERE environment = $1 AND scope = $2 AND entity_id IS NULL`,
        [this.environment, scope],
      );
    } else {
      await this.database.query(
        `UPDATE runtime.kill_switches SET status = 'inactive'
         WHERE environment = $1 AND scope = $2 AND entity_id = $3`,
        [this.environment, scope, entityId],
      );
    }
    return ok(undefined);
  }

  async listActive(now: Instant): Promise<Result<readonly KillSwitchRow[], CanonicalError>> {
    const result = await this.database.query<KillSwitchDbRow>(
      `SELECT * FROM runtime.kill_switches
       WHERE environment = $1 AND status = 'active'
         AND (expires_at IS NULL OR expires_at > $2)
       ORDER BY id`,
      [this.environment, asDate(now)],
    );
    return ok(result.rows.map(killSwitchRowFromDb));
  }

  async isActive(
    scope: KillSwitchScope,
    entityId: string | undefined,
    now: Instant,
  ): Promise<Result<boolean, CanonicalError>> {
    const nowDate = asDate(now);
    const result =
      entityId === undefined
        ? await this.database.query<{ present: boolean }>(
            `SELECT EXISTS (
               SELECT 1 FROM runtime.kill_switches
               WHERE environment = $1 AND scope = $2 AND entity_id IS NULL
                 AND status = 'active' AND (expires_at IS NULL OR expires_at > $3)
             ) AS present`,
            [this.environment, scope, nowDate],
          )
        : await this.database.query<{ present: boolean }>(
            `SELECT EXISTS (
               SELECT 1 FROM runtime.kill_switches
               WHERE environment = $1 AND scope = $2 AND entity_id = $3
                 AND status = 'active' AND (expires_at IS NULL OR expires_at > $4)
             ) AS present`,
            [this.environment, scope, entityId, nowDate],
          );
    return ok(result.rows[0]?.present === true);
  }
}
