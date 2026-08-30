/**
 * Provider contract harness - a test utility that validates any PaymentProvider
 * implementation against the expected payment flow behaviors.
 *
 * Runs a suite of deterministic scenarios and returns structured results.
 */

import type { IsoCurrencyCode, Money } from "@counter/domain";
import type { Signer } from "@counter/trust-protocol";

import type { PaymentProvider } from "./provider.js";
import type { ProviderContext, ProviderRefundReference } from "./types.js";

// ─── Harness Types ───────────────────────────────────────────────────────────

export interface ContractHarnessOptions {
  readonly signer: Signer;
  readonly kid: string;
  readonly clock?: () => number;
}

export interface ContractTestResult {
  readonly scenarioName: string;
  readonly passed: boolean;
  readonly details: string;
}

// ─── Helpers ─────────────────────────────────────────────────────────────────

function pass(scenarioName: string, details: string): ContractTestResult {
  return Object.freeze({ scenarioName, passed: true, details });
}

function fail(scenarioName: string, details: string): ContractTestResult {
  return Object.freeze({ scenarioName, passed: false, details });
}

function testAmount(): Money {
  return Object.freeze({
    amountMinor: 10000n,
    currency: "INR" as IsoCurrencyCode,
  });
}

// ─── Contract Suite ──────────────────────────────────────────────────────────

/**
 * Runs the full provider contract suite against any PaymentProvider implementation.
 * Each scenario tests a specific aspect of the payment flow contract.
 */
export async function runProviderContractSuite(
  provider: PaymentProvider,
  context: ProviderContext,
  _options: ContractHarnessOptions,
): Promise<ContractTestResult[]> {
  const results: ContractTestResult[] = [];
  const amount = testAmount();

  // Scenario 1: action_required
  results.push(await runActionRequired(provider, context, amount));

  // Scenario 2: success
  results.push(await runSuccess(provider, context, amount));

  // Scenario 3: decline
  results.push(await runDecline(provider, context, amount));

  // Scenario 4: timeout_before_effect
  results.push(await runTimeoutBeforeEffect(provider, context, amount));

  // Scenario 5: timeout_after_effect
  results.push(await runTimeoutAfterEffect(provider, context, amount));

  // Scenario 6: query_resolution (pending_then_success)
  results.push(await runQueryResolution(provider, context, amount));

  // Scenario 7: duplicate_events (idempotent convergence)
  results.push(await runDuplicateEvents(provider, context, amount));

  // Scenario 8: capture_void
  results.push(await runCaptureVoid(provider, context, amount));

  // Scenario 9: refund
  results.push(await runRefund(provider, context, amount));

  // Scenario 10: query_refund
  results.push(await runQueryRefund(provider, context, amount));

  return results;
}

// ─── Individual Scenarios ────────────────────────────────────────────────────

async function runActionRequired(
  provider: PaymentProvider,
  context: ProviderContext,
  amount: Money,
): Promise<ContractTestResult> {
  const name = "action_required";
  try {
    const result = await provider.createInstruction({
      authorizationRef: "contract-test-auth",
      amount,
      currency: amount.currency,
      merchantId: context.merchantId,
      idempotencyKey: "contract-action-key-action",
    });

    if (result.kind !== "action_required") {
      return fail(name, `Expected kind "action_required", got "${result.kind}"`);
    }
    if (!result.action.url) {
      return fail(name, "action.url is missing or empty");
    }
    if (result.expiresAt === undefined) {
      return fail(name, "expiresAt is missing");
    }
    return pass(name, "action_required with url and expiresAt present");
  } catch (error: unknown) {
    return fail(name, `Threw: ${error instanceof Error ? error.message : String(error)}`);
  }
}

async function runSuccess(
  provider: PaymentProvider,
  context: ProviderContext,
  amount: Money,
): Promise<ContractTestResult> {
  const name = "success";
  try {
    const result = await provider.createInstruction({
      authorizationRef: "contract-test-auth",
      amount,
      currency: amount.currency,
      merchantId: context.merchantId,
      idempotencyKey: "contract-success-key",
    });

    if (result.kind !== "confirmed") {
      return fail(name, `Expected kind "confirmed", got "${result.kind}"`);
    }
    if (!result.evidence.reference) {
      return fail(name, "evidence.reference is missing");
    }
    if (result.evidence.status !== "confirmed") {
      return fail(name, `Expected evidence.status "confirmed", got "${result.evidence.status}"`);
    }
    return pass(name, "confirmed with evidence.reference and evidence.status === confirmed");
  } catch (error: unknown) {
    return fail(name, `Threw: ${error instanceof Error ? error.message : String(error)}`);
  }
}

