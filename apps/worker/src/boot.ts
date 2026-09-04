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
 * Razorpay keyId/keySecret specifically: when a DurableStores.paymentConnectionStore
 * is supplied (always true at the real deployment entrypoint, main.ts), the
 * operating merchant's OWN verified credentials (self-serve "bring your own
 * gateway", merchant.payment_connections) are the ONLY source used to
 * authorize/capture payments — never a shared platform-level env credential.
 * A merchant with no connected gateway fails loud instead of silently
 * borrowing another merchant's credential. See
 * resolveRazorpayCredentialsForMerchant.
 *
 * SECURITY: credentials are read from the environment/database only and are
 * passed directly into the connector factories. They are never logged or
 * echoed.
 */

import { createCounterId, parseCounterId } from "@counter/domain";
import type { MerchantId } from "@counter/domain";
import { InMemorySigner } from "@counter/trust-protocol";
import { createShopifyConnectorFromConfig } from "@counter/shopify-connector";
import {
  createRealRazorpayProvider,
  createRealRazorpayRecurringMandateProvider,
  createRealRazorpayOrderVerificationProvider,
} from "@counter/razorpay-adapter";
import { CounterTestPaymentProvider } from "@counter/payment-sdk";
import type { PaymentProvider } from "@counter/payment-sdk";
import {
  PostgresStepLedger,
  PostgresKillSwitchStore,
  PostgresSpendLedger,
  PostgresRevocationStore,
} from "@counter/data";
import type { PostgresWalletBalanceStore } from "@counter/data";
import type {
  PostgresRecurringMandateReadStore,
  PostgresPaymentConnectionReadStore,
} from "@counter/data";
import { DEFAULT_SPEND_LIMIT_CONFIG } from "@counter/data";
import type {
  AsyncStepLedger,
  AsyncKillSwitchStore,
  KillSwitchScope,
  SpendLimitConfig,
  PolicyConfigEntry,
} from "@counter/data";
import type { Instant } from "@counter/domain";
import { instantFromEpochMilliseconds } from "@counter/domain";

