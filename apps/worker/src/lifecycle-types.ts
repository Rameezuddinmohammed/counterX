/**
 * Shared types for the worker's lifecycle policy gate.
 *
 * Pulled out of lifecycle-policy.ts / real-lifecycle.ts into their own
 * module because those two files each need a type the OTHER one defines
 * (LifecyclePolicyPort, RecurringMandateLookupResult) — a real circular
 * `import type` between them, flagged by dependency-cruiser's no-circular
 * rule even though it's type-only and erased at compile time. Extracting
 * the shared shapes here breaks the cycle rather than weakening that rule
 * for the rest of the codebase.
 */

import type { PaymentAuthorizationRequest } from "./transaction-lifecycle.js";

// ─── Policy gate ─────────────────────────────────────────────────────────────

/**
 * Minimal policy decision seam. The full policy engine is not reachable from
 * the worker without violating dependency-cruiser (worker -> workflow only),
 * so the decision is kept as an explicit allow step here. A production wiring
 * can inject a real port implementing this shape.
 */
export interface LifecyclePolicyPort {
  allow(request: PaymentAuthorizationRequest): Promise<boolean>;
}

// ─── Recurring payment mandate re-verification ────────────────────────────────

/**
 * Durable state of a recurring payment mandate (wallet.recurring_payment_
 * mandates), as read independently by the worker — never trusted from the
 * job payload itself. Mirrors RecurringMandateSummary's shape from
 * apps/control-plane-api/src/recurring-mandate-store.ts.
 */
export interface RecurringMandateLookupResult {
  readonly status: "pending" | "active" | "revoked" | "cancelled";
  readonly validUntilMs: number;
  readonly ceilingMinor: bigint;
  readonly eligibleMerchants: readonly string[];
  /**
   * Razorpay's own opaque customer/token ids — needed by real-lifecycle.ts's
   * payment step to actually charge against this mandate. Never a raw
   * credential. providerTokenId is null until a pending registration is
   * confirmed (status would not be "active" yet in that case anyway).
   */
  readonly providerCustomerId: string;
  readonly providerTokenId: string | null;
}
