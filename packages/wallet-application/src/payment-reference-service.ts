/**
 * Payment reference service for Counter wallet.
 *
 * Manages the lifecycle of payment authorization references: create, update,
 * and revoke. All mutations require step-up authentication. On any reference
 * change, affected mandates are reevaluated and invalidated if they no longer
 * satisfy the reference constraints.
 */

import type { CounterId } from "@counter/domain";
import type {
  MandateRepository,
  PaymentAuthorizationReference,
  PaymentReferenceEnvironment,
  PaymentReferenceRepository,
} from "@counter/wallet-domain";
import type { StepUpSession } from "./step-up-service.js";
import { StepUpService } from "./step-up-service.js";

// ---------------------------------------------------------------------------
// Service Error Types
// ---------------------------------------------------------------------------

export type PaymentReferenceErrorKind =
  | "step_up_required"
  | "step_up_invalid"
  | "reference_not_found"
  | "already_revoked"
  | "environment_mismatch"
  | "invalid_params";

export interface PaymentReferenceError {
  readonly kind: PaymentReferenceErrorKind;
  readonly message: string;
}

// ---------------------------------------------------------------------------
// Service Result
// ---------------------------------------------------------------------------

export type PaymentReferenceResult<T> =
  | { readonly ok: true; readonly value: T }
  | { readonly ok: false; readonly error: PaymentReferenceError };

// ---------------------------------------------------------------------------
// Create Params
// ---------------------------------------------------------------------------

export interface CreatePaymentReferenceParams {
  readonly referenceId: string;
  readonly walletId: CounterId<"wallet">;
  readonly principalId: CounterId<"actor">;
  readonly environment: PaymentReferenceEnvironment;
  readonly adapter: string;
  readonly validFrom: string;
  readonly validUntil: string;
  readonly eligibleMerchants: readonly string[];
  readonly eligibleOperations: readonly string[];
}

// ---------------------------------------------------------------------------
// Update Params
// ---------------------------------------------------------------------------

export interface UpdatePaymentReferenceParams {
  readonly eligibleMerchants?: readonly string[];
  readonly eligibleOperations?: readonly string[];
  readonly validUntil?: string;
}

// ---------------------------------------------------------------------------
// Service Output
// ---------------------------------------------------------------------------

export interface PaymentReferenceOutput {
  readonly reference: PaymentAuthorizationReference;
  readonly invalidatedMandateIds: readonly string[];
}

// ---------------------------------------------------------------------------
// PaymentReferenceService
// ---------------------------------------------------------------------------

export class PaymentReferenceService {
  readonly #referenceRepo: PaymentReferenceRepository;
  readonly #mandateRepo: MandateRepository;
  readonly #stepUpService: StepUpService;

  constructor(
    referenceRepo: PaymentReferenceRepository,
    mandateRepo: MandateRepository,
    stepUpService?: StepUpService,
  ) {
    this.#referenceRepo = referenceRepo;
    this.#mandateRepo = mandateRepo;
    this.#stepUpService = stepUpService ?? new StepUpService();
  }

  /**
   * Creates a new payment reference. Requires step-up authentication.
   */
  create(
    params: CreatePaymentReferenceParams,
    stepUpSession: StepUpSession,
  ): PaymentReferenceResult<PaymentReferenceOutput> {
    // Validate step-up
    const stepUpCheck = this.#validateStepUp(stepUpSession);
    if (!stepUpCheck.ok) {
      return stepUpCheck;
    }

    const reference: PaymentAuthorizationReference = {
      referenceId: params.referenceId,
      walletId: params.walletId,
      principalId: params.principalId,
      environment: params.environment,
      adapter: params.adapter,
      status: "active",
      validFrom: params.validFrom,
      validUntil: params.validUntil,
      eligibleMerchants: params.eligibleMerchants,
      eligibleOperations: params.eligibleOperations,
    };

    this.#referenceRepo.save(reference);
    this.#stepUpService.consumeNonce(stepUpSession.nonce);

    return {
      ok: true,
      value: { reference, invalidatedMandateIds: [] },
    };
  }

