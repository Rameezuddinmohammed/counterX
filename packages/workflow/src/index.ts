/**
 * packages/workflow
 *
 * Transaction state machine, idempotency scopes, outbox/inbox tables, and
 * leased PostgreSQL jobs (see design.md "Transaction and workflow design").
 */

export const PACKAGE_NAME = "@counter/workflow";

export * from "./idempotency-store.js";
export * from "./in-memory-idempotency-store.js";
export * from "./inbox-repository.js";
export * from "./in-memory-inbox-repository.js";
export * from "./job-repository.js";
export * from "./in-memory-job-repository.js";
export * from "./outbox-repository.js";
export * from "./in-memory-outbox-repository.js";
export * from "./phases.js";
export * from "./transaction-state.js";
export * from "./transition-error.js";
export * from "./transition-rules.js";
export * from "./transitions.js";
