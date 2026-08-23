/**
 * @counter/policy
 *
 * Deterministic bilateral policy engine: typed rules, intersection
 * reduction, ALLOW/DENY/REVIEW_REQUIRED decisions, and atomic rolling
 * limits. Neither buyer nor merchant policy can widen the other.
 */

// Constraint types
export type {
  AssuranceLevel,
  BuyerAggregateLimit,
  BuyerAmountLimit,
  BuyerApprovalThreshold,
  BuyerCountLimit,
  BuyerPolicyConstraints,
  BuyerQuantityLimit,
  BuyerRollingLimit,
  BuyerTimeWindow,
  ConnectorCapabilityConstraints,
  MandateConstraints,
  MerchantPolicyConstraints,
  MerchantTimeWindow,
  OperationType,
  PaymentMethod,
  PlatformSafetyConstraints,
  PolicyEvaluationInput,
  ProviderConstraints,
  RiskLevel,
  RiskResultConstraints,
  TransactionPhase,
  TransactionStateConstraints,
} from "./types.js";

// Decision types
export type {
  AllowDecision,
  DenyDecision,
  EffectiveConstraints,
  PolicyDecision,
  ReviewRequiredDecision,
} from "./decision.js";
export {
  createAllowDecision,
  createDenyDecision,
  createReviewRequiredDecision,
} from "./decision.js";

// Rules
export type { RuleEvaluator, RuleOutcome, RuleResult } from "./rules.js";
export { ALL_RULES, evaluateAllRules } from "./rules.js";

// Intersection reducer
export { computeMaterialInputDigest, reduceToDecision } from "./intersection.js";

// Limit store port and implementation
export type {
  CurrentUsage,
  LimitBucket,
  LimitStore,
  LimitType,
  Reservation,
  ReservationStatus,
  ReserveContext,
} from "./limit-store.js";
export { InMemoryLimitStore } from "./in-memory-limit-store.js";

// Engine
export type { PolicyEngineConfig } from "./engine.js";
export { PolicyEngine } from "./engine.js";
