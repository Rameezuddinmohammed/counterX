/**
 * Wire (JSON-safe) encoding for this package's typed rule set.
 *
 * Plain JSON cannot carry a bigint (Money.amountMinor) or a branded Instant
 * value directly, so this module is the ONE translation boundary between
 * the real typed union (MerchantPolicyRuleConfig / MerchantPolicyRuleSet —
 * the same shape compileMerchantPolicy compiles) and plain JSON sent over
 * HTTP or stored as a database row's JSON column. Lives in this package
 * (not in any one consuming app) because both control-plane-api (the
 * policy CRUD routes + storage) and agent-runtime (checkout-time policy
 * enforcement) need the identical codec to agree on what's actually stored
 * in merchant.policy_configs.config — duplicating it per-app would risk the
 * two apps silently drifting on how a rule is encoded.
 *
 * effectiveUntil has no wire "no expiry" representation other than an
 * explicit far-future instant: the typed MerchantPolicyRuleSet.effectiveUntil
 * is a non-nullable Instant, so a `null` on the wire (meaning "never
 * expires") is mapped to domain's own MAX_INSTANT_EPOCH_MILLISECONDS sentinel
 * (9999-12-31), not a second parallel "no end date" concept.
 */
import {
  createDecimalQuantity,
  decimalQuantityToJson,
  instantFromEpochMilliseconds,
  MAX_INSTANT_EPOCH_MILLISECONDS,
  moneyFromJson,
  moneyToJson,
  parseInstant,
  serializeInstant,
  type Instant,
  type MoneyJson,
  type DecimalQuantityJson,
} from "@counter/domain";
import { isValidRuleKind } from "./policy-config.js";
import type { MerchantPolicyRuleConfig, MerchantPolicyRuleSet, RuleKind } from "./policy-config.js";

// ---------------------------------------------------------------------------
// Wire shape (what actually crosses HTTP / is stored as JSON)
// ---------------------------------------------------------------------------

export type WireRuleConfig =
  | { readonly kind: "product-allowlist"; readonly products: readonly string[] }
  | { readonly kind: "category-allowlist"; readonly categories: readonly string[] }
  | { readonly kind: "inr-only" }
  | { readonly kind: "quantity-limit"; readonly maxQuantity: DecimalQuantityJson }
  | { readonly kind: "count-limit"; readonly maxCount: number; readonly windowDurationMs: number }
  | { readonly kind: "india-destination"; readonly allowedDestinations: readonly string[] }
  | {
      readonly kind: "operating-window";
      readonly allowedFrom: string;
      readonly allowedUntil: string;
    }
  | { readonly kind: "freshness-requirement"; readonly maxAgeMs: number }
  | { readonly kind: "payment-path"; readonly allowedMethods: readonly string[] }
  | { readonly kind: "review-threshold"; readonly thresholdAmount: MoneyJson }
  | {
      readonly kind: "cancellation-policy";
      readonly allowedWithinMs: number;
      readonly refundPercentage: number;
    }
  | {
      readonly kind: "refund-policy";
      readonly maxRefundWindowMs: number;
      readonly partialRefundAllowed: boolean;
    };

export interface WireRuleSet {
  readonly rules: readonly WireRuleConfig[];
  readonly effectiveFrom: string;
  readonly effectiveUntil: string | null;
}

export interface StoredRuleSet {
  readonly merchantId: string;
  readonly version: number;
  readonly rules: readonly WireRuleConfig[];
  readonly effectiveFrom: string;
  readonly effectiveUntil: string | null;
}

const PAYMENT_METHODS = ["upi", "card", "netbanking", "wallet", "bank_transfer", "bnpl"] as const;
type WirePaymentMethod = (typeof PAYMENT_METHODS)[number];

function isPaymentMethod(value: unknown): value is WirePaymentMethod {
  return typeof value === "string" && (PAYMENT_METHODS as readonly string[]).includes(value);
}

function isStringArray(value: unknown): value is readonly string[] {
  return Array.isArray(value) && value.every((v) => typeof v === "string");
}

// ---------------------------------------------------------------------------
// Parse: wire JSON -> typed MerchantPolicyRuleConfig
// ---------------------------------------------------------------------------