import {
  requireShopifyCredentials,
  requireRazorpayCredentials,
  requireCounterTestPaymentSigner,
  type EnvironmentBag,
} from "./connector-env.js";
import { createRealPaymentAuthorizationPort } from "./real-lifecycle.js";
import { createProductionPolicy } from "./lifecycle-policy.js";
import type {
  RealLifecycleConfig,
  StepLedgerEntry,
  StepLedgerPort,
  KillSwitchGatePort,
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
    authorizeAndCapture(request: PaymentAuthorizationRequest): Promise<PaymentAuthorizationResult> {
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
  /**
   * The real connector bundle, present only when `mode` is "real". Exposed so
   * the deployment entrypoint can wire the periodic reconciliation job against
   * the SAME real Shopify connector without rebuilding credentials.
   */
  readonly bundle?: RealConnectorBundle | undefined;
}

/**
 * Durable Postgres-backed stores resolved at the deployment entrypoint and
 * threaded into the real lifecycle: the step ledger (cross-restart dedup of the
 * Shopify legs) and the kill-switch store (operator circuit breaker consulted
 * before any external effect). Both are optional so unit tests can omit them.
 */
export interface DurableStores {
  readonly stepLedger?: AsyncStepLedger | undefined;
  readonly killSwitchStore?: AsyncKillSwitchStore | undefined;
  readonly spendLedger?: PostgresSpendLedger | undefined;
  readonly recurringMandateStore?: PostgresRecurringMandateReadStore | undefined;
  /**
   * Read-only lookup of the operating merchant's OWN verified Razorpay
   * credentials (self-serve "bring your own gateway"). When present, this is
   * the ONLY source of the keyId/keySecret pair used to authorize/capture
   * real payments — see resolveRazorpayCredentialsForMerchant. Optional so
   * unit tests can omit it and exercise the legacy env-credential path.
   */
  readonly paymentConnectionStore?: PostgresPaymentConnectionReadStore | undefined;
  /**
   * Durable, cross-service revocation record (packages/wallet-application's
   * WalletRevocationService / packages/data's PostgresRevocationStore). When
   * present, the production policy independently re-verifies the wallet on
   * `authority.walletId` before every external effect — never trusting the
   * job payload's own `authority.revokedAtMs` claim alone. Optional so unit
   * tests can omit it and exercise the legacy payload-only path.
   */
  readonly revocationStore?: PostgresRevocationStore | undefined;
  /**
   * Durable prepaid wallet balance (packages/data's PostgresWalletBalanceStore
   * — see its header for the full rationale: fund once via a real Razorpay
   * TEST MODE one-time payment, spend many times under Counter's own policy
   * checks with no further per-purchase provider round trip). When present
   * AND the job's authority envelope carries a walletId, an ordinary
   * one-shot purchase draws down this balance instead of creating a fresh
   * Razorpay order. Optional so unit tests / deployments without this
   * feature enabled are unaffected and take the existing real-Razorpay path.
   */
  readonly walletBalanceStore?: PostgresWalletBalanceStore | undefined;
}

// ─── Selection ───────────────────────────────────────────────────────────────

/**
 * Selects the PaymentAuthorizationPort for the given environment.
 *
 * Optional `overrides` allow tests to inject connector doubles without real
 * credentials; when omitted the real factories are constructed from resolved
 * credentials.
 */
export async function selectPaymentAuthorizationPort(
  env: EnvironmentBag,
  overrides?: Partial<
    Pick<
      RealLifecycleConfig,
      "variantResolver" | "policy" | "actionTimeoutMs" | "stepLedger" | "killSwitch"
    >
  >,
  stores?: DurableStores,
): Promise<SelectedPaymentPort> {
  // Fail loud in prod-like environments when credentials are missing; return
  // null (mock-eligible) in local/test.
  const shopifyCreds = requireShopifyCredentials(env);
  const razorpayCreds = requireRazorpayCredentials(env);

  if (shopifyCreds === null || razorpayCreds === null) {
    return { mode: "deterministic", port: createDeterministicPaymentAuthorizationPort() };
  }

  // Resolve the ACTUAL keyId/keySecret to charge with before building the
  // connector bundle: the operating merchant's own verified credentials when
  // a paymentConnectionStore is wired in, never a shared platform pair — see
  // resolveRazorpayCredentialsForMerchant. buildRealConnectorBundle itself
  // stays synchronous and env-credential-shaped so every existing caller
  // (adversarial/reliability integration tests included) is unaffected.
  const effectiveRazorpayCreds = await resolveRazorpayCredentialsForMerchant(
    pilotMerchantId(),
    razorpayCreds,
    stores?.paymentConnectionStore,
  );

  const bundle = buildRealConnectorBundle(shopifyCreds, effectiveRazorpayCreds, env);

  // Durable stores (Postgres-backed) resolved at the deployment entrypoint are
  // preferred over any explicit override. An explicit override still wins over
  // the store so tests can inject a double.
  const durableStepLedger =
    stores?.stepLedger !== undefined ? createPostgresStepLedgerPort(stores.stepLedger) : undefined;
  const durableKillSwitch =
    stores?.killSwitchStore !== undefined
      ? createPostgresKillSwitchGatePort(stores.killSwitchStore, bundle.merchantId)
      : undefined;

  const stepLedger = overrides?.stepLedger ?? durableStepLedger;
  const killSwitch = overrides?.killSwitch ?? durableKillSwitch;

  // Default the money-seam policy to the REAL production policy (limits +
  // amount-vs-quote + authorization/mandate expiry + revocation + merchant
  // scope), scoped to this worker's operating merchant. An explicit override
  // still wins so tests can inject a bespoke policy. This closes the gap where
  // the deployed seam fell back to ALLOW_ALL (review issues 2 and 5).
  const durableReserveSpend =
    stores?.spendLedger !== undefined
      ? async (input: {
          readonly walletId: string;
          readonly reference: string;
          readonly amountMinor: bigint;
          readonly currency: string;
          readonly nowMs: number;
        }): Promise<{ readonly allowed: boolean }> => {
          const result = await stores.spendLedger!.reserveSpend(input);
          if (!result.ok) {
            // Fail closed: a ledger error must not allow an unbounded spend.
            return { allowed: false };
          }
          return { allowed: result.value.allowed };
        }
      : undefined;

  // Recurring payment mandates (UPI Autopay / e-mandate): uses
  // effectiveRazorpayCreds — the SAME merchant-resolved credentials the
  // one-shot order path resolved above via resolveRazorpayCredentialsForMerchant
  // — not the raw env-level pair. This worker instance operates exactly ONE
  // merchant per boot (bundle.merchantId = pilotMerchantId(); see
  // selectPaymentAuthorizationPort's single call site in main.ts, and
  // lifecycle-policy.ts's recurring-mandate check, which is scoped to this
  // same single config.operatingMerchantId) — there is no per-job/per-charge
  // merchant dispatch anywhere in this worker today, so a boot-time resolve
  // is correct and sufficient. If a second operating merchant is ever added
  // (a second worker deployment, or per-job merchant routing), this needs to
  // move from boot-time to charge-time, keyed off the mandate's own merchant
  // scope, same as everything else that reads bundle.merchantId today.
  //
  // NOTE (adjacent, NOT fixed here — out of scope for this credential-routing
  // fix): recurring-mandate REGISTRATION, in
  // apps/control-plane-api/src/recurring-mandate-routes.ts via main.ts's
  // razorpayRecurringProvider, always uses the raw platform-level
  // RAZORPAY_KEY_ID/RAZORPAY_KEY_SECRET env pair — it is not routed through
  // merchant.payment_connections at all. Today this is harmless because the
  // pilot merchant's own connected gateway (merchant.payment_connections)
  // happens to hold that exact same key pair (verified directly against the
  // real database this session). The moment a merchant connects a DIFFERENT
  // Razorpay gateway, any recurring mandate registered for them would still
  // create its customer/token under the PLATFORM account while this charge
  // call would (correctly, per the fix above) attempt to charge it via that
  // merchant's OWN account — a real cross-account mismatch. Registration
  // would need the same merchant-scoped credential resolution added here.
  // Both the policy gate and the actual charge call independently re-read the
  // mandate's durable state — never trusting the job payload, and never
  // sharing a single read between the two seams.
  const recurringMandateLookup =
    stores?.recurringMandateStore !== undefined
      ? (referenceId: string) => stores.recurringMandateStore!.findByReferenceId(referenceId)
      : undefined;
  const recurringPayments = createRealRazorpayRecurringMandateProvider(effectiveRazorpayCreds);

  // Durable wallet-level revocation: independently re-verifies authority.walletId
  // against the durable revocation store, rather than trusting the job payload's
  // own authority.revokedAtMs claim alone. See lifecycle-policy.ts predicate 2b.
  const walletRevocationCheck =
    stores?.revocationStore !== undefined
      ? (walletId: string) => stores.revocationStore!.isRevoked("wallet", walletId)
      : undefined;

  // Same durable check, scoped to the governed agent mandate itself — see
  // lifecycle-policy.ts predicate 2c. Reuses the SAME revocationStore
  // instance (one durable table, wallet.revocations, scoped by scope_type).
  const mandateRevocationCheck =
    stores?.revocationStore !== undefined
      ? (mandateId: string) => stores.revocationStore!.isRevoked("mandate", mandateId)
      : undefined;

  const policy =
    overrides?.policy ??
    createProductionPolicy({
      operatingMerchantId: bundle.merchantId,
      ...(durableReserveSpend !== undefined ? { reserveSpend: durableReserveSpend } : {}),
      ...(recurringMandateLookup !== undefined ? { recurringMandateLookup } : {}),
      ...(walletRevocationCheck !== undefined ? { walletRevocationCheck } : {}),
      ...(mandateRevocationCheck !== undefined ? { mandateRevocationCheck } : {}),
    });

  // Prepaid wallet balance (fund-once, spend-many — see boot.ts's
  // DurableStores.walletBalanceStore doc and packages/data's
  // PostgresWalletBalanceStore header). Re-resolves the SAME CTP signer
  // buildRealConnectorBundle already resolved for the unattended payment
  // provider (requireCounterTestPaymentSigner is a pure derivation from env,
  // safe to call again), so prepaid-balance evidence is signed with the
  // same, real deployment-specific key.
  const walletBalanceSigning =
    stores?.walletBalanceStore !== undefined
      ? (() => {
          const prepaidSigner = requireCounterTestPaymentSigner(env);
          return {
            signer: new InMemorySigner(prepaidSigner.kid, prepaidSigner.seed),
            kid: prepaidSigner.kid,
          };
        })()
      : undefined;

  const config: RealLifecycleConfig = {
    shopify: bundle.shopify,
    razorpay: bundle.razorpay,
    payments: bundle.payments,
    merchantId: bundle.merchantId,
    policy,
    recurringPayments,
    ...(recurringMandateLookup !== undefined ? { recurringMandateLookup } : {}),
    ...(stores?.walletBalanceStore !== undefined
      ? { walletBalanceStore: stores.walletBalanceStore }
      : {}),
    ...(walletBalanceSigning !== undefined ? { walletBalanceSigning } : {}),
    ...(overrides?.variantResolver !== undefined
      ? { variantResolver: overrides.variantResolver }
      : {}),
    ...(overrides?.actionTimeoutMs !== undefined
      ? { actionTimeoutMs: overrides.actionTimeoutMs }
      : {}),
    ...(stepLedger !== undefined ? { stepLedger } : {}),
    ...(killSwitch !== undefined ? { killSwitch } : {}),
  };

  return { mode: "real", port: createRealPaymentAuthorizationPort(config), bundle };
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
  /**
   * CounterTestPaymentProvider (default) or, when RAZORPAY_REAL_CAPTURE_MODE
   * is set, RazorpayOrderVerificationProvider — see buildRealConnectorBundle.
   */
  readonly payments: PaymentProvider;
  readonly merchantId: MerchantId;
}

/**
 * Resolves the FULL Razorpay credential set actually used to authorize/capture
 * a payment for `merchantId` — same shape {@link requireRazorpayCredentials}
 * returns, so it drops straight into {@link buildRealConnectorBundle}
 * unchanged.
 *
 * When `paymentConnectionStore` is provided (always true at the real
 * deployment entrypoint — see main.ts), the merchant's own verified keyId/
 * keySecret (self-serve "bring your own gateway", merchant.payment_connections)
 * REPLACE the env-level pair — using the env pair here would mean every
 * merchant's transactions silently ran through one shared credential, exactly
 * the bug this closes. `webhookSecret`/`baseUrl` still come from env (deployment-
 * level config, not a per-merchant secret today). If the merchant has not
 * connected their own gateway yet, this throws a clear, fail-loud error rather
 * than falling back to the shared pair.
 *
 * When no store is provided (unit tests exercising the legacy path, or a
 * caller that intentionally omits it), returns `envRazorpayCreds` unchanged —
 * preserves existing behavior for callers that don't opt into merchant-scoped
 * routing.
 */
export async function resolveRazorpayCredentialsForMerchant(
  merchantId: MerchantId,
  envRazorpayCreds: NonNullable<ReturnType<typeof requireRazorpayCredentials>>,
  paymentConnectionStore: PostgresPaymentConnectionReadStore | undefined,
): Promise<NonNullable<ReturnType<typeof requireRazorpayCredentials>>> {
  if (paymentConnectionStore === undefined) {
    return envRazorpayCreds;
  }
  const connection = await paymentConnectionStore.findByMerchantId(merchantId);
  if (connection === undefined) {
    throw new Error(
      `Merchant ${merchantId} has not connected a Razorpay payment gateway. ` +
        `Refusing to fall back to a shared platform credential — complete the ` +
        `payment-connect step in the merchant onboarding wizard first.`,
    );
  }
  return { ...envRazorpayCreds, keyId: connection.keyId, keySecret: connection.keySecret };
}

/**
 * Builds the {@link RealConnectorBundle} from resolved credentials. Credentials
 * are passed straight into the connector factories and never logged.
 *
 * Stays synchronous and env-credential-shaped: callers that need merchant-
 * scoped routing resolve the effective `razorpayCreds` first via
 * {@link resolveRazorpayCredentialsForMerchant} (see
 * `selectPaymentAuthorizationPort`), then pass the result straight in — this
 * keeps every existing caller (adversarial/reliability integration tests
 * included, which build a bundle synchronously at `describe`-scope) unaffected.
 */
export function buildRealConnectorBundle(
  shopifyCreds: NonNullable<ReturnType<typeof requireShopifyCredentials>>,
  razorpayCreds: NonNullable<ReturnType<typeof requireRazorpayCredentials>>,
  env: EnvironmentBag,
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

  // Unattended, CTP-signed provider for the authorize/capture evidence. The
  // signing key is a real, deployment-specific secret when configured
  // (COUNTER_TEST_PAYMENT_SIGNER_KID/_SEED); only in a mock-eligible
  // environment without those set does this fall back to the named public
  // fixture — see requireCounterTestPaymentSigner for why a prod-like
  // deployment fails loud instead of silently using that fixture.
  const testPaymentSigner = requireCounterTestPaymentSigner(env);
  const signer = new InMemorySigner(testPaymentSigner.kid, testPaymentSigner.seed);

  // Default: CounterTestPaymentProvider (purely simulated, synchronous —
  // unaffected default, every existing credential-gated integration test
  // relies on this exact fast/deterministic behavior). Opt-in only:
  // RAZORPAY_REAL_CAPTURE_MODE swaps in RazorpayOrderVerificationProvider,
  // which verifies (never fakes) a REAL captured Razorpay test-mode payment
  // against the real order step 4 already creates — see that provider's
  // header. Human-present (a real Standard Checkout must actually be
  // completed), so this is for demo/manual runs, not automated test suites.
  const payments: PaymentProvider =
    env["RAZORPAY_REAL_CAPTURE_MODE"] === "1"
      ? createRealRazorpayOrderVerificationProvider(razorpayCreds, signer, testPaymentSigner.kid)
      : new CounterTestPaymentProvider({
          environment: "test",
          signer,
          kid: testPaymentSigner.kid,
        });

  return { shopify, razorpay, payments, merchantId: pilotMerchantId() };
}

// ─── Merchant identity ───────────────────────────────────────────────────────

/**
 * Resolves the pilot MerchantId for payment commands. The worker operates a
 * single autonomous merchant identity.
 *
 * `PILOT_MERCHANT_ID` is authoritative when set (validated as a real
 * `merchant`-kind CounterId) so an operator can point the worker at any
 * merchant scope without a code change. When unset, falls back to the same
 * fixed, deterministic derivation used previously (stable across restarts) —
 * this exact value (`ctr_merchant_BwcHBwcHBwcHBwcHBwcHBw`) is also the
 * merchant-console's own fallback default (see
 * apps/merchant-console/src/app/transactions/page.tsx) specifically so the
 * two agree without either side needing to set the env var. If you change
 * this derivation, update that file's comment/fallback too, or set
 * `PILOT_MERCHANT_ID` explicitly on both sides instead.
 */
export function pilotMerchantId(): MerchantId {
  const configured = process.env["PILOT_MERCHANT_ID"];
  if (configured !== undefined && configured.trim().length > 0) {
    const parsed = parseCounterId(configured.trim(), "merchant");
    if (!parsed.ok) {
      throw new Error(`PILOT_MERCHANT_ID is not a valid merchant CounterId: ${configured}`);
    }
    return parsed.value;
  }
  const entropy = new Uint8Array(16).fill(7);
  const result = createCounterId("merchant", entropy);
  if (!result.ok) {
    throw new Error("Failed to derive pilot merchant id");
  }
  return result.value;
}

/**
 * Shape a merchant's policy config may carry to override the durable spend
 * ledger's default ceilings. Stored as a sibling key alongside the existing
 * `policyVersion`/`rules`/`effectiveFrom` shape written via the console's
 * policy route (see apps/control-plane-api/src/policy-routes.ts) — the store
 * itself treats `config` as opaque JSON, so this does not conflict with the
 * rule-compiler's own fields. Amounts are strings in JSON (bigint-safe).
 */
interface SpendLimitsJson {
  readonly maxTransactionAmountMinor: string;
  readonly maxRolling24hTotalMinor: string;
  readonly maxAttemptsPerWindow: number;
  readonly windowMs: number;
  readonly currency: string;
}

function isSpendLimitsJson(value: unknown): value is SpendLimitsJson {
  if (value === null || typeof value !== "object") {
    return false;
  }
  const v = value as Record<string, unknown>;
  return (
    typeof v["maxTransactionAmountMinor"] === "string" &&
    typeof v["maxRolling24hTotalMinor"] === "string" &&
    typeof v["maxAttemptsPerWindow"] === "number" &&
    typeof v["windowMs"] === "number" &&
    typeof v["currency"] === "string"
  );
}

/**
 * Resolves the spend-limit ceilings the durable ledger enforces. Reads an
 * optional `spendLimits` field from the merchant's policy config (set via the
 * console's policy API) so an operator can change limits without a code
 * deploy — only a worker restart, since the ledger reads this once at boot.
 * Falls back to {@link DEFAULT_SPEND_LIMIT_CONFIG} whenever the config is
 * absent OR malformed: this is a money-safety gate, so a bad/missing config
 * must fail closed to the known-safe default, never open to unlimited spend.
 */
export function resolveSpendLimitConfig(
  policyEntry: PolicyConfigEntry | undefined,
): SpendLimitConfig {
  if (policyEntry === undefined) {
    return DEFAULT_SPEND_LIMIT_CONFIG;
  }
  const config = policyEntry.config;
  if (config === null || typeof config !== "object") {
    return DEFAULT_SPEND_LIMIT_CONFIG;
  }
  const candidate = (config as Record<string, unknown>)["spendLimits"];
  if (!isSpendLimitsJson(candidate)) {
    return DEFAULT_SPEND_LIMIT_CONFIG;
  }
  try {
    return Object.freeze({
      maxTransactionAmountMinor: BigInt(candidate.maxTransactionAmountMinor),
      maxRolling24hTotalMinor: BigInt(candidate.maxRolling24hTotalMinor),
      maxAttemptsPerWindow: candidate.maxAttemptsPerWindow,
      windowMs: candidate.windowMs,
      currency: candidate.currency,
    });
  } catch {
    // BigInt() throws on a non-numeric string; fail closed to the default.
    return DEFAULT_SPEND_LIMIT_CONFIG;
  }
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
 * Construct with `new PostgresStepLedger(database, environment)` from
 * @counter/data and pass the result as the `stepLedger` override to
 * {@link selectPaymentAuthorizationPort}.
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
    async claim(key: string, step: string): Promise<{ readonly won: boolean }> {
      const result = await ledger.claim(key, step, nowInstant());
      if (!result.ok) {
        throw new Error(`Step ledger claim failed: ${result.error.message}`);
      }
      return result.value;
    },
  };
}

