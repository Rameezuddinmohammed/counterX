/**
 * Typed compensation registry.
 *
 * Maps finding types to eligible compensation commands. Compensation MUST
 * check prerequisites before execution. Failed compensation remains
 * unresolved (never silently succeeds).
 */

import type {
  CompensationCommandRecord,
  CompensationResult,
  EvidenceRecord,
  FindingType,
} from "./types.js";
import { isAuthoritative } from "./source-authority.js";

export class CompensationRegistry {
  readonly #registry: Map<FindingType, CompensationCommandRecord[]> = new Map();

  public register(
    findingType: FindingType,
    commands: readonly CompensationCommandRecord[],
  ): void {
    const existing = this.#registry.get(findingType);
    if (existing !== undefined) {
      existing.push(...commands);
    } else {
      this.#registry.set(findingType, [...commands]);
    }
  }

  public getEligibleCommands(
    findingType: FindingType,
  ): readonly CompensationCommandRecord[] {
    return this.#registry.get(findingType) ?? [];
  }

  /**
   * Validates that all prerequisite evidence states are satisfied.
   * Each prerequisite is a string of the form "claim_type:source" meaning
   * the evidence collection must contain a record with that claim type from
   * the specified source, or if no source specified, from an authoritative source.
   */
  public checkPrerequisites(
    command: CompensationCommandRecord,
    evidence: readonly EvidenceRecord[],
  ): boolean {
    for (const prerequisite of command.prerequisites) {
      const [claimType, requiredSource] = prerequisite.split(":");
      if (claimType === undefined) return false;

      const satisfied = evidence.some((record) => {
        if (record.canonicalClaim.type !== claimType) return false;
        if (requiredSource !== undefined) {
          return record.source === requiredSource;
        }
        return isAuthoritative(record.source, record.canonicalClaim.type);
      });

      if (!satisfied) return false;
    }
    return true;
  }

  /**
   * Checks prerequisites first - if failed returns prerequisite_failed,
   * never silently succeeds.
   */
  public executeCompensation(
    command: CompensationCommandRecord,
    evidence: readonly EvidenceRecord[],
  ): CompensationResult {
    if (!this.checkPrerequisites(command, evidence)) {
      return Object.freeze({
        status: "prerequisite_failed",
        detail: "One or more prerequisites were not satisfied by available evidence",
      });
    }

    return Object.freeze({
      status: "executed",
      detail: `Compensation '${command.type}' executed with idempotency key '${command.idempotencyKey}'`,
    });
  }
}

/**
 * Default compensation registry with mappings for common finding types.
 */
export const DEFAULT_COMPENSATION_REGISTRY: CompensationRegistry =
  createDefaultRegistry();

function createDefaultRegistry(): CompensationRegistry {
  const registry = new CompensationRegistry();

  registry.register("payment_order_mismatch", [
    Object.freeze({
      type: "void",
      prerequisites: Object.freeze(["authorization_created:payment_provider"]),
      buyerPolicyRequired: false,
      merchantPolicyRequired: false,
      maxMonetaryEffect: undefined,
      idempotencyKey: "void-orphaned-auth",
      providerAction: "void_authorization",
      expectedResult: "authorization_voided",
      queryStrategy: "query_before_retry",
      fallbackHumanOwner: "payments-oncall",
    }),
  ]);

  registry.register("orphaned_authorization", [
    Object.freeze({
      type: "void",
      prerequisites: Object.freeze(["authorization_created:payment_provider"]),
      buyerPolicyRequired: false,
      merchantPolicyRequired: false,
      maxMonetaryEffect: undefined,
      idempotencyKey: "void-orphaned",
      providerAction: "void_authorization",
      expectedResult: "authorization_voided",
      queryStrategy: "query_before_retry",
      fallbackHumanOwner: "payments-oncall",
    }),
  ]);

  registry.register("refund_mismatch", [
    Object.freeze({
      type: "escalate_human",
      prerequisites: Object.freeze([]),
      buyerPolicyRequired: true,
      merchantPolicyRequired: true,
      maxMonetaryEffect: undefined,
      idempotencyKey: "escalate-refund-mismatch",
      providerAction: undefined,
      expectedResult: undefined,
      queryStrategy: undefined,
      fallbackHumanOwner: "disputes-team",
    }),
  ]);

  registry.register("integrity_failure", [
    Object.freeze({
      type: "create_finding",
      prerequisites: Object.freeze([]),
      buyerPolicyRequired: false,
      merchantPolicyRequired: false,
      maxMonetaryEffect: undefined,
      idempotencyKey: "finding-integrity-failure",
      providerAction: undefined,
      expectedResult: undefined,
      queryStrategy: undefined,
      fallbackHumanOwner: "security-oncall",
    }),
  ]);

  registry.register("intent_authority_mismatch", [
    Object.freeze({
      type: "escalate_human",
      prerequisites: Object.freeze([]),
      buyerPolicyRequired: false,
      merchantPolicyRequired: false,
      maxMonetaryEffect: undefined,
      idempotencyKey: "escalate-authority-mismatch",
      providerAction: undefined,
      expectedResult: undefined,
      queryStrategy: undefined,
      fallbackHumanOwner: "trust-team",
    }),
  ]);

  return registry;
}
