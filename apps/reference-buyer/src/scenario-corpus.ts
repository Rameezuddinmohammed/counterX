/**
 * Versioned scenario corpus for Counter Agent Wallet parity.
 *
 * Covers all 17 PILOT.md required scenarios:
 * - Happy paths (unattended, time-triggered, above-threshold)
 * - Provenance and verification paths
 * - Denial paths (non-allowlisted, non-India, disallowed category/currency/operation)
 * - Limit and expiry paths
 * - Security paths (self-bypass, duplicate/concurrent, conflicting idempotency)
 * - Uncertainty paths (process failure, timeout)
 *
 * Each scenario is deterministic and reproducible.
 */

import type { Instant, IsoCurrencyCode, MerchantId, WalletId } from "@counter/domain";
import type { CheckoutResult } from "./scenario-driver.js";

// ---------------------------------------------------------------------------
// Corpus Version
// ---------------------------------------------------------------------------

export const CORPUS_VERSION = "1.0.0";

// ---------------------------------------------------------------------------
// Scenario Types
// ---------------------------------------------------------------------------

export type ScenarioOutcome =
  | "success"
  | "declined"
  | "review_required"
  | "indeterminate"
  | "error";

export interface ScenarioContext {
  readonly walletId: WalletId;
  readonly merchantId: MerchantId;
  readonly now: Instant;
}

export interface ScenarioSetupResult {
  readonly context: ScenarioContext;
  readonly params: Readonly<Record<string, unknown>>;
}

export interface ScenarioAssertionInput {
  readonly result: CheckoutResult | undefined;
  readonly error?: Error;
  readonly context: ScenarioContext;
}

export interface ScenarioDefinition {
  readonly id: string;
  readonly name: string;
  readonly description: string;
  readonly expectedOutcome: ScenarioOutcome;
  readonly category: ScenarioCategory;
  readonly setup: (ctx: ScenarioContext) => ScenarioSetupResult;
  readonly assertion: (input: ScenarioAssertionInput) => boolean;
}

export type ScenarioCategory =
  | "happy_path"
  | "provenance"
  | "denial"
  | "limit_expiry"
  | "security"
  | "uncertainty";

// ---------------------------------------------------------------------------
// Test Constants
// ---------------------------------------------------------------------------

const TEST_WALLET_ID = "ctr_wallet_dGVzdC13YWxsZXQtMDAx" as WalletId;
const TEST_MERCHANT_ID = "ctr_merchant_dGVzdC1tZXJjaGFudC0w" as MerchantId;
const TEST_NONALLOWLISTED_MERCHANT = "ctr_merchant_bm9uLWFsbG93bGlzdGVk" as MerchantId;
const TEST_CURRENCY = "INR" as IsoCurrencyCode;
const TEST_NOW = 1737000000000 as Instant; // 2025-01-16T03:20:00.000Z

function makeContext(overrides?: Partial<ScenarioContext>): ScenarioContext {
  return Object.freeze({
    walletId: overrides?.walletId ?? TEST_WALLET_ID,
    merchantId: overrides?.merchantId ?? TEST_MERCHANT_ID,
    now: overrides?.now ?? TEST_NOW,
  });
}

// ---------------------------------------------------------------------------
// Scenario Definitions
// ---------------------------------------------------------------------------

