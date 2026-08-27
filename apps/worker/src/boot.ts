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

import {
  requireShopifyCredentials,
  requireRazorpayCredentials,
  type EnvironmentBag,
} from "./connector-env.js";
import { createRealPaymentAuthorizationPort } from "./real-lifecycle.js";
import type { RealLifecycleConfig } from "./real-lifecycle.js";
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
  overrides?: Partial<Pick<RealLifecycleConfig, "variantResolver" | "policy" | "actionTimeoutMs">>,
): SelectedPaymentPort {
  // Fail loud in prod-like environments when credentials are missing; return
  // null (mock-eligible) in local/test.
  const shopifyCreds = requireShopifyCredentials(env);
  const razorpayCreds = requireRazorpayCredentials(env);

  if (shopifyCreds === null || razorpayCreds === null) {
    return { mode: "deterministic", port: createDeterministicPaymentAuthorizationPort() };
  }

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

  const config: RealLifecycleConfig = {
    shopify,
    razorpay,
    payments,
    merchantId: pilotMerchantId(),
    ...(overrides?.policy !== undefined ? { policy: overrides.policy } : {}),
    ...(overrides?.variantResolver !== undefined ? { variantResolver: overrides.variantResolver } : {}),
    ...(overrides?.actionTimeoutMs !== undefined ? { actionTimeoutMs: overrides.actionTimeoutMs } : {}),
  };

  return { mode: "real", port: createRealPaymentAuthorizationPort(config) };
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
