/**
 * Action write operation ports.
 *
 * Typed interfaces for executing write operations with idempotency,
 * preconditions, and timeout semantics. Actions return observations of
 * what happened externally - they never mutate domain state directly.
 */

import type { ExternalReference, Instant } from "@counter/domain";

import type { ConnectorError } from "./errors.js";

// ─── Timeout Semantics ────────────────────────────────────────────────────────

/**
 * Timeout semantics:
 * - "before_effect": The timeout occurred before the action took effect.
 *   Safe to retry without risk of duplicate effects.
 * - "after_effect": The timeout occurred after the action may have taken effect.
 *   Must query to determine the outcome before retrying.
 */
export type TimeoutSemantics = "before_effect" | "after_effect";

// ─── Preconditions ────────────────────────────────────────────────────────────

export const PRECONDITION_TYPES = [
  "version_match",
  "state_match",
  "exists",
  "not_exists",
] as const;
export type PreconditionType = (typeof PRECONDITION_TYPES)[number];

export interface Precondition {
  readonly type: PreconditionType;
  readonly field: string;
  readonly expected: string;
}

// ─── Action Input ─────────────────────────────────────────────────────────────

export interface ActionInput<T> {
  readonly payload: T;
  readonly idempotencyKey: string;
  readonly correlationId: string;
  readonly preconditions: readonly Precondition[];
  readonly timeoutMs: number;
}

// ─── Action Outcome ───────────────────────────────────────────────────────────

export interface ActionSucceeded<T> {
  readonly status: "succeeded";
  readonly result: T;
  readonly effectTime: Instant;
  readonly sourceReference: ExternalReference;
}

export interface ActionFailed {
  readonly status: "failed";
  readonly error: ConnectorError;
}

export interface ActionIndeterminate {
  readonly status: "indeterminate";
  readonly correlationId: string;
  readonly lastKnownState: string | undefined;
}

export type ActionOutcome<T> = ActionSucceeded<T> | ActionFailed | ActionIndeterminate;

// ─── Port ─────────────────────────────────────────────────────────────────────

export interface ActionPort<TInput, TResult> {
  execute(input: ActionInput<TInput>): Promise<ActionOutcome<TResult>>;
  query(correlationId: string): Promise<ActionOutcome<TResult> | null>;
}
