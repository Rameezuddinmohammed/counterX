/**
 * Wallet lifecycle states and transition rules.
 *
 * A wallet progresses through a series of states from invitation through
 * active use and eventual closure. Transitions are validated to prevent
 * invalid state jumps.
 */

// ---------------------------------------------------------------------------
// Lifecycle States
// ---------------------------------------------------------------------------

export const WALLET_LIFECYCLE_STATES = [
  "INVITED",
  "ENROLLED",
  "VERIFIED",
  "ACTIVE",
  "SUSPENDED",
  "RECOVERY_LOCKED",
  "OFFBOARDING",
  "CLOSED",
] as const;

export type WalletLifecycleState = (typeof WALLET_LIFECYCLE_STATES)[number];

const walletLifecycleStateSet: ReadonlySet<string> = new Set(WALLET_LIFECYCLE_STATES);

export function isWalletLifecycleState(value: unknown): value is WalletLifecycleState {
  return typeof value === "string" && walletLifecycleStateSet.has(value);
}

// ---------------------------------------------------------------------------
// Transition Rules
// ---------------------------------------------------------------------------

/**
 * Allowed transitions: maps each state to the set of states it can move to.
 * Transitions not listed here are invalid.
 */
const ALLOWED_TRANSITIONS: Readonly<Record<WalletLifecycleState, readonly WalletLifecycleState[]>> =
  {
    INVITED: ["ENROLLED"],
    ENROLLED: ["VERIFIED"],
    VERIFIED: ["ACTIVE"],
    ACTIVE: ["SUSPENDED", "OFFBOARDING"],
    SUSPENDED: ["ACTIVE", "RECOVERY_LOCKED", "OFFBOARDING"],
    RECOVERY_LOCKED: ["ACTIVE", "OFFBOARDING"],
    OFFBOARDING: ["CLOSED"],
    CLOSED: [],
  } as const;

export interface TransitionValidationResult {
  readonly valid: boolean;
  readonly from: WalletLifecycleState;
  readonly to: WalletLifecycleState;
  readonly reason?: string;
}

/**
 * Validates whether a state transition is allowed.
 */
export function validateTransition(
  from: WalletLifecycleState,
  to: WalletLifecycleState,
): TransitionValidationResult {
  const allowed = ALLOWED_TRANSITIONS[from];
  if (allowed.includes(to)) {
    return { valid: true, from, to };
  }
  return {
    valid: false,
    from,
    to,
    reason: `Transition from ${from} to ${to} is not allowed`,
  };
}

/**
 * Returns the list of valid target states from the given state.
 */
export function allowedTransitionsFrom(state: WalletLifecycleState): readonly WalletLifecycleState[] {
  return ALLOWED_TRANSITIONS[state];
}

/**
 * Returns true if the given state is terminal (no outgoing transitions).
 */
export function isTerminalState(state: WalletLifecycleState): boolean {
  return ALLOWED_TRANSITIONS[state].length === 0;
}