/** Returns the typed rule, or a plain-language error describing what's wrong. */
export function parseRuleConfig(raw: unknown): MerchantPolicyRuleConfig | string {
  if (raw === null || typeof raw !== "object") {
    return "Each rule must be an object with a 'kind' field";
  }
  const obj = raw as Record<string, unknown>;
  const kind = obj["kind"];
  if (!isValidRuleKind(kind)) {
    return `Unknown rule kind: ${JSON.stringify(kind)}`;
  }

  switch (kind as RuleKind) {
    case "product-allowlist": {
      if (!isStringArray(obj["products"])) return "product-allowlist.products must be a string[]";
      return { kind: "product-allowlist", products: obj["products"] };
    }
    case "category-allowlist": {
      if (!isStringArray(obj["categories"]))
        return "category-allowlist.categories must be a string[]";
      return { kind: "category-allowlist", categories: obj["categories"] };
    }
    case "inr-only":
      return { kind: "inr-only" };
    case "quantity-limit": {
      const raw2 = obj["maxQuantity"];
      if (raw2 === null || typeof raw2 !== "object")
        return "quantity-limit.maxQuantity must be a {value, unit} object";
      const q = raw2 as Record<string, unknown>;
      const parsed = createDecimalQuantity(q["value"], q["unit"] ?? "item");
      if (!parsed.ok) return `quantity-limit.maxQuantity is invalid: ${parsed.error.message}`;
      return { kind: "quantity-limit", maxQuantity: parsed.value };
    }
    case "count-limit": {
      const maxCount = obj["maxCount"];
      const windowDurationMs = obj["windowDurationMs"];
      if (typeof maxCount !== "number" || typeof windowDurationMs !== "number") {
        return "count-limit.maxCount and windowDurationMs must be numbers";
      }
      return { kind: "count-limit", maxCount, windowDurationMs };
    }
    case "india-destination": {
      if (!isStringArray(obj["allowedDestinations"]))
        return "india-destination.allowedDestinations must be a string[]";
      return { kind: "india-destination", allowedDestinations: obj["allowedDestinations"] };
    }
    case "operating-window": {
      const from = parseInstant(obj["allowedFrom"]);
      if (!from.ok) return `operating-window.allowedFrom is invalid: ${from.error.message}`;
      const until = parseInstant(obj["allowedUntil"]);
      if (!until.ok) return `operating-window.allowedUntil is invalid: ${until.error.message}`;
      return { kind: "operating-window", allowedFrom: from.value, allowedUntil: until.value };
    }
    case "freshness-requirement": {
      const maxAgeMs = obj["maxAgeMs"];
      if (typeof maxAgeMs !== "number") return "freshness-requirement.maxAgeMs must be a number";
      return { kind: "freshness-requirement", maxAgeMs };
    }
    case "payment-path": {
      const methods = obj["allowedMethods"];
      if (!Array.isArray(methods) || !methods.every(isPaymentMethod)) {
        return `payment-path.allowedMethods must be an array of ${PAYMENT_METHODS.join("|")}`;
      }
      return { kind: "payment-path", allowedMethods: methods };
    }
    case "review-threshold": {
      const parsed = moneyFromJson(obj["thresholdAmount"]);
      if (!parsed.ok) return `review-threshold.thresholdAmount is invalid: ${parsed.error.message}`;
      return { kind: "review-threshold", thresholdAmount: parsed.value };
    }
    case "cancellation-policy": {
      const allowedWithinMs = obj["allowedWithinMs"];
      const refundPercentage = obj["refundPercentage"];
      if (typeof allowedWithinMs !== "number" || typeof refundPercentage !== "number") {
        return "cancellation-policy.allowedWithinMs and refundPercentage must be numbers";
      }
      return { kind: "cancellation-policy", allowedWithinMs, refundPercentage };
    }
    case "refund-policy": {
      const maxRefundWindowMs = obj["maxRefundWindowMs"];
      const partialRefundAllowed = obj["partialRefundAllowed"];
      if (typeof maxRefundWindowMs !== "number" || typeof partialRefundAllowed !== "boolean") {
        return "refund-policy.maxRefundWindowMs must be a number and partialRefundAllowed a boolean";
      }
      return { kind: "refund-policy", maxRefundWindowMs, partialRefundAllowed };
    }
  }
}

// ---------------------------------------------------------------------------
// Serialize: typed MerchantPolicyRuleConfig -> wire JSON
// ---------------------------------------------------------------------------

export function serializeRuleConfig(rule: MerchantPolicyRuleConfig): WireRuleConfig {
  switch (rule.kind) {
    case "product-allowlist":
      return { kind: rule.kind, products: rule.products };
    case "category-allowlist":
      return { kind: rule.kind, categories: rule.categories };
    case "inr-only":
      return { kind: rule.kind };
    case "quantity-limit":
      return { kind: rule.kind, maxQuantity: decimalQuantityToJson(rule.maxQuantity) };
    case "count-limit":
      return { kind: rule.kind, maxCount: rule.maxCount, windowDurationMs: rule.windowDurationMs };
    case "india-destination":
      return { kind: rule.kind, allowedDestinations: rule.allowedDestinations };
    case "operating-window":
      return {
        kind: rule.kind,
        allowedFrom: serializeInstant(rule.allowedFrom),
        allowedUntil: serializeInstant(rule.allowedUntil),
      };
    case "freshness-requirement":
      return { kind: rule.kind, maxAgeMs: rule.maxAgeMs };
    case "payment-path":
      return { kind: rule.kind, allowedMethods: rule.allowedMethods };
    case "review-threshold":
      return { kind: rule.kind, thresholdAmount: moneyToJson(rule.thresholdAmount) };
    case "cancellation-policy":
      return {
        kind: rule.kind,
        allowedWithinMs: rule.allowedWithinMs,
        refundPercentage: rule.refundPercentage,
      };
    case "refund-policy":
      return {
        kind: rule.kind,
        maxRefundWindowMs: rule.maxRefundWindowMs,
        partialRefundAllowed: rule.partialRefundAllowed,
      };
  }
}

