/**
 * Drizzle schema definitions for the runtime infrastructure tables.
 *
 * These serve as a reference for the table structure. Actual queries are
 * performed via raw SQL through the DatabaseSession interface.
 */

import { sql } from "drizzle-orm";
import {
  check,
  integer,
  jsonb,
  pgSchema,
  text,
  timestamp,
  unique,
  bigint,
} from "drizzle-orm/pg-core";
import { counterEnvironment } from "./schema.js";

export const runtimeSchema = pgSchema("runtime");

// ─── Idempotency Keys ───────────────────────────────────────────────────────

export const idempotencyKeys = runtimeSchema.table(
  "idempotency_keys",
  {
    id: bigint("id", { mode: "number" }).generatedAlwaysAsIdentity().primaryKey(),
    environment: counterEnvironment("environment").notNull(),
    scopeKind: text("scope_kind").notNull(),
    scopeId: text("scope_id").notNull(),
    operation: text("operation").notNull(),
    key: text("key").notNull(),
    materialRequestDigest: text("material_request_digest").notNull(),
    status: text("status").notNull().default("pending"),
    responseSnapshot: jsonb("response_snapshot"),
    createdAt: timestamp("created_at", { withTimezone: true, mode: "date" })
      .notNull()
      .default(sql`clock_timestamp()`),
    completedAt: timestamp("completed_at", { withTimezone: true, mode: "date" }),
    expiresAt: timestamp("expires_at", { withTimezone: true, mode: "date" }).notNull(),
  },
  (table) => [
    unique("idempotency_keys_natural_key").on(
      table.environment,
      table.scopeKind,
      table.scopeId,
      table.operation,
      table.key,
    ),
    check(
      "idempotency_keys_scope_kind",
      sql`${table.scopeKind} IN ('merchant', 'wallet', 'platform')`,
    ),
    check("idempotency_keys_status", sql`${table.status} IN ('pending', 'completed', 'failed')`),
    check(
      "idempotency_keys_digest_format",
      sql`${table.materialRequestDigest} ~ '^sha256:[0-9a-f]{64}$'`,
    ),
  ],
);

// ─── Workflow Intents ────────────────────────────────────────────────────────

export const workflowIntents = runtimeSchema.table(
  "workflow_intents",
  {
    id: text("id").primaryKey(),
    transactionId: text("transaction_id").notNull(),
    environment: counterEnvironment("environment").notNull(),
    scopeKind: text("scope_kind").notNull(),
    scopeId: text("scope_id").notNull(),
    commandType: text("command_type").notNull(),
    commandDigest: text("command_digest").notNull(),
    authorityContext: jsonb("authority_context").notNull(),
    status: text("status").notNull().default("pending"),
    createdAt: timestamp("created_at", { withTimezone: true, mode: "date" })
      .notNull()
      .default(sql`clock_timestamp()`),
  },
  (table) => [
    unique("workflow_intents_dedup").on(
      table.environment,
      table.transactionId,
      table.commandType,
      table.commandDigest,
    ),
    check(
      "workflow_intents_scope_kind",
      sql`${table.scopeKind} IN ('merchant', 'wallet', 'platform')`,
    ),
    check(
      "workflow_intents_status",
      sql`${table.status} IN ('pending', 'executing', 'completed', 'failed')`,
    ),
  ],
);

// ─── Outbox Events ──────────────────────────────────────────────────────────

export const outboxEvents = runtimeSchema.table(
  "outbox_events",
  {
    id: text("id").primaryKey(),
    environment: counterEnvironment("environment").notNull(),
    scopeKind: text("scope_kind").notNull(),
    scopeId: text("scope_id").notNull(),
    eventType: text("event_type").notNull(),
    eventVersion: integer("event_version").notNull().default(1),
    payload: jsonb("payload").notNull(),
    correlationId: text("correlation_id"),
    idempotencyKey: text("idempotency_key"),
    status: text("status").notNull().default("pending"),
    attempts: integer("attempts").notNull().default(0),
    nextAttemptAt: timestamp("next_attempt_at", { withTimezone: true, mode: "date" }),
    createdAt: timestamp("created_at", { withTimezone: true, mode: "date" })
      .notNull()
      .default(sql`clock_timestamp()`),
    dispatchedAt: timestamp("dispatched_at", { withTimezone: true, mode: "date" }),
    errorClass: text("error_class"),
    owner: text("owner"),
  },
  (table) => [
    check(
      "outbox_events_scope_kind",
      sql`${table.scopeKind} IN ('merchant', 'wallet', 'platform')`,
    ),
    check(
      "outbox_events_status",
      sql`${table.status} IN ('pending', 'dispatched', 'failed', 'dead_letter')`,
    ),
    check("outbox_events_event_version_positive", sql`${table.eventVersion} >= 1`),
    check("outbox_events_attempts_non_negative", sql`${table.attempts} >= 0`),
  ],
);

