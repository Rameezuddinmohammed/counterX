/**
 * apps/worker
 *
 * Outbox/job worker process: leases PostgreSQL jobs, invokes typed
 * adapters, runs reconciliation, and issues receipts (see design.md
 * "PostgreSQL jobs"). Implemented starting in task 10; this placeholder
 * proves the app builds, type-checks, and tests through the toolchain.
 */

export const APP_NAME = "@counter/worker";
