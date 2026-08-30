/**
 * State transition records for the wallet lifecycle.
 *
 * Every successful state transition produces a StateTransitionRecord that
 * captures the actor, reason, prior/new state, timestamp, and evidence
 * reference. This provides an immutable audit trail.
 */

import type { CounterId } from "@counter/domain";
import type { WalletLifecycleState } from "./lifecycle.js";
import { validateTransition } from "./lifecycle.js";

// ---------------------------------------------------------------------------
// StateTransitionRecord
// ---------------------------------------------------------------------------

/**
 * Immutable record of a wallet lifecycle state transition.
 */
export interface StateTransitionRecord {
  readonly wallet_id: CounterId<"wallet">;
  readonly actor_id: CounterId<"actor">;
  readonly from_state: WalletLifecycleState;
  readonly to_state: WalletLifecycleState;
  readonly reason: string;
  readonly timestamp: string;
  readonly evidence_ref?: string | undefined;
}

// ---------------------------------------------------------------------------
// Transition Error
// ---------------------------------------------------------------------------

export interface TransitionError {
  readonly kind: "transition_error";
  readonly from: WalletLifecycleState;
  readonly to: WalletLifecycleState;
  readonly reason: string;
}

// ---------------------------------------------------------------------------
// TransitionResult
// ---------------------------------------------------------------------------

export type TransitionResult =
  | { readonly ok: true; readonly record: StateTransitionRecord }
  | { readonly ok: false; readonly error: TransitionError };

// ---------------------------------------------------------------------------
// Enhanced validateTransition that returns a full record on success
// ---------------------------------------------------------------------------

export interface TransitionInput {
  readonly wallet_id: CounterId<"wallet">;
  readonly actor_id: CounterId<"actor">;
  readonly from_state: WalletLifecycleState;
  readonly to_state: WalletLifecycleState;
  readonly reason: string;
  readonly timestamp: string;
  readonly evidence_ref?: string | undefined;
}

/**
 * Validates a state transition and returns a full StateTransitionRecord on
 * success, or a TransitionError on failure.
 */
export function validateAndRecordTransition(input: TransitionInput): TransitionResult {
  const validation = validateTransition(input.from_state, input.to_state);

  if (!validation.valid) {
    return {
      ok: false,
      error: {
        kind: "transition_error",
        from: input.from_state,
        to: input.to_state,
        reason:
          validation.reason ??
          `Transition from ${input.from_state} to ${input.to_state} is not allowed`,
      },
    };
  }

  return {
    ok: true,
    record: {
      wallet_id: input.wallet_id,
      actor_id: input.actor_id,
      from_state: input.from_state,
      to_state: input.to_state,
      reason: input.reason,
      timestamp: input.timestamp,
      evidence_ref: input.evidence_ref,
    },
  };
}