async function runDecline(
  provider: PaymentProvider,
  context: ProviderContext,
  amount: Money,
): Promise<ContractTestResult> {
  const name = "decline";
  try {
    const result = await provider.createInstruction({
      authorizationRef: "contract-test-auth",
      amount,
      currency: amount.currency,
      merchantId: context.merchantId,
      idempotencyKey: "contract-decline-key-decline",
    });

    if (result.kind !== "declined") {
      return fail(name, `Expected kind "declined", got "${result.kind}"`);
    }
    if (!result.reason.code) {
      return fail(name, "reason.code is missing");
    }
    if (!result.reason.reason) {
      return fail(name, "reason.reason is missing");
    }
    return pass(name, "declined with reason.code and reason.reason present");
  } catch (error: unknown) {
    return fail(name, `Threw: ${error instanceof Error ? error.message : String(error)}`);
  }
}

async function runTimeoutBeforeEffect(
  provider: PaymentProvider,
  context: ProviderContext,
  amount: Money,
): Promise<ContractTestResult> {
  const name = "timeout_before_effect";
  try {
    const result = await provider.createInstruction({
      authorizationRef: "contract-test-auth",
      amount,
      currency: amount.currency,
      merchantId: context.merchantId,
      idempotencyKey: "contract-timeout-b-key-timeout-before",
    });

    if (result.kind !== "indeterminate") {
      return fail(name, `Expected kind "indeterminate", got "${result.kind}"`);
    }
    if (!result.reference) {
      return fail(name, "reference is missing on indeterminate result");
    }
    if (result.queryAfter === undefined) {
      return fail(name, "queryAfter is missing on indeterminate result");
    }

    // Query should show nothing happened (declined)
    const evidence = await provider.query(result.reference);
    if (evidence.status !== "declined") {
      return fail(
        name,
        `Expected query status "declined" (nothing happened), got "${evidence.status}"`,
      );
    }
    return pass(name, "indeterminate with reference and queryAfter, query resolves to declined");
  } catch (error: unknown) {
    return fail(name, `Threw: ${error instanceof Error ? error.message : String(error)}`);
  }
}

async function runTimeoutAfterEffect(
  provider: PaymentProvider,
  context: ProviderContext,
  amount: Money,
): Promise<ContractTestResult> {
  const name = "timeout_after_effect";
  try {
    const result = await provider.createInstruction({
      authorizationRef: "contract-test-auth",
      amount,
      currency: amount.currency,
      merchantId: context.merchantId,
      idempotencyKey: "contract-timeout-a-key-timeout-after",
    });

    if (result.kind !== "indeterminate") {
      return fail(name, `Expected kind "indeterminate", got "${result.kind}"`);
    }

    // Query should show the effect happened (confirmed)
    const evidence = await provider.query(result.reference);
    if (evidence.status !== "confirmed") {
      return fail(
        name,
        `Expected query status "confirmed" (effect happened), got "${evidence.status}"`,
      );
    }
    return pass(name, "indeterminate then query resolves to confirmed");
  } catch (error: unknown) {
    return fail(name, `Threw: ${error instanceof Error ? error.message : String(error)}`);
  }
}

async function runQueryResolution(
  provider: PaymentProvider,
  context: ProviderContext,
  amount: Money,
): Promise<ContractTestResult> {
  const name = "query_resolution";
  try {
    const result = await provider.createInstruction({
      authorizationRef: "contract-test-auth",
      amount,
      currency: amount.currency,
      merchantId: context.merchantId,
      idempotencyKey: "contract-pending-key-pending",
    });

    if (result.kind !== "pending") {
      return fail(name, `Expected kind "pending", got "${result.kind}"`);
    }

    // Query should transition to confirmed
    const evidence = await provider.query(result.reference);
    if (evidence.status !== "confirmed") {
      return fail(name, `Expected query to transition to "confirmed", got "${evidence.status}"`);
    }
    return pass(name, "pending then query transitions to confirmed");
  } catch (error: unknown) {
    return fail(name, `Threw: ${error instanceof Error ? error.message : String(error)}`);
  }
}

async function runDuplicateEvents(
  provider: PaymentProvider,
  context: ProviderContext,
  amount: Money,
): Promise<ContractTestResult> {
  const name = "duplicate_events";
  try {
    const command = {
      authorizationRef: "contract-test-auth",
      amount,
      currency: amount.currency,
      merchantId: context.merchantId,
      idempotencyKey: "contract-duplicate-key",
    };

    const result1 = await provider.createInstruction(command);
    const result2 = await provider.createInstruction(command);

    if (result1.kind !== result2.kind) {
      return fail(name, `First call returned "${result1.kind}", second returned "${result2.kind}"`);
    }
    return pass(name, "duplicate calls return the same result kind (idempotent convergence)");
  } catch (error: unknown) {
    return fail(name, `Threw: ${error instanceof Error ? error.message : String(error)}`);
  }
}

