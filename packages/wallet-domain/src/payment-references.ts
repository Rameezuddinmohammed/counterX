/**
 * Opaque payment authorization references for Counter wallet.
 *
 * Payment references are wallet-bound, principal-bound, environment-scoped
 * tokens that authorize specific operations. They are deliberately opaque:
 * the type system enforces that NO balance, top-up, raw credential, PAN, CVV,
 * UPI PIN, bank credential, provider secret, or token fields exist.
 *
 * CounterTestAuthorization is a test-only specialization that can only operate
 * in sandbox/test environments and is rejected by any live adapter check.
 */

import type { CounterId } from "@counter/domain";

// ---------------------------------------------------------------------------
// Payment Reference Environment
// ---------------------------------------------------------------------------

export const PAYMENT_REFERENCE_ENVIRONMENTS = ["sandbox", "pilot", "production"] as const;

export type PaymentReferenceEnvironment = (typeof PAYMENT_REFERENCE_ENVIRONMENTS)[number];

const paymentReferenceEnvironmentSet: ReadonlySet<string> = new Set(PAYMENT_REFERENCE_ENVIRONMENTS);

export function isPaymentReferenceEnvironment(
  value: unknown,
): value is PaymentReferenceEnvironment {
  return typeof value === "string" && paymentReferenceEnvironmentSet.has(value);
}

// ---------------------------------------------------------------------------
// Payment Reference Status
// ---------------------------------------------------------------------------

export const PAYMENT_REFERENCE_STATUSES = ["active", "revoked"] as const;

export type PaymentReferenceStatus = (typeof PAYMENT_REFERENCE_STATUSES)[number];

// ---------------------------------------------------------------------------
// Payment Authorization Reference (opaque, wallet-bound)
// ---------------------------------------------------------------------------

/**
 * Opaque payment authorization reference. Bound to a specific wallet,
 * principal, environment, and validity window. Contains NO balance,
 * credential, or provider-secret fields by design.
 */
export interface PaymentAuthorizationReference {
  readonly referenceId: string;
  readonly walletId: CounterId<"wallet">;
  readonly principalId: CounterId<"actor">;
  readonly environment: PaymentReferenceEnvironment;
  readonly adapter: string;
  readonly status: PaymentReferenceStatus;
  readonly validFrom: string;
  readonly validUntil: string;
  readonly eligibleMerchants: readonly string[];
  readonly eligibleOperations: readonly string[];
}

// ---------------------------------------------------------------------------
// Counter Test Authorization
// ---------------------------------------------------------------------------

/**
 * Test-only payment authorization reference. Extends the base opaque
 * reference with an explicit testOnly literal marker and bounded test
 * constraints (amount ceiling, INR currency).
 *
 * This type is ONLY valid in sandbox environments and is rejected by
 * any live adapter check or production environment validation.
 */
export interface CounterTestAuthorization extends PaymentAuthorizationReference {
  readonly adapter: "counter_test_provider";
  readonly testOnly: true;
  readonly amountCeilingPaise: bigint;
  readonly currency: "INR";
}

// ---------------------------------------------------------------------------
// Factory: createCounterTestReference
// ---------------------------------------------------------------------------

export interface CreateCounterTestReferenceParams {
  readonly referenceId: string;
  readonly walletId: CounterId<"wallet">;
  readonly principalId: CounterId<"actor">;
  readonly validFrom: string;
  readonly validUntil: string;
  readonly amountCeilingPaise: bigint;
  readonly eligibleMerchants: readonly string[];
  readonly eligibleOperations: readonly string[];
}

/**
 * Creates a CounterTestAuthorization bound to the sandbox environment.
 */
export function createCounterTestReference(
  params: CreateCounterTestReferenceParams,
): CounterTestAuthorization {
  return {
    referenceId: params.referenceId,
    walletId: params.walletId,
    principalId: params.principalId,
    environment: "sandbox",
    adapter: "counter_test_provider",
    status: "active",
    validFrom: params.validFrom,
    validUntil: params.validUntil,
    eligibleMerchants: params.eligibleMerchants,
    eligibleOperations: params.eligibleOperations,
    testOnly: true,
    amountCeilingPaise: params.amountCeilingPaise,
    currency: "INR",
  };
}

// ---------------------------------------------------------------------------
// Razorpay Recurring Authorization
// ---------------------------------------------------------------------------

/**
 * A real (non-test) payment authorization reference backed by a Razorpay
 * recurring-payment token — a UPI Autopay / e-mandate style authorization
 * the wallet owner approves once (human-authenticated, through Razorpay's
 * own checkout widget) so their agent can then draw repeated, variable-
 * amount charges against it, up to ceilingPaise, without a fresh checkout
 * each time.
 *
 * Deliberately NOT named after Razorpay's "Subscriptions" product: that's a
 * fixed-amount, fixed-interval, Razorpay-scheduled billing primitive — the
 * wrong fit here, since the agent (not Razorpay's clock) decides when and
 * how much to charge. This wraps Razorpay's Tokens/Recurring-Payments API
 * instead (customer + token, on-demand variable charges against them).
 *
 * providerCustomerId/providerTokenId are Razorpay's own opaque identifiers
 * (cust_xxx / token_xxx) — never a UPI VPA, bank account number, or card
 * detail, consistent with this file's base "no raw credential" invariant.
 */
