/**
 * Boot-time connector selection for the worker.
 *
 * Resolves Shopify + Razorpay credentials via the shared credential-gating
 * helper (connector-env) and selects the PaymentAuthorizationPort used by the
 * transaction-lifecycle handler:
 *
 *   - BOTH sets of credentials present  -> the REAL connector-backed port
 *     (real Shopify connector + real Razorpay provider + a CTP-signed
 *     CounterTestPaymentProvider for the unattended authorize/capture).
 *   - credentials absent in local/test  -> the deterministic in-process
 *     stand-in so existing tests and local runs are unaffected.
 *   - prod-like and credentials missing -> the FEAT-001 helper throws
 *     (fail loud) BEFORE we reach the fallback.
 *
 * SECURITY: credentials are read from the environment only and are passed
 * directly into the connector factories. They are never logged or echoed.
 */

import { createCounterId } from "@counter/domain";
import type { MerchantId } from "@counter/domain";
import { createTestSignerA, TEST_KID_A } from "@counter/trust-protocol";
import { createShopifyConnectorFromConfig } from "@counter/shopify-connector";
import { createRealRazorpayProvider } from "@counter/razorpay-adapter";
import { CounterTestPaymentProvider } from "@counter/payment-sdk";
import { PostgresStepLedger } from "@counter/data";
import type { AsyncStepLedger } from "@counter/data";
import type { Instant } from "@counter/domain";
import { instantFromEpochMilliseconds } from "@counter/domain";

import {
  requireShopifyCredentials,
  requireRazorpayCredentials,
  type EnvironmentBag,
} from "./connector-env.js";
import { createRealPaymentAuthorizationPort } from "./real-lifecycle.js";
import type {
  RealLifecycleConfig,
  StepLedgerEntry,
  StepLedgerPort,
} from "./real-lifecycle.js";
import type {
  PaymentAuthorizationPort,
  PaymentAuthorizationRequest,
  PaymentAuthorizationResult,
} from "./transaction-lifecycle.js";

// ─── Deterministic stand-in ──────────────────────────────────────────────────

/**
 * The deterministic in-process PaymentAuthorizationPort used when connector
 * credentials are absent (local/test). It moves no real money and trivially
 * satisfies the per-transactionId idempotency contract: the same request
 * always yields the same result. This preserves the existing worker behavior.
 */
export function createDeterministicPaymentAuthorizationPort(): PaymentAuthorizationPort {
  return {
    authorizeAndCapture(
      request: PaymentAuthorizationRequest,
    ): Promise<PaymentAuthorizationResult> {
      return Promise.resolve(
        Object.freeze({
          status: "captured" as const,
          capturedMinor: request.amountMinor,
          providerReference: `deterministic:${request.idempotencyKey}`,
        }),
      );
    },
  };
}

// ─── Selection result ────────────────────────────────────────────────────────

export type ConnectorMode = "real" | "deterministic";

export interface SelectedPaymentPort {
  readonly mode: ConnectorMode;
  readonly port: PaymentAuthorizationPort;
}

// ─── Selection ───────────────────────────────────────────────────────────────

/**
 * Selects the PaymentAuthorizationPort for the given environment.
 *
 * Optional `overrides` allow tests to inject connector doubles without real
 * credentials; when omitted the real factories are constructed from resolved
 * credentials.
 */
export function selectPaymentAuthorizationPort(
  env: EnvironmentBag,
  overrides?: Partial<
    Pick<RealLifecycleConfig, "variantResolver" | "policy" | "actionTimeoutMs" | "stepLedger">
  >,
): SelectedPaymentPort {
  // Fail loud in prod-like environments when credentials are missing; return
  // null (mock-eligible) in local/test.
  const shopifyCreds = requireShopifyCredentials(env);
  const razorpayCreds = requireRazorpayCredentials(env);

  if (shopifyCreds === null || razorpayCreds === null) {
    return { mode: "deterministic", port: createDeterministicPaymentAuthorizationPort() };
  }

  const bundle = buildRealConnectorBundle(shopifyCreds, razorpayCreds);

  const config: RealLifecycleConfig = {
    shopify: bundle.shopify,
    razorpay: bundle.razorpay,
    payments: bundle.payments,
    merchantId: bundle.merchantId,
    ...(overrides?.policy !== undefined ? { policy: overrides.policy } : {}),
    ...(overrides?.variantResolver !== undefined ? { variantResolver: overrides.variantResolver } : {}),
    ...(overrides?.actionTimeoutMs !== undefined ? { actionTimeoutMs: overrides.actionTimeoutMs } : {}),
    ...(overrides?.stepLedger !== undefined ? { stepLedger: overrides.stepLedger } : {}),
  };

  return { mode: "real", port: createRealPaymentAuthorizationPort(config) };
}

