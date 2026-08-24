/**
 * Merchant lifecycle state machine.
 *
 * Defines the canonical set of lifecycle states a merchant passes through,
 * valid transitions between them, and the pure transition function that
 * validates and produces immutable transition records.
 */

import type { ActorReference, CounterId, Instant, Sha256Digest, Result } from "@counter/domain";
import { createCanonicalError, ok, err } from "@counter/domain";

// ─── Lifecycle States ───────────────────────────────────────────────────────

export const MERCHANT_LIFECYCLE_STATES = [
  "DRAFT",
  "CONNECTING",
  "MAPPING",
  "VERIFYING",
  "SANDBOX_READY",
  "ACTIVATION_REVIEW",
  "ACTIVE",
  "ACTIVE_DEGRADED",
  "SUSPENDED",
  "OFFBOARDING",
  "CLOSED",
] as const;

export type MerchantLifecycleState = (typeof MERCHANT_LIFECYCLE_STATES)[number];

const lifecycleStateSet: ReadonlySet<string> = new Set(MERCHANT_LIFECYCLE_STATES);

export function isMerchantLifecycleState(value: unknown): value is MerchantLifecycleState {
  return typeof value === "string" && lifecycleStateSet.has(value);
}

// ─── Transition Rules ───────────────────────────────────────────────────────

/**
 * Maps each lifecycle state to the set of states it may legally transition to.
 * CLOSED is terminal (empty array).
 */
export const LIFECYCLE_TRANSITIONS: Readonly<
  Record<MerchantLifecycleState, readonly MerchantLifecycleState[]>
> = Object.freeze({
  DRAFT: ["CONNECTING"],
  CONNECTING: ["MAPPING", "DRAFT"],
  MAPPING: ["VERIFYING", "CONNECTING"],
  VERIFYING: ["SANDBOX_READY", "MAPPING"],
  SANDBOX_READY: ["ACTIVATION_REVIEW"],
  ACTIVATION_REVIEW: ["ACTIVE", "SANDBOX_READY"],
  ACTIVE: ["ACTIVE_DEGRADED", "SUSPENDED", "OFFBOARDING"],
  ACTIVE_DEGRADED: ["ACTIVE", "SUSPENDED", "OFFBOARDING"],
  SUSPENDED: ["ACTIVATION_REVIEW", "OFFBOARDING"],
  OFFBOARDING: ["CLOSED"],
  CLOSED: [],
});

// ─── Terminal / Suspended Guards ────────────────────────────────────────────

const TERMINAL_STATES: ReadonlySet<MerchantLifecycleState> = new Set(["CLOSED"]);

const SUSPENDED_STATES: ReadonlySet<MerchantLifecycleState> = new Set(["SUSPENDED"]);

export function isTerminalState(state: MerchantLifecycleState): boolean {
  return TERMINAL_STATES.has(state);
}

export function isMerchantSuspended(state: MerchantLifecycleState): boolean {
  return SUSPENDED_STATES.has(state);
}

// ─── Lifecycle Transition Record ────────────────────────────────────────────

export interface MerchantLifecycleTransition {
  readonly merchantId: CounterId<"merchant">;
  readonly fromState: MerchantLifecycleState;
  readonly toState: MerchantLifecycleState;
  readonly actor: ActorReference;
  readonly reason: string;
  readonly occurredAt: Instant;
  readonly evidenceDigest?: Sha256Digest;
  readonly version: number;
}

// ─── Transition Function ────────────────────────────────────────────────────

export interface TransitionMerchantLifecycleParams {
  readonly merchantId: CounterId<"merchant">;
  readonly currentState: MerchantLifecycleState;
  readonly targetState: MerchantLifecycleState;
  readonly actor: ActorReference;
  readonly reason: string;
  readonly occurredAt: Instant;
  readonly evidenceDigest?: Sha256Digest;
  readonly currentVersion: number;
}

/**
 * Validates and executes a merchant lifecycle state transition.
 * Returns a frozen MerchantLifecycleTransition on success or a
 * CanonicalError when the transition is not permitted.
 */
export function transitionMerchantLifecycle(
  params: TransitionMerchantLifecycleParams,
): Result<MerchantLifecycleTransition> {
  const {
    merchantId,
    currentState,
    targetState,
    actor,
    reason,
    occurredAt,
    evidenceDigest,
    currentVersion,
  } = params;

  // Reject transitions from terminal states
  if (isTerminalState(currentState)) {
    return err(
      createCanonicalError({
        category: "conflict",
        code: "CONFLICT",
        message: "Cannot transition from terminal state",
      }),
    );
  }

  // Validate the transition is allowed
  const allowed = LIFECYCLE_TRANSITIONS[currentState];
  if (!allowed.includes(targetState)) {
    return err(
      createCanonicalError({
        category: "validation",
        code: "UNSUPPORTED_VALUE",
        message: "Transition is not allowed",
      }),
    );
  }

  const transition: MerchantLifecycleTransition = Object.freeze({
    merchantId,
    fromState: currentState,
    toState: targetState,
    actor,
    reason,
    occurredAt,
    ...(evidenceDigest !== undefined ? { evidenceDigest } : {}),
    version: currentVersion + 1,
  });

  return ok(transition);
}