export interface RazorpayRecurringAuthorization extends PaymentAuthorizationReference {
  readonly adapter: "razorpay_recurring";
  readonly providerCustomerId: string;
  readonly providerTokenId: string;
  readonly ceilingPaise: bigint;
  readonly currency: "INR";
}

export interface CreateRazorpayRecurringReferenceParams {
  readonly referenceId: string;
  readonly walletId: CounterId<"wallet">;
  readonly principalId: CounterId<"actor">;
  readonly environment: Exclude<PaymentReferenceEnvironment, "sandbox">;
  readonly providerCustomerId: string;
  readonly providerTokenId: string;
  readonly ceilingPaise: bigint;
  readonly validFrom: string;
  readonly validUntil: string;
  readonly eligibleMerchants: readonly string[];
  readonly eligibleOperations: readonly string[];
}

/**
 * Creates an active RazorpayRecurringAuthorization. Only valid for pilot/
 * production — never sandbox, enforced by the parameter type itself
 * (isTestEnvironmentOnly independently rejects it in sandbox at the
 * adapter-name check below, as defense in depth).
 */
export function createRazorpayRecurringReference(
  params: CreateRazorpayRecurringReferenceParams,
): RazorpayRecurringAuthorization {
  return {
    referenceId: params.referenceId,
    walletId: params.walletId,
    principalId: params.principalId,
    environment: params.environment,
    adapter: "razorpay_recurring",
    status: "active",
    validFrom: params.validFrom,
    validUntil: params.validUntil,
    eligibleMerchants: params.eligibleMerchants,
    eligibleOperations: params.eligibleOperations,
    providerCustomerId: params.providerCustomerId,
    providerTokenId: params.providerTokenId,
    ceilingPaise: params.ceilingPaise,
    currency: "INR",
  };
}

// ---------------------------------------------------------------------------
// Environment Validation
// ---------------------------------------------------------------------------

/**
 * Validates that a reference is test-only and rejects it outside test
 * environments (sandbox). Returns false if the reference is used in
 * pilot or production.
 */
export function isTestEnvironmentOnly(
  ref: PaymentAuthorizationReference,
  currentEnvironment: PaymentReferenceEnvironment,
): boolean {
  // If the reference is a test-only reference (adapter = counter_test_provider)
  // it must only be used in sandbox
  if (ref.adapter === "counter_test_provider") {
    return currentEnvironment === "sandbox";
  }
  // Non-test references should NOT be used in sandbox
  return currentEnvironment !== "sandbox";
}

// ---------------------------------------------------------------------------
// Payment Reference Repository
// ---------------------------------------------------------------------------

/**
 * Repository port for payment authorization references.
 */
export interface PaymentReferenceRepository {
  findById(referenceId: string): PaymentAuthorizationReference | undefined;
  findByWallet(walletId: CounterId<"wallet">): readonly PaymentAuthorizationReference[];
  findByPrincipal(principalId: CounterId<"actor">): readonly PaymentAuthorizationReference[];
  findActive(walletId: CounterId<"wallet">): readonly PaymentAuthorizationReference[];
  save(reference: PaymentAuthorizationReference): void;
  updateStatus(referenceId: string, status: PaymentReferenceStatus): void;
}

// ---------------------------------------------------------------------------
// In-Memory Payment Reference Repository
// ---------------------------------------------------------------------------

/**
 * In-memory implementation of PaymentReferenceRepository for testing.
 */
export class InMemoryPaymentReferenceRepository implements PaymentReferenceRepository {
  readonly #references = new Map<string, PaymentAuthorizationReference>();

  findById(referenceId: string): PaymentAuthorizationReference | undefined {
    return this.#references.get(referenceId);
  }

  findByWallet(walletId: CounterId<"wallet">): readonly PaymentAuthorizationReference[] {
    return [...this.#references.values()].filter((r) => r.walletId === walletId);
  }

  findByPrincipal(principalId: CounterId<"actor">): readonly PaymentAuthorizationReference[] {
    return [...this.#references.values()].filter((r) => r.principalId === principalId);
  }

  findActive(walletId: CounterId<"wallet">): readonly PaymentAuthorizationReference[] {
    return [...this.#references.values()].filter(
      (r) => r.walletId === walletId && r.status === "active",
    );
  }

  save(reference: PaymentAuthorizationReference): void {
    this.#references.set(reference.referenceId, reference);
  }

  updateStatus(referenceId: string, status: PaymentReferenceStatus): void {
    const existing = this.#references.get(referenceId);
    if (existing) {
      this.#references.set(referenceId, { ...existing, status });
    }
  }
}