// ─── Inbox Events ───────────────────────────────────────────────────────────

export const inboxEvents = runtimeSchema.table(
  "inbox_events",
  {
    id: text("id").primaryKey(),
    environment: counterEnvironment("environment").notNull(),
    source: text("source").notNull(),
    sourceEventId: text("source_event_id").notNull(),
    eventType: text("event_type").notNull(),
    payload: jsonb("payload").notNull(),
    correlationId: text("correlation_id"),
    status: text("status").notNull().default("received"),
    receivedAt: timestamp("received_at", { withTimezone: true, mode: "date" })
      .notNull()
      .default(sql`clock_timestamp()`),
    processedAt: timestamp("processed_at", { withTimezone: true, mode: "date" }),
  },
  (table) => [
    unique("inbox_events_dedup").on(table.environment, table.source, table.sourceEventId),
    check("inbox_events_status", sql`${table.status} IN ('received', 'processed', 'duplicate')`),
  ],
);

// ─── Jobs ───────────────────────────────────────────────────────────────────

export const jobs = runtimeSchema.table(
  "jobs",
  {
    id: text("id").primaryKey(),
    environment: counterEnvironment("environment").notNull(),
    scopeKind: text("scope_kind").notNull(),
    scopeId: text("scope_id").notNull(),
    type: text("type").notNull(),
    payloadReference: text("payload_reference"),
    status: text("status").notNull().default("available"),
    availableAt: timestamp("available_at", { withTimezone: true, mode: "date" })
      .notNull()
      .default(sql`clock_timestamp()`),
    leaseOwner: text("lease_owner"),
    leaseExpiresAt: timestamp("lease_expires_at", { withTimezone: true, mode: "date" }),
    attemptCount: integer("attempt_count").notNull().default(0),
    maxAttempts: integer("max_attempts").notNull().default(5),
    lastErrorClass: text("last_error_class"),
    correlationId: text("correlation_id"),
    createdAt: timestamp("created_at", { withTimezone: true, mode: "date" })
      .notNull()
      .default(sql`clock_timestamp()`),
    completedAt: timestamp("completed_at", { withTimezone: true, mode: "date" }),
  },
  (table) => [
    check("jobs_scope_kind", sql`${table.scopeKind} IN ('merchant', 'wallet', 'platform')`),
    check(
      "jobs_status",
      sql`${table.status} IN ('available', 'leased', 'completed', 'failed', 'dead_letter')`,
    ),
    check("jobs_attempt_count_non_negative", sql`${table.attemptCount} >= 0`),
    check("jobs_max_attempts_positive", sql`${table.maxAttempts} >= 1`),
  ],
);

// ─── Job Attempts ───────────────────────────────────────────────────────────

export const jobAttempts = runtimeSchema.table(
  "job_attempts",
  {
    id: bigint("id", { mode: "number" }).generatedAlwaysAsIdentity().primaryKey(),
    jobId: text("job_id").notNull(),
    attemptNumber: integer("attempt_number").notNull(),
    startedAt: timestamp("started_at", { withTimezone: true, mode: "date" })
      .notNull()
      .default(sql`clock_timestamp()`),
    completedAt: timestamp("completed_at", { withTimezone: true, mode: "date" }),
    status: text("status").notNull().default("running"),
    errorClass: text("error_class"),
    errorMessage: text("error_message"),
  },
  (table) => [
    unique("job_attempts_unique").on(table.jobId, table.attemptNumber),
    check("job_attempts_status", sql`${table.status} IN ('running', 'succeeded', 'failed')`),
    check("job_attempts_attempt_number_positive", sql`${table.attemptNumber} >= 1`),
  ],
);
