/**
 * Deterministic plain-language summary renderer.
 *
 * Given a CompiledMerchantPolicy, produces a stable human-readable
 * string array describing each active constraint. Output is sorted
 * and deterministically formatted for digest comparison.
 */

import type { CompiledMerchantPolicy } from "./compiler.js";

/**
 * Renders a deterministic plain-language summary of a compiled policy.
 *
 * The output is stable: identical inputs always produce identical output.
 * Lines are sorted alphabetically by constraint dimension.
 */
export function renderPolicySummary(policy: CompiledMerchantPolicy): readonly string[] {
  const lines: string[] = [];
  const c = policy.constraints;

  // Allowed categories
  if (c.allowedCategories.length > 0) {
    const sorted = [...c.allowedCategories].sort();
    lines.push(`Allowed categories: ${sorted.join(", ")}`);
  }

  // Allowed currencies
  if (c.allowedCurrencies.length > 0) {
    const sorted = [...c.allowedCurrencies].sort();
    lines.push(`Allowed currencies: ${sorted.join(", ")}`);
  }

  // Allowed destinations
  if (c.allowedDestinations.length > 0) {
    const sorted = [...c.allowedDestinations].sort();
    lines.push(`Allowed destinations: ${sorted.join(", ")}`);
  }

  // Allowed payment methods
  if (c.allowedPaymentPaths.length > 0) {
    const sorted = [...c.allowedPaymentPaths].sort();
    lines.push(`Allowed payment methods: ${sorted.join(", ")}`);
  }

  // Allowed products
  if (c.allowedProducts.length > 0) {
    const sorted = [...c.allowedProducts].sort();
    lines.push(`Allowed products: ${sorted.join(", ")}`);
  }

  // Cancellation policy
  if (
    policy.cancellationWindowMs !== undefined &&
    policy.cancellationRefundPercentage !== undefined
  ) {
    lines.push(
      `Cancellation allowed within ${String(policy.cancellationWindowMs)}ms with ${String(policy.cancellationRefundPercentage)}% refund`,
    );
  }

  // Count limit
  if (policy.countLimit !== undefined) {
    lines.push(
      `Count limit: max ${String(policy.countLimit.maxCount)} transactions per ${String(policy.countLimit.windowDurationMs)}ms window`,
    );
  }

  // Freshness requirement
  if (policy.freshnessMaxAgeMs !== undefined) {
    lines.push(`Freshness requirement: max age ${String(policy.freshnessMaxAgeMs)}ms`);
  }

  // Max amount
  lines.push(
    `Max amount: ${c.maxAmount.amountMinor.toString()} minor units (${c.maxAmount.currency})`,
  );

  // Max quantity
  lines.push(`Max quantity: ${c.maxQuantity.value} ${c.maxQuantity.unit}`);

  // Min amount
  lines.push(
    `Min amount: ${c.minAmount.amountMinor.toString()} minor units (${c.minAmount.currency})`,
  );

  // Operating window
  lines.push(
    `Operating window: ${new Date(c.timeWindow.allowedFrom).toISOString()} to ${new Date(c.timeWindow.allowedUntil).toISOString()}`,
  );

  // Partial refund
  if (policy.partialRefundAllowed !== undefined) {
    lines.push(`Partial refund: ${policy.partialRefundAllowed ? "allowed" : "not allowed"}`);
  }

  // Refund window
  if (policy.refundWindowMs !== undefined) {
    lines.push(`Refund window: ${String(policy.refundWindowMs)}ms`);
  }

  // Review threshold
  if (policy.reviewThresholdAmount !== undefined) {
    lines.push(
      `Review required above: ${policy.reviewThresholdAmount.amountMinor.toString()} minor units (${policy.reviewThresholdAmount.currency})`,
    );
  }

  // Source
  lines.push(`Source: ${c.source}`);

  // Version
  lines.push(`Version: ${String(policy.version)}`);

  // Sort for determinism
  return Object.freeze(lines.sort());
}
