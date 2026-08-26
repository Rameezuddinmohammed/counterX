/**
 * Step-up authentication service for privileged wallet operations.
 *
 * Privileged operations require elevated authentication (step-up) before
 * they can proceed. The service validates session freshness, expiry, and
 * assurance levels to prevent unauthorized access to sensitive operations.
 */

// ---------------------------------------------------------------------------
// Privileged Operations
// ---------------------------------------------------------------------------

/**
 * Operations that require step-up authentication before they can proceed.
 */
export const PRIVILEGED_OPERATIONS = [
  "policy_widening",
  "agent_key_change",
  "payment_reference_change",
  "mandate_consent",
  "approval",
  "recovery",
  "export",
  "closure",
] as const;

export type PrivilegedOperation = (typeof PRIVILEGED_OPERATIONS)[number];

const privilegedOperationSet: ReadonlySet<string> = new Set(PRIVILEGED_OPERATIONS);

export function isPrivilegedOperation(value: unknown): value is PrivilegedOperation {
  return typeof value === "string" && privilegedOperationSet.has(value);
}

// ---------------------------------------------------------------------------
// Assurance Levels
// ---------------------------------------------------------------------------

/**
 * Authentication assurance levels, ordered from lowest to highest.
 * "basic" = password-only or single factor
 * "substantial" = multi-factor, not hardware-bound
 * "high" = hardware-bound authenticator (WebAuthn/FIDO2)
 */
export const ASSURANCE_LEVELS = ["basic", "substantial", "high"] as const;

export type StepUpAssuranceLevel = (typeof ASSURANCE_LEVELS)[number];

const assuranceLevelOrder: Record<StepUpAssuranceLevel, number> = {
  basic: 0,
  substantial: 1,
  high: 2,
};

/**
 * Returns true if actual meets or exceeds required assurance level.
 */
export function meetsAssuranceLevel(
  actual: StepUpAssuranceLevel,
  required: StepUpAssuranceLevel,
): boolean {
  return assuranceLevelOrder[actual] >= assuranceLevelOrder[required];
}

// ---------------------------------------------------------------------------
// Step-Up Session
// ---------------------------------------------------------------------------

/**
 * Represents a step-up authentication session.
 */
export interface StepUpSession {
  readonly principal_id: string;
  readonly method: string;
  readonly assurance: StepUpAssuranceLevel;
  readonly authenticated_at: string;
  readonly expires_at: string;
  readonly nonce: string;
}

// ---------------------------------------------------------------------------
// Step-Up Requirement Result
// ---------------------------------------------------------------------------

export interface StepUpRequirement {
  readonly required: boolean;
  readonly minimum_assurance: StepUpAssuranceLevel;
  readonly reason?: string | undefined;
}

// ---------------------------------------------------------------------------
// Step-Up Validation Result
// ---------------------------------------------------------------------------

export interface StepUpValidationResult {
  readonly valid: boolean;
  readonly reason?: string | undefined;
}

// ---------------------------------------------------------------------------
// Required Assurance per Operation
// ---------------------------------------------------------------------------

/**
 * Maps each privileged operation to the minimum assurance level needed.
 */
const OPERATION_ASSURANCE_REQUIREMENTS: Record<PrivilegedOperation, StepUpAssuranceLevel> = {
  policy_widening: "substantial",
  agent_key_change: "high",
  payment_reference_change: "substantial",
  mandate_consent: "substantial",
  approval: "substantial",
  recovery: "high",
  export: "high",
  closure: "high",
};

// ---------------------------------------------------------------------------
// Step-Up Service Configuration
// ---------------------------------------------------------------------------

export interface StepUpServiceConfig {
  /** Maximum age of a step-up session in milliseconds. Default: 300000 (5 minutes) */
  readonly max_session_age_ms?: number | undefined;
}

const DEFAULT_MAX_SESSION_AGE_MS = 300_000; // 5 minutes

// ---------------------------------------------------------------------------
// StepUpService
// ---------------------------------------------------------------------------

export class StepUpService {
  private readonly maxSessionAgeMs: number;
  private readonly usedNonces = new Set<string>();

  constructor(config?: StepUpServiceConfig) {
    this.maxSessionAgeMs = config?.max_session_age_ms ?? DEFAULT_MAX_SESSION_AGE_MS;
  }

  /**
   * Determines whether a step-up is required for the given operation,
   * and what assurance level is needed.
   */
  requireStepUp(
    operation: PrivilegedOperation,
    existingSession?: StepUpSession,
  ): StepUpRequirement {
    const minimumAssurance = OPERATION_ASSURANCE_REQUIREMENTS[operation];

    if (!existingSession) {
      return {
        required: true,
        minimum_assurance: minimumAssurance,
        reason: `Operation '${operation}' requires step-up authentication`,
      };
    }

    // Check session validity
    const validation = this.validateSession(existingSession);
    if (!validation.valid) {
      return {
        required: true,
        minimum_assurance: minimumAssurance,
        reason: validation.reason,
      };
    }

    // Check assurance level
    if (!meetsAssuranceLevel(existingSession.assurance, minimumAssurance)) {
      return {
        required: true,
        minimum_assurance: minimumAssurance,
        reason: `Operation '${operation}' requires assurance level '${minimumAssurance}' but session has '${existingSession.assurance}'`,
      };
    }

    return {
      required: false,
      minimum_assurance: minimumAssurance,
    };
  }

  /**
   * Validates a step-up session for freshness, expiry, and nonce reuse.
   */
  validateSession(session: StepUpSession, now?: string): StepUpValidationResult {
    const currentTime = now ? new Date(now).getTime() : Date.now();
    const authenticatedAt = new Date(session.authenticated_at).getTime();
    const expiresAt = new Date(session.expires_at).getTime();

    // Check expiry
    if (currentTime >= expiresAt) {
      return {
        valid: false,
        reason: "Step-up session has expired",
      };
    }

    // Check staleness (time since authentication)
    const sessionAge = currentTime - authenticatedAt;
    if (sessionAge > this.maxSessionAgeMs) {
      return {
        valid: false,
        reason: "Step-up session is stale (authentication too old)",
      };
    }

    // Check nonce replay
    if (this.usedNonces.has(session.nonce)) {
      return {
        valid: false,
        reason: "Step-up session nonce has already been used (replay detected)",
      };
    }

    return { valid: true };
  }

  /**
   * Marks a nonce as consumed, preventing replay.
   */
  consumeNonce(nonce: string): void {
    this.usedNonces.add(nonce);
  }

  /**
   * Resets consumed nonces (test utility).
   */
  resetNonces(): void {
    this.usedNonces.clear();
  }
}