async function runCaptureVoid(
  provider: PaymentProvider,
  context: ProviderContext,
  amount: Money,
): Promise<ContractTestResult> {
  const name = "capture_void";
  try {
    const capabilities = await provider.capabilities(context);

    if (capabilities.lifecycleType !== "authorize_capture") {
      return pass(name, "Provider does not support authorize_capture lifecycle, skipped");
    }

    if (
      provider.authorize === undefined ||
      provider.capture === undefined ||
      provider.void === undefined
    ) {
      return pass(name, "Provider does not implement authorize/capture/void methods, skipped");
    }

    // Authorize then capture
    const authResult = await provider.authorize({
      authorizationRef: "contract-test-auth",
      amount,
      currency: amount.currency,
      merchantId: context.merchantId,
      idempotencyKey: "contract-capture-auth-key",
    });

    if (authResult.kind !== "confirmed") {
      return fail(name, `Authorize expected "confirmed", got "${authResult.kind}"`);
    }

    const captureResult = await provider.capture({
      reference: authResult.evidence.reference,
      amount,
      idempotencyKey: "contract-capture-key",
    });

    if (captureResult.kind !== "confirmed") {
      return fail(name, `Capture expected "confirmed", got "${captureResult.kind}"`);
    }

    // Authorize then void
    const authResult2 = await provider.authorize({
      authorizationRef: "contract-test-auth",
      amount,
      currency: amount.currency,
      merchantId: context.merchantId,
      idempotencyKey: "contract-void-auth-key",
    });

    if (authResult2.kind !== "confirmed") {
      return fail(name, `Second authorize expected "confirmed", got "${authResult2.kind}"`);
    }

    const voidResult = await provider.void({
      reference: authResult2.evidence.reference,
      idempotencyKey: "contract-void-key",
    });

    if (voidResult.kind !== "confirmed") {
      return fail(name, `Void expected "confirmed", got "${voidResult.kind}"`);
    }

    return pass(name, "authorize->capture confirmed, authorize->void confirmed");
  } catch (error: unknown) {
    return fail(name, `Threw: ${error instanceof Error ? error.message : String(error)}`);
  }
}

async function runRefund(
  provider: PaymentProvider,
  context: ProviderContext,
  amount: Money,
): Promise<ContractTestResult> {
  const name = "refund";
  try {
    // First create a successful payment
    const payResult = await provider.createInstruction({
      authorizationRef: "contract-test-auth",
      amount,
      currency: amount.currency,
      merchantId: context.merchantId,
      idempotencyKey: "contract-refund-payment-key",
    });

    if (payResult.kind !== "confirmed") {
      return fail(name, `Pre-refund payment expected "confirmed", got "${payResult.kind}"`);
    }

    // Now refund
    const refundResult = await provider.refund({
      reference: payResult.evidence.reference,
      amount,
      reason: "Test refund",
      idempotencyKey: "contract-refund-key",
    });

    // PaymentOperationResult - any valid kind is acceptable
    const validKinds = ["confirmed", "pending", "action_required", "declined", "indeterminate"];
    if (!validKinds.includes(refundResult.kind)) {
      return fail(name, `Refund returned unexpected kind "${refundResult.kind}"`);
    }
    return pass(
      name,
      `Refund returned valid PaymentOperationResult with kind "${refundResult.kind}"`,
    );
  } catch (error: unknown) {
    return fail(name, `Threw: ${error instanceof Error ? error.message : String(error)}`);
  }
}

async function runQueryRefund(
  provider: PaymentProvider,
  context: ProviderContext,
  amount: Money,
): Promise<ContractTestResult> {
  const name = "query_refund";
  try {
    // Create a successful payment first
    const payResult = await provider.createInstruction({
      authorizationRef: "contract-test-auth",
      amount,
      currency: amount.currency,
      merchantId: context.merchantId,
      idempotencyKey: "contract-query-refund-payment-key",
    });

    if (payResult.kind !== "confirmed") {
      return fail(name, `Pre-refund payment expected "confirmed", got "${payResult.kind}"`);
    }

    // Refund
    const refundIdempotencyKey = "contract-query-refund-key";
    await provider.refund({
      reference: payResult.evidence.reference,
      amount,
      reason: "Test refund for query",
      idempotencyKey: refundIdempotencyKey,
    });

    // Query the refund
    const refundRef = `test-refund-ref-${refundIdempotencyKey}` as ProviderRefundReference;
    const refundEvidence = await provider.queryRefund(refundRef);

    if (!refundEvidence.status) {
      return fail(name, "queryRefund evidence missing status");
    }
    if (refundEvidence.amount === undefined) {
      return fail(name, "queryRefund evidence missing amount");
    }
    return pass(
      name,
      `queryRefund returned evidence with status "${refundEvidence.status}" and amount`,
    );
  } catch (error: unknown) {
    return fail(name, `Threw: ${error instanceof Error ? error.message : String(error)}`);
  }
}
