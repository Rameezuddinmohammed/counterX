/**
 * packages/merchant-policy
 *
 * Merchant-specific policy rules compiled to shared Policy Engine
 * constraints. Allows merchants to define custom business rules that
 * integrate with the platform's policy evaluation system.
 */

export const PACKAGE_NAME = "@counter/merchant-policy";

/** Configuration for merchant-specific policy rules. */
export interface MerchantPolicyConfig {
  readonly merchantId: string;
  readonly policyVersion: string;
  readonly rules: readonly MerchantPolicyRule[];
  readonly effectiveFrom: string;
  readonly effectiveUntil: string | null;
}

/** A single merchant policy rule definition. */
export interface MerchantPolicyRule {
  readonly ruleId: string;
  readonly category: string;
  readonly constraint: string;
  readonly parameters: Record<string, unknown>;
  readonly enabled: boolean;
}

/** Interface for compiling merchant policy rules to engine constraints. */
export interface MerchantPolicyCompiler {
  /** Compile a merchant policy config into engine-ready constraints. */
  compile(config: MerchantPolicyConfig): CompiledPolicyResult;
  /** Validate a policy config without compiling it. */
  validate(config: MerchantPolicyConfig): PolicyValidationResult;
}

/** Result of compiling merchant policies. */
export interface CompiledPolicyResult {
  readonly success: boolean;
  readonly constraintCount: number;
  readonly compiledAt: string;
}

/** Result of validating a merchant policy config. */
export interface PolicyValidationResult {
  readonly valid: boolean;
  readonly errors: readonly string[];
}