// ─── Real connector bundle ───────────────────────────────────────────────────

/**
 * The real connectors used by the live lifecycle: the Shopify connector, the
 * real Razorpay provider, and the CTP-signed unattended payment provider,
 * bound to the pilot merchant identity. Exposed so integration tests can build
 * the exact same real connectors (e.g. to inject a mid-lifecycle crash) without
 * duplicating boot's credential wiring.
 */
export interface RealConnectorBundle {
  readonly shopify: ReturnType<typeof createShopifyConnectorFromConfig>;
  readonly razorpay: ReturnType<typeof createRealRazorpayProvider>;
  readonly payments: CounterTestPaymentProvider;
  readonly merchantId: MerchantId;
}

/**
 * Builds the {@link RealConnectorBundle} from resolved credentials. Credentials
 * are passed straight into the connector factories and never logged.
 */
export function buildRealConnectorBundle(
  shopifyCreds: NonNullable<ReturnType<typeof requireShopifyCredentials>>,
  razorpayCreds: NonNullable<ReturnType<typeof requireRazorpayCredentials>>,
): RealConnectorBundle {
  const shopify = createShopifyConnectorFromConfig({
    shopDomain: shopifyCreds.shopDomain,
    accessToken: shopifyCreds.accessToken,
    apiVersion: shopifyCreds.apiVersion,
  });

  const razorpay = createRealRazorpayProvider({
    keyId: razorpayCreds.keyId,
    keySecret: razorpayCreds.keySecret,
    webhookSecret: razorpayCreds.webhookSecret,
    baseUrl: razorpayCreds.baseUrl,
  });

  // Unattended, CTP-signed provider for the authorize/capture evidence.
  const payments = new CounterTestPaymentProvider({
    environment: "test",
    signer: createTestSignerA(),
    kid: TEST_KID_A,
  });

  return { shopify, razorpay, payments, merchantId: pilotMerchantId() };
}

// ─── Merchant identity ───────────────────────────────────────────────────────

/**
 * Derives a stable pilot MerchantId for payment commands. The worker operates a
 * single autonomous merchant identity; a real deployment can source this from
 * configuration. Deterministic so it is stable across restarts.
 */
function pilotMerchantId(): MerchantId {
  const entropy = new Uint8Array(16).fill(7);
  const result = createCounterId("merchant", entropy);
  if (!result.ok) {
    throw new Error("Failed to derive pilot merchant id");
  }
  return result.value;
}

// ─── Durable step ledger adapter ─────────────────────────────────────────────

function nowInstant(): Instant {
  const result = instantFromEpochMilliseconds(Date.now());
  if (!result.ok) {
    throw new Error("Failed to derive current instant for step ledger");
  }
  return result.value;
}

/**
 * Adapts the data-layer {@link AsyncStepLedger} (Postgres-backed) to the
 * worker's {@link StepLedgerPort} so the Shopify legs of the real lifecycle
 * dedup ACROSS worker restarts. Only terminal step outcomes and provider
 * references flow through — never secrets.
 *
 * Construct with `new PostgresStepLedger(database)` from @counter/data and pass
 * the result as the `stepLedger` override to {@link selectPaymentAuthorizationPort}.
 */
export function createPostgresStepLedgerPort(ledger: AsyncStepLedger): StepLedgerPort {
  return {
    async lookup(key: string, step: string): Promise<StepLedgerEntry | undefined> {
      const result = await ledger.lookup(key, step);
      if (!result.ok) {
        throw new Error(`Step ledger lookup failed: ${result.error.message}`);
      }
      const entry = result.value;
      if (entry === undefined) {
        return undefined;
      }
      return Object.freeze({
        step: entry.step,
        status: entry.status,
        reference: entry.reference,
      });
    },
    async record(key: string, entry: StepLedgerEntry): Promise<StepLedgerEntry> {
      const result = await ledger.record(
        key,
        { step: entry.step, status: entry.status, reference: entry.reference, snapshot: undefined },
        nowInstant(),
      );
      if (!result.ok) {
        throw new Error(`Step ledger record failed: ${result.error.message}`);
      }
      return Object.freeze({
        step: result.value.step,
        status: result.value.status,
        reference: result.value.reference,
      });
    },
  };
}

// Re-export for construction convenience at the deployment entrypoint.
export { PostgresStepLedger };
