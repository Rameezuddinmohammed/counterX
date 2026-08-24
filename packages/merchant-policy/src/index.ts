/**
 * @counter/merchant-policy
 *
 * Merchant-specific policy rules compiled to shared Policy Engine
 * constraints. Allows merchants to define typed business rules that
 * integrate with the platform's bilateral policy evaluation system.
 */

// Policy configuration types
export type {
  CancellationPolicyRule,
  CategoryAllowlistRule,
  CountLimitRule,
  FreshnessRequirementRule,
  IndiaDestinationRule,
  InrOnlyRule,
  MerchantPolicyRuleConfig,
  MerchantPolicyRuleSet,
  OperatingWindowRule,
  PaymentPathRule,
  ProductAllowlistRule,
  QuantityLimitRule,
  RefundPolicyRule,
  ReviewThresholdRule,
  RuleKind,
} from "./policy-config.js";
export {
  isValidRuleKind,
  RULE_KINDS,
  validateRuleConfig,
  validateRuleSet,
} from "./policy-config.js";

// Compiler
export type { CompiledMerchantPolicy } from "./compiler.js";
export { compileMerchantPolicy } from "./compiler.js";

// Summary renderer
export { renderPolicySummary } from "./summary-renderer.js";

// Simulation
export type { SimulationInput, SimulationResult } from "./simulation.js";
export { simulateWalletAuthority } from "./simulation.js";

// Versioning
export type { PolicyVersionRecord, VersionComparison, VersionTransition } from "./versioning.js";
export {
  advanceVersion,
  compareVersions,
  detectVersionTransition,
  isMonotonicHistory,
} from "./versioning.js";
