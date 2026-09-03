/**
 * Env-gated factory for a REAL Razorpay provider.
 *
 * Builds a {@link RazorpayTestProvider} bound to the real fetch-based
 * {@link RazorpayHttpPort} from resolved credentials. The provider itself is
 * hard-bound to `environment: "test"` (it rejects `"live"`), so this factory
 * targets the Razorpay TEST mode against the real API host.
 *
 * NOTE ON DEPENDENCY DIRECTION: the credential resolver
 * (`resolveRazorpayCredentials`) lives in `apps/worker` and MUST NOT be
 * imported here — packages must not depend on apps (enforced by
 * dependency-cruiser). The worker/scripts resolve credentials and pass a plain
 * config object into this factory.
 */

import type { Signer } from "@counter/trust-protocol";

import { createRazorpayHttpClient } from "./real-http-client.js";
import type { RealRazorpayHttpConfig } from "./real-http-client.js";
import { RazorpayTestProvider } from "./razorpay-provider.js";
import { RazorpayRecurringMandateProvider } from "./recurring-mandate-provider.js";
import { RazorpayOrderVerificationProvider } from "./order-verification-provider.js";
import type { RazorpayTestAdapterConfig } from "./adapter-config.js";

/**
 * Credentials + settings required to construct a real Razorpay provider.
 *
 * Mirrors the shape produced by the worker's `resolveRazorpayCredentials`
 * helper, plus an optional request timeout override.
 */
export interface RealRazorpayProviderConfig {
  readonly keyId: string;
  readonly keySecret: string;
  readonly webhookSecret: string;
  readonly baseUrl: string;
  /** Optional bounded per-request timeout in milliseconds. */
  readonly timeoutMs?: number;
}

/**
 * Constructs a {@link RazorpayTestProvider} that performs real HTTP calls to
 * Razorpay (test mode) using the supplied credentials.
 *
 * The returned provider issues real `POST /v1/orders`,
 * `GET /v1/payments/:id`, and `POST /v1/payments/:id/refunds` requests through
 * the fetch-based HTTP client.
 */
export function createRealRazorpayProvider(
  config: RealRazorpayProviderConfig,
  clock?: () => number,
): RazorpayTestProvider {
  const httpConfig: RealRazorpayHttpConfig = {
    keyId: config.keyId,
    keySecret: config.keySecret,
    baseUrl: config.baseUrl,
    ...(config.timeoutMs !== undefined ? { timeoutMs: config.timeoutMs } : {}),
  };

  const httpClient = createRazorpayHttpClient(httpConfig);

  const adapterConfig: RazorpayTestAdapterConfig = {
    keyId: config.keyId,
    keySecret: config.keySecret,
    webhookSecret: config.webhookSecret,
    environment: "test",
    baseUrl: config.baseUrl,
  };

  return new RazorpayTestProvider({
    config: adapterConfig,
    httpClient,
    ...(clock !== undefined ? { clock } : {}),
  });
}

/**
 * Constructs a {@link RazorpayRecurringMandateProvider} that performs real
 * HTTP calls to Razorpay (test mode) using the supplied credentials — the
 * recurring-payment-mandate counterpart to {@link createRealRazorpayProvider}.
 */
export function createRealRazorpayRecurringMandateProvider(
  config: RealRazorpayProviderConfig,
  clock?: () => number,
): RazorpayRecurringMandateProvider {
  const httpConfig: RealRazorpayHttpConfig = {
    keyId: config.keyId,
    keySecret: config.keySecret,
    baseUrl: config.baseUrl,
    ...(config.timeoutMs !== undefined ? { timeoutMs: config.timeoutMs } : {}),
  };

  const httpClient = createRazorpayHttpClient(httpConfig);

  const adapterConfig: RazorpayTestAdapterConfig = {
    keyId: config.keyId,
    keySecret: config.keySecret,
    webhookSecret: config.webhookSecret,
    environment: "test",
    baseUrl: config.baseUrl,
  };

  return new RazorpayRecurringMandateProvider({
    config: adapterConfig,
    httpClient,
    ...(clock !== undefined ? { clock } : {}),
  });
}

/**
 * Constructs a {@link RazorpayOrderVerificationProvider} that performs real
 * HTTP calls to Razorpay (test mode) using the supplied credentials — see
 * that class's header for why it exists (verifying an already-created real
 * order's REAL payment status, never creating its own order).
 */
export function createRealRazorpayOrderVerificationProvider(
  config: RealRazorpayProviderConfig,
  signer: Signer,
  kid: string,
  clock?: () => number,
): RazorpayOrderVerificationProvider {
  const httpConfig: RealRazorpayHttpConfig = {
    keyId: config.keyId,
    keySecret: config.keySecret,
    baseUrl: config.baseUrl,
    ...(config.timeoutMs !== undefined ? { timeoutMs: config.timeoutMs } : {}),
  };

  const httpClient = createRazorpayHttpClient(httpConfig);

  const adapterConfig: RazorpayTestAdapterConfig = {
    keyId: config.keyId,
    keySecret: config.keySecret,
    webhookSecret: config.webhookSecret,
    environment: "test",
    baseUrl: config.baseUrl,
  };

  return new RazorpayOrderVerificationProvider({
    config: adapterConfig,
    httpClient,
    signer,
    kid,
    ...(clock !== undefined ? { clock } : {}),
  });
}