// ---------------------------------------------------------------------------
// Whole rule-set parse/serialize
// ---------------------------------------------------------------------------

/** Everything needed to build a MerchantPolicyRuleSet except its assigned version (a store-assigned optimistic-concurrency counter — see policy-routes.ts in control-plane-api). */
export interface ParsedRuleSetBody {
  readonly rules: readonly MerchantPolicyRuleConfig[];
  readonly effectiveFrom: Instant;
  readonly effectiveUntil: Instant;
}

// Returns a plain (mutable) string[] on error, not readonly string[] — a
// readonly array doesn't reliably narrow away from Array.isArray() checks
// in every caller's control-flow analysis, unlike a mutable one.
export function parseRuleSetBody(body: unknown): ParsedRuleSetBody | string[] {
  if (body === null || typeof body !== "object") {
    return ["Request body is required"];
  }
  const obj = body as Record<string, unknown>;

  if (!Array.isArray(obj["rules"])) {
    return ["Field 'rules' must be an array"];
  }
  const effectiveFromRaw = obj["effectiveFrom"];
  if (typeof effectiveFromRaw !== "string" || effectiveFromRaw === "") {
    return ["Field 'effectiveFrom' is required"];
  }
  const effectiveFrom = parseInstant(effectiveFromRaw);
  if (!effectiveFrom.ok) {
    return [`Field 'effectiveFrom' is invalid: ${effectiveFrom.error.message}`];
  }

  const effectiveUntilRaw = obj["effectiveUntil"];
  let effectiveUntil: Instant;
  if (effectiveUntilRaw === null || effectiveUntilRaw === undefined) {
    const maxInstant = instantFromEpochMilliseconds(MAX_INSTANT_EPOCH_MILLISECONDS);
    if (!maxInstant.ok) {
      throw new Error("Failed to derive the max Instant sentinel");
    }
    effectiveUntil = maxInstant.value;
  } else if (typeof effectiveUntilRaw === "string") {
    const parsed = parseInstant(effectiveUntilRaw);
    if (!parsed.ok) {
      return [`Field 'effectiveUntil' is invalid: ${parsed.error.message}`];
    }
    effectiveUntil = parsed.value;
  } else {
    return ["Field 'effectiveUntil' must be a string or null"];
  }

  const errors: string[] = [];
  const rules: MerchantPolicyRuleConfig[] = [];
  (obj["rules"] as readonly unknown[]).forEach((raw, index) => {
    const parsed = parseRuleConfig(raw);
    if (typeof parsed === "string") {
      errors.push(`rules[${String(index)}]: ${parsed}`);
    } else {
      rules.push(parsed);
    }
  });
  if (errors.length > 0) {
    return errors;
  }

  return { rules, effectiveFrom: effectiveFrom.value, effectiveUntil };
}

export function serializeRuleSet(ruleSet: MerchantPolicyRuleSet): StoredRuleSet {
  return {
    merchantId: ruleSet.merchantId,
    version: ruleSet.version,
    rules: ruleSet.rules.map(serializeRuleConfig),
    effectiveFrom: serializeInstant(ruleSet.effectiveFrom),
    effectiveUntil: serializeInstant(ruleSet.effectiveUntil),
  };
}

/** Round-trips a config value already sitting in a store (StoredRuleSet-shaped JSON) back into the typed union. Throws on corrupt data — a stored row this code itself wrote should never fail to parse. */
export function ruleSetFromStored(stored: StoredRuleSet): MerchantPolicyRuleSet {
  const rules = stored.rules.map((wire) => {
    const parsed = parseRuleConfig(wire);
    if (typeof parsed === "string") {
      throw new Error(`Corrupt stored policy rule for merchant ${stored.merchantId}: ${parsed}`);
    }
    return parsed;
  });
  const effectiveFrom = parseInstant(stored.effectiveFrom);
  const effectiveUntil = parseInstant(stored.effectiveUntil);
  if (!effectiveFrom.ok || !effectiveUntil.ok) {
    throw new Error(`Corrupt stored policy effective window for merchant ${stored.merchantId}`);
  }
  return {
    version: stored.version,
    merchantId: stored.merchantId,
    rules,
    effectiveFrom: effectiveFrom.value,
    effectiveUntil: effectiveUntil.value,
  };
}