  /**
   * Updates an existing payment reference. Requires step-up authentication.
   * Reevaluates affected mandates and invalidates those that no longer satisfy
   * the reference constraints.
   */
  async update(
    referenceId: string,
    changes: UpdatePaymentReferenceParams,
    stepUpSession: StepUpSession,
  ): Promise<PaymentReferenceResult<PaymentReferenceOutput>> {
    // Validate step-up
    const stepUpCheck = this.#validateStepUp(stepUpSession);
    if (!stepUpCheck.ok) {
      return stepUpCheck;
    }

    const existing = this.#referenceRepo.findById(referenceId);
    if (!existing) {
      return {
        ok: false,
        error: { kind: "reference_not_found", message: "Payment reference not found" },
      };
    }

    if (existing.status === "revoked") {
      return {
        ok: false,
        error: { kind: "already_revoked", message: "Cannot update a revoked reference" },
      };
    }

    // Apply changes
    const updated: PaymentAuthorizationReference = {
      ...existing,
      ...(changes.eligibleMerchants !== undefined && {
        eligibleMerchants: changes.eligibleMerchants,
      }),
      ...(changes.eligibleOperations !== undefined && {
        eligibleOperations: changes.eligibleOperations,
      }),
      ...(changes.validUntil !== undefined && { validUntil: changes.validUntil }),
    };

    this.#referenceRepo.save(updated);
    this.#stepUpService.consumeNonce(stepUpSession.nonce);

    // Reevaluate affected mandates
    const invalidatedMandateIds = await this.#invalidateAffectedMandates(existing, updated);

    return {
      ok: true,
      value: { reference: updated, invalidatedMandateIds },
    };
  }

  /**
   * Revokes a payment reference. Requires step-up authentication.
   * Invalidates ALL mandates that reference this payment reference.
   */
  async revoke(
    referenceId: string,
    stepUpSession: StepUpSession,
  ): Promise<PaymentReferenceResult<PaymentReferenceOutput>> {
    // Validate step-up
    const stepUpCheck = this.#validateStepUp(stepUpSession);
    if (!stepUpCheck.ok) {
      return stepUpCheck;
    }

    const existing = this.#referenceRepo.findById(referenceId);
    if (!existing) {
      return {
        ok: false,
        error: { kind: "reference_not_found", message: "Payment reference not found" },
      };
    }

    if (existing.status === "revoked") {
      return {
        ok: false,
        error: { kind: "already_revoked", message: "Reference is already revoked" },
      };
    }

    // Revoke the reference
    this.#referenceRepo.updateStatus(referenceId, "revoked");
    this.#stepUpService.consumeNonce(stepUpSession.nonce);

    // Invalidate all mandates that reference this payment reference
    const invalidatedMandateIds = await this.#invalidateAllMandatesForReference(existing);

    const revoked: PaymentAuthorizationReference = { ...existing, status: "revoked" };

    return {
      ok: true,
      value: { reference: revoked, invalidatedMandateIds },
    };
  }

  /**
   * Validates environment match: test references must not be used in
   * production/pilot, and production references must not be used in sandbox.
   */
  validateEnvironment(
    reference: PaymentAuthorizationReference,
    currentEnvironment: PaymentReferenceEnvironment,
  ): PaymentReferenceResult<void> {
    // Test adapter can only be used in sandbox
    if (reference.adapter === "counter_test_provider" && currentEnvironment !== "sandbox") {
      return {
        ok: false,
        error: {
          kind: "environment_mismatch",
          message: "Test payment references cannot be used outside sandbox environment",
        },
      };
    }

    // Non-test references should not be used in sandbox
    if (reference.adapter !== "counter_test_provider" && currentEnvironment === "sandbox") {
      return {
        ok: false,
        error: {
          kind: "environment_mismatch",
          message: "Production payment references cannot be used in sandbox environment",
        },
      };
    }

    // Reference environment must match current environment
    if (reference.environment !== currentEnvironment) {
      return {
        ok: false,
        error: {
          kind: "environment_mismatch",
          message: `Reference environment '${reference.environment}' does not match current environment '${currentEnvironment}'`,
        },
      };
    }

    return { ok: true, value: undefined };
  }