// ─── Durable kill-switch gate adapter ────────────────────────────────────────

/**
 * Adapts the data-layer {@link AsyncKillSwitchStore} (Postgres-backed) to the
 * worker's {@link KillSwitchGatePort} so the real lifecycle consults durable,
 * operator-controlled kill switches BEFORE any external effect — durable across
 * restarts.
 *
 * For each checkout it evaluates, in order, the scopes that can halt this
 * worker's live checkouts:
 *   - `platform`        (platform-wide switch, no entity)
 *   - `merchant`        (the pilot merchant id this worker operates)
 *   - `connector`       (the Shopify connector)
 *   - `payment_adapter` (the Razorpay payment adapter)
 * and returns the key of the FIRST active switch, or `undefined` when nothing
 * blocks. The returned key becomes the `kill-switch-blocked:<key>` reference.
 *
 * `merchantId` is the same pilot merchant the real lifecycle uses; the
 * connector/payment_adapter entity ids are stable identifiers an operator uses
 * when activating those scoped switches. Only the scope/entity target flows
 * through — never any secret.
 */
export const KILL_SWITCH_CONNECTOR_ID = "shopify";
export const KILL_SWITCH_PAYMENT_ADAPTER_ID = "razorpay";

export function createPostgresKillSwitchGatePort(
  store: AsyncKillSwitchStore,
  merchantId: MerchantId,
): KillSwitchGatePort {
  const checks: ReadonlyArray<{
    readonly scope: KillSwitchScope;
    readonly entityId: string | undefined;
    readonly key: string;
  }> = [
    { scope: "platform", entityId: undefined, key: "platform" },
    { scope: "merchant", entityId: merchantId, key: `merchant:${merchantId}` },
    {
      scope: "connector",
      entityId: KILL_SWITCH_CONNECTOR_ID,
      key: `connector:${KILL_SWITCH_CONNECTOR_ID}`,
    },
    {
      scope: "payment_adapter",
      entityId: KILL_SWITCH_PAYMENT_ADAPTER_ID,
      key: `payment_adapter:${KILL_SWITCH_PAYMENT_ADAPTER_ID}`,
    },
  ];

  return {
    async blocked(): Promise<string | undefined> {
      const now = nowInstant();
      for (const check of checks) {
        const result = await store.isActive(check.scope, check.entityId, now);
        if (!result.ok) {
          throw new Error(`Kill switch check failed: ${result.error.message}`);
        }
        if (result.value) {
          return check.key;
        }
      }
      return undefined;
    },
  };
}

// Re-export for construction convenience at the deployment entrypoint.
export {
  PostgresStepLedger,
  PostgresKillSwitchStore,
  PostgresSpendLedger,
  PostgresRevocationStore,
};