const scenarios: readonly ScenarioDefinition[] = Object.freeze([
  // ─── Happy Paths ─────────────────────────────────────────────────────────

  {
    id: "SCENARIO-001",
    name: "Prompt-triggered unattended purchase below threshold",
    description:
      "Agent autonomously completes a purchase below the approval threshold within a valid mandate.",
    expectedOutcome: "success",
    category: "happy_path",
    setup: (ctx) => ({
      context: ctx,
      params: Object.freeze({
        amountMinor: 100_000n, // 1000 INR
        currency: TEST_CURRENCY,
        requiresApproval: false,
        triggerType: "prompt",
      }),
    }),
    assertion: (input) => input.result !== undefined && input.result.outcome === "success",
  },

  {
    id: "SCENARIO-002",
    name: "Time-triggered purchase within mandate",
    description: "Scheduled agent purchase triggered by time within mandate validity and limits.",
    expectedOutcome: "success",
    category: "happy_path",
    setup: (ctx) => ({
      context: ctx,
      params: Object.freeze({
        amountMinor: 50_000n, // 500 INR
        currency: TEST_CURRENCY,
        requiresApproval: false,
        triggerType: "time",
      }),
    }),
    assertion: (input) => input.result !== undefined && input.result.outcome === "success",
  },

  {
    id: "SCENARIO-003",
    name: "Above-threshold purchase with explicit approval",
    description:
      "Purchase exceeding the unattended threshold succeeds with valid explicit approval.",
    expectedOutcome: "success",
    category: "happy_path",
    setup: (ctx) => ({
      context: ctx,
      params: Object.freeze({
        amountMinor: 500_000n, // 5000 INR
        currency: TEST_CURRENCY,
        requiresApproval: true,
        approvalProvided: true,
        triggerType: "prompt",
      }),
    }),
    assertion: (input) => input.result !== undefined && input.result.outcome === "success",
  },

  // ─── Provenance Paths ────────────────────────────────────────────────────

  {
    id: "SCENARIO-004",
    name: "Search and quote provenance verification",
    description: "Verifies that quote digest matches the search result and price is consistent.",
    expectedOutcome: "success",
    category: "provenance",
    setup: (ctx) => ({
      context: ctx,
      params: Object.freeze({
        amountMinor: 200_000n, // 2000 INR
        currency: TEST_CURRENCY,
        verifyDigest: true,
      }),
    }),
    assertion: (input) => input.result !== undefined && input.result.outcome === "success",
  },

  {
    id: "SCENARIO-005",
    name: "Test payment full lifecycle with receipt verification",
    description: "Complete checkout lifecycle with independent receipt verification at the end.",
    expectedOutcome: "success",
    category: "provenance",
    setup: (ctx) => ({
      context: ctx,
      params: Object.freeze({
        amountMinor: 150_000n, // 1500 INR
        currency: TEST_CURRENCY,
        verifyReceipt: true,
      }),
    }),
    assertion: (input) =>
      input.result !== undefined &&
      input.result.outcome === "success" &&
      input.result.receiptId !== undefined,
  },

  {
    id: "SCENARIO-006",
    name: "Razorpay PAYMENT_ACTION_REQUIRED flow",
    description:
      "Payment triggers action_required which results in review_required outcome in autonomous mode.",
    expectedOutcome: "review_required",
    category: "provenance",
    setup: (ctx) => ({
      context: ctx,
      params: Object.freeze({
        amountMinor: 300_000n, // 3000 INR
        currency: TEST_CURRENCY,
        simulateActionRequired: true,
      }),
    }),
    assertion: (input) => input.result !== undefined && input.result.outcome === "review_required",
  },

  // ─── Denial Paths ────────────────────────────────────────────────────────

  {
    id: "SCENARIO-007",
    name: "Non-allowlisted merchant denial",
    description: "Purchase attempt to a merchant not in the allowlist is denied before checkout.",
    expectedOutcome: "declined",
    category: "denial",
    setup: (ctx) => ({
      context: makeContext({ ...ctx, merchantId: TEST_NONALLOWLISTED_MERCHANT }),
      params: Object.freeze({
        amountMinor: 100_000n,
        currency: TEST_CURRENCY,
        merchantAllowlisted: false,
      }),
    }),
    assertion: (input) => input.result !== undefined && input.result.outcome === "declined",
  },

  {
    id: "SCENARIO-008",
    name: "Non-India region denial",
    description:
      "Purchase attempt to a merchant outside India is denied (pilot geographic constraint).",
    expectedOutcome: "declined",
    category: "denial",
    setup: (ctx) => ({
      context: ctx,
      params: Object.freeze({
        amountMinor: 100_000n,
        currency: TEST_CURRENCY,
        region: "US",
        regionAllowed: false,
      }),
    }),
    assertion: (input) => input.result !== undefined && input.result.outcome === "declined",
  },

  {
    id: "SCENARIO-009",
    name: "Disallowed category/currency/operation denial",
    description: "Purchase with non-INR currency or disallowed category is denied by policy.",
    expectedOutcome: "declined",
    category: "denial",
    setup: (ctx) => ({
      context: ctx,
      params: Object.freeze({
        amountMinor: 100_000n,
        currency: "USD" as IsoCurrencyCode,
        disallowedCurrency: true,
      }),
    }),
    assertion: (input) => input.result !== undefined && input.result.outcome === "declined",
  },

  // ─── Limit and Expiry Paths ──────────────────────────────────────────────

  {
    id: "SCENARIO-010",
    name: "Transaction limit breach",
    description: "Purchase exceeding rolling limit or per-transaction ceiling is denied.",
    expectedOutcome: "declined",
    category: "limit_expiry",
    setup: (ctx) => ({
      context: ctx,
      params: Object.freeze({
        amountMinor: 100_000_000n, // 1,000,000 INR - exceeds ceiling
        currency: TEST_CURRENCY,
        exceedsLimit: true,
      }),
    }),
    assertion: (input) => input.result !== undefined && input.result.outcome === "declined",
  },

  {
    id: "SCENARIO-011",
    name: "Expired mandate/intent/approval rejection",
    description: "Purchase with expired mandate, intent, or approval is rejected.",
    expectedOutcome: "declined",
    category: "limit_expiry",
    setup: (ctx) => {
      const pastTime = (ctx.now - 2 * 60 * 60 * 1000) as Instant; // 2 hours ago
      return {
        context: ctx,
        params: Object.freeze({
          amountMinor: 100_000n,
          currency: TEST_CURRENCY,
          mandateExpired: true,
          mandateExpiresAt: pastTime,
        }),
      };
    },
    assertion: (input) => input.result !== undefined && input.result.outcome === "declined",
  },

  {
    id: "SCENARIO-012",
    name: "Material change detection",
    description:
      "Quote price changed between intent creation and checkout execution, causing denial.",
    expectedOutcome: "declined",
    category: "limit_expiry",
    setup: (ctx) => ({
      context: ctx,
      params: Object.freeze({
        amountMinor: 200_000n,
        currency: TEST_CURRENCY,
        materialChange: true,
        originalQuoteDigest: "sha256:original",
        currentQuoteDigest: "sha256:changed",
      }),
    }),
    assertion: (input) => input.result !== undefined && input.result.outcome === "declined",
  },

  // ─── Security Paths ──────────────────────────────────────────────────────

  {
    id: "SCENARIO-013",
    name: "Approval self-bypass attempt",
    description:
      "Agent attempts to approve its own above-threshold transaction (same principal). Denied.",
    expectedOutcome: "declined",
    category: "security",
    setup: (ctx) => ({
      context: ctx,
      params: Object.freeze({
        amountMinor: 500_000n,
        currency: TEST_CURRENCY,
        requiresApproval: true,
        selfApprovalAttempt: true,
      }),
    }),
    assertion: (input) => input.result !== undefined && input.result.outcome === "declined",
  },

  {
    id: "SCENARIO-014",
    name: "Duplicate/concurrent single-effect guarantee",
    description: "Concurrent duplicate requests produce at most one payment effect (idempotency).",
    expectedOutcome: "success",
    category: "security",
    setup: (ctx) => ({
      context: ctx,
      params: Object.freeze({
        amountMinor: 100_000n,
        currency: TEST_CURRENCY,
        duplicateRequest: true,
        idempotencyKey: "idem-test-duplicate-001",
      }),
    }),
    assertion: (input) => input.result !== undefined && input.result.outcome === "success",
  },

  {
    id: "SCENARIO-015",
    name: "Conflicting idempotency key rejection",
    description: "Same idempotency key with different parameters is rejected.",
    expectedOutcome: "declined",
    category: "security",
    setup: (ctx) => ({
      context: ctx,
      params: Object.freeze({
        amountMinor: 100_000n,
        currency: TEST_CURRENCY,
        conflictingIdempotency: true,
        idempotencyKey: "idem-test-conflict-001",
        originalAmount: 50_000n,
      }),
    }),
    assertion: (input) => input.result !== undefined && input.result.outcome === "declined",
  },

  // ─── Uncertainty Paths ───────────────────────────────────────────────────

  {
    id: "SCENARIO-016",
    name: "Process failure before/after intent",
    description:
      "System failure during checkout results in indeterminate state with compensation flag.",
    expectedOutcome: "indeterminate",
    category: "uncertainty",
    setup: (ctx) => ({
      context: ctx,
      params: Object.freeze({
        amountMinor: 100_000n,
        currency: TEST_CURRENCY,
        simulateProcessFailure: true,
        failurePhase: "payment_execution",
      }),
    }),
    assertion: (input) => input.result !== undefined && input.result.outcome === "indeterminate",
  },

  {
    id: "SCENARIO-017",
    name: "Payment timeout indeterminate",
    description:
      "Payment provider timeout results in indeterminate state requiring manual resolution.",
    expectedOutcome: "indeterminate",
    category: "uncertainty",
    setup: (ctx) => ({
      context: ctx,
      params: Object.freeze({
        amountMinor: 100_000n,
        currency: TEST_CURRENCY,
        simulateTimeout: true,
      }),
    }),
    assertion: (input) => input.result !== undefined && input.result.outcome === "indeterminate",
  },
]);

// ---------------------------------------------------------------------------
// Corpus API
// ---------------------------------------------------------------------------

/**
 * Returns the full immutable scenario corpus.
 */
export function getScenarioCorpus(): readonly ScenarioDefinition[] {
  return scenarios;
}

/**
 * Gets a single scenario by ID.
 */
export function getScenarioById(id: string): ScenarioDefinition | undefined {
  return scenarios.find((s) => s.id === id);
}

/**
 * Gets scenarios by category.
 */
export function getScenariosByCategory(category: ScenarioCategory): readonly ScenarioDefinition[] {
  return scenarios.filter((s) => s.category === category);
}

/**
 * Returns the count of all scenarios in the corpus.
 */
export function getScenarioCount(): number {
  return scenarios.length;
}