  // ---------------------------------------------------------------------------
  // Private Helpers
  // ---------------------------------------------------------------------------

  #validateStepUp(session: StepUpSession): PaymentReferenceResult<void> {
    const requirement = this.#stepUpService.requireStepUp("payment_reference_change", session);

    if (requirement.required) {
      return {
        ok: false,
        error: {
          kind: "step_up_required",
          message: requirement.reason ?? "Step-up authentication is required",
        },
      };
    }

    const validation = this.#stepUpService.validateSession(session);
    if (!validation.valid) {
      return {
        ok: false,
        error: {
          kind: "step_up_invalid",
          message: validation.reason ?? "Step-up session is invalid",
        },
      };
    }

    return { ok: true, value: undefined };
  }

  /**
   * After a reference update, find mandates that reference it and invalidate
   * those whose constraints are no longer satisfied.
   */
  async #invalidateAffectedMandates(
    _original: PaymentAuthorizationReference,
    updated: PaymentAuthorizationReference,
  ): Promise<readonly string[]> {
    const mandates = await this.#mandateRepo.findActive(updated.walletId);
    const invalidated: string[] = [];

    for (const mandate of mandates) {
      if (mandate.paymentReferenceId !== updated.referenceId) {
        continue;
      }
      // Mandate is affected - check if its constraints are still met
      const shouldInvalidate = this.#mandateViolatesReference(mandate, updated);
      if (shouldInvalidate) {
        await this.#mandateRepo.updateStatus(mandate.mandateId, "revoked");
        invalidated.push(mandate.mandateId);
      }
    }

    return invalidated;
  }

  /**
   * After a reference revocation, invalidate ALL mandates that reference it.
   */
  async #invalidateAllMandatesForReference(
    reference: PaymentAuthorizationReference,
  ): Promise<readonly string[]> {
    const mandates = await this.#mandateRepo.findActive(reference.walletId);
    const invalidated: string[] = [];

    for (const mandate of mandates) {
      if (mandate.paymentReferenceId === reference.referenceId) {
        await this.#mandateRepo.updateStatus(mandate.mandateId, "revoked");
        invalidated.push(mandate.mandateId);
      }
    }

    return invalidated;
  }

  /**
   * Checks whether a mandate violates the updated reference constraints.
   */
  #mandateViolatesReference(
    mandate: {
      readonly constraints: {
        readonly merchantAllowlist?: { readonly allowedMerchantIds?: readonly string[] };
        readonly operations?: { readonly allowedOperations?: readonly string[] };
      };
    },
    reference: PaymentAuthorizationReference,
  ): boolean {
    // Check merchant constraints
    if (
      mandate.constraints.merchantAllowlist?.allowedMerchantIds &&
      reference.eligibleMerchants.length > 0
    ) {
      const referenceSet = new Set(reference.eligibleMerchants);
      for (const merchant of mandate.constraints.merchantAllowlist.allowedMerchantIds) {
        if (!referenceSet.has(merchant)) {
          return true;
        }
      }
    }

    // Check operation constraints
    if (
      mandate.constraints.operations?.allowedOperations &&
      reference.eligibleOperations.length > 0
    ) {
      const referenceSet = new Set(reference.eligibleOperations);
      for (const operation of mandate.constraints.operations.allowedOperations) {
        if (!referenceSet.has(operation)) {
          return true;
        }
      }
    }

    return false;
  }
}
