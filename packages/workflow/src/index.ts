/**
 * @counter/workflow
 *
 * Transaction state machine, idempotency scopes, outbox/inbox tables, and
 * leased PostgreSQL jobs (see design.md "Transaction and workflow design").
 */

export const PACKAGE_NAME = "@counter/workflow";

export * from "./phases.js";
export * from "./transaction-state.js";
export * from "./transition-error.js";
export * from "./transition-rules.js";
export * from "./transitions.js";
