/**
 * Deployment entry point for control-plane-api.
 * Binds to 0.0.0.0 so the Fly.io proxy can reach the server.
 *
 * In production-like environments (anything other than local/test/development)
 * a durable Postgres-backed policy store is required: DATABASE_URL must be set
 * and a PostgresDatabase is constructed and injected into createServer. In
 * local/test/development the in-memory store is used unless DATABASE_URL is
 * provided.
 */
import {
  resolveCounterEnvironment,
  createCounterId,
  parseCounterId,
  type Environment,
  type IsoCurrencyCode,
  type MerchantId,
} from "@counter/domain";
import {
  PostgresDatabase,
  PostgresCursorStore,
  PostgresProductRepository,
  PostgresVariantRepository,
  PostgresPriceRepository,
  PostgresInventoryRepository,
  PostgresRevocationStore,
  PostgresMandateRepository,
  PostgresCtpKeyRegistry,
  PostgresWalletBalanceStore,
  PostgresBuyerNotificationStore,
} from "@counter/data";
import { createHttpGraphQLClient, CatalogSyncService } from "@counter/shopify-connector";
import { WalletRevocationService } from "@counter/wallet-application";
import { createServer, APP_NAME, type CreateServerOptions } from "./index.js";
import { createPostgresPolicyStore } from "./policy-store-postgres.js";
import { createDefaultPolicyCompiler } from "./policy-routes.js";
import { createPostgresTransactionStore } from "./transaction-store-postgres.js";
import { WalletUserProvisioner, type RuntimeCredentialConfig } from "./wallet-user-store.js";
import {
  createRealRazorpayProvider,
  createRealRazorpayRecurringMandateProvider,
} from "@counter/razorpay-adapter";
import {
  RecurringMandateProvisioner,
  type RecurringMandateRevocationConfig,
} from "./recurring-mandate-store.js";
import {
  ShopifyConnectionProvisioner,
  type ShopifyOAuthConfig,
} from "./shopify-connection-store.js";
import { RefundRequestStore } from "./refund-request-store.js";
import { MerchantApplicationProvisioner } from "./merchant-application-store.js";
import { MerchantPaymentConnectionStore } from "./merchant-payment-connection-store.js";
import { MerchantWebhookEndpointStore } from "./merchant-webhook-endpoint-store.js";
import { createFulfillmentWebhookHandler } from "./fulfillment-webhook-handler.js";
import { MerchantReadinessService } from "./merchant-readiness-store.js";
import { MerchantManifestStore } from "./merchant-manifest-store.js";
import { MerchantActivationStore } from "./merchant-activation-store.js";
import { requireControlPlaneSigner } from "./control-plane-signer-env.js";
import { MandateBindingService } from "./mandate-binding-store.js";
import { PrepaidBalanceMandateBindingService } from "./prepaid-balance-mandate-binding-store.js";

const port = parseInt(process.env["PORT"] || "8080", 10);
const environment = process.env["NODE_ENV"] || "production";

// Environments that may run without a durable database.
const IN_MEMORY_ELIGIBLE = ["local", "test", "development"].includes(environment);

const databaseUrl = process.env["DATABASE_URL"];

let database: PostgresDatabase | undefined;
const hasDatabaseUrl = databaseUrl !== undefined && databaseUrl.trim().length > 0;

if (!hasDatabaseUrl && !IN_MEMORY_ELIGIBLE) {
  // Fail loudly: a production-like deployment must not silently run on a
  // non-durable in-memory store.
  console.error(
    `[${APP_NAME}] DATABASE_URL is required in production-like environment '${environment}'`,
  );
  process.exit(1);
}

if (hasDatabaseUrl) {
  database = new PostgresDatabase(databaseUrl as string);
}

// The durable-data partition (bound into every policy/transaction query below)
// is resolved from COUNTER_ENV alone — NODE_ENV's vocabulary ("development")
// is a different, framework-level taxonomy, not a valid Counter environment.
// This is what makes the store here agree with what the worker actually
// writes; previously this read `environment` (NODE_ENV-derived, typically
// "production") while every writer hardcoded "local", so the merchant
// console's transaction/policy views could never show real data.
const runtimeEnvironmentResult = resolveCounterEnvironment(
  process.env["COUNTER_ENV"],
  !IN_MEMORY_ELIGIBLE,
);
if (!runtimeEnvironmentResult.ok) {
  console.error(`[${APP_NAME}] ${runtimeEnvironmentResult.error.message}`);
  process.exit(1);
}
const runtimeEnvironment: Environment = runtimeEnvironmentResult.value;

// Optional: self-serve buyers only get a fully working connect command when
// this deployment has the shared merchant-runtime M2M credential configured
// (see RuntimeCredentialConfig's docs in wallet-user-store.ts for the
// deliberate shared-credential trade-off this makes). Missing it degrades
// gracefully — key registration still works, the local script just falls
// back to printing "ask Counter for these two values".
const runtimeM2mClientId = process.env["AGENT_RUNTIME_M2M_CLIENT_ID"];
const runtimeM2mClientSecret = process.env["AGENT_RUNTIME_M2M_CLIENT_SECRET"];
const runtimeCredentialConfig: RuntimeCredentialConfig | undefined =
  runtimeM2mClientId !== undefined && runtimeM2mClientSecret !== undefined
    ? {
        clientId: runtimeM2mClientId,
        clientSecret: runtimeM2mClientSecret,
        runtimeUrl:
          process.env["COUNTER_AGENT_RUNTIME_URL"] || "https://counter-agent-runtime.fly.dev",
      }
    : undefined;

// Optional: recurring payment mandates (UPI Autopay / e-mandate) need the
// same Razorpay test-mode credentials the worker already uses for one-shot
// orders — reusing RAZORPAY_KEY_ID/KEY_SECRET rather than minting a new
// secret. Missing them degrades gracefully: the routes simply aren't
// registered (see index.ts's optional-provisioner pattern).
const razorpayKeyId = process.env["RAZORPAY_KEY_ID"];
const razorpayKeySecret = process.env["RAZORPAY_KEY_SECRET"];
const razorpayRecurringProvider =
  database !== undefined && razorpayKeyId !== undefined && razorpayKeySecret !== undefined
    ? createRealRazorpayRecurringMandateProvider({
        keyId: razorpayKeyId,
        keySecret: razorpayKeySecret,
        webhookSecret: process.env["RAZORPAY_WEBHOOK_SECRET"] || "",
        baseUrl: process.env["RAZORPAY_BASE_URL"] || "https://api.razorpay.com",
      })
    : undefined;

/**
 * Self-serve Shopify OAuth needs a real Shopify Partner app (API key +
 * secret) to exist. This deployment does not currently have one — unlike
 * DATABASE_URL, this is never treated as a fail-loud requirement in
 * production, because that would take the ENTIRE control-plane-api down
 * (policy/transaction routes included) over one still-optional feature.
 * Absent config simply means /control/v1/merchants/:merchantId/shopify/*
 * is not registered at all (see index.ts's shopifyConnectionProvisioner
 * option) — the same graceful-absence shape as walletUserProvisioner.
 */
const DEFAULT_SHOPIFY_OAUTH_SCOPES = "read_products,read_orders,write_orders";

function resolveShopifyOAuthConfig(): ShopifyOAuthConfig | undefined {
  const clientId = process.env["SHOPIFY_OAUTH_CLIENT_ID"]?.trim();
  const clientSecret = process.env["SHOPIFY_OAUTH_CLIENT_SECRET"]?.trim();
  const redirectUri = process.env["SHOPIFY_OAUTH_REDIRECT_URI"]?.trim();
  const scopes = process.env["SHOPIFY_OAUTH_SCOPES"]?.trim() || DEFAULT_SHOPIFY_OAUTH_SCOPES;

  if (!clientId || !clientSecret || !redirectUri) {
    console.log(
      `[${APP_NAME}] Shopify OAuth app credentials not configured ` +
        `(SHOPIFY_OAUTH_CLIENT_ID/SHOPIFY_OAUTH_CLIENT_SECRET/SHOPIFY_OAUTH_REDIRECT_URI) — ` +
        `self-serve Shopify connect routes are not registered.`,
    );
    return undefined;
  }
  return { clientId, clientSecret, redirectUri, scopes };
}

const shopifyOAuthConfig = resolveShopifyOAuthConfig();

// Optional: approving a refund request (the merchant-facing relay decision)
// needs the SAME Razorpay credentials — reusing razorpayKeyId/razorpayKeySecret
// above rather than a third credential set. Missing them degrades
// gracefully: the refund-request routes simply aren't registered, matching
// the recurring-mandate optional-provisioner pattern.
const razorpayRefundProvider =
  database !== undefined && razorpayKeyId !== undefined && razorpayKeySecret !== undefined
    ? createRealRazorpayProvider({
        keyId: razorpayKeyId,
        keySecret: razorpayKeySecret,
        webhookSecret: process.env["RAZORPAY_WEBHOOK_SECRET"] || "",
        baseUrl: process.env["RAZORPAY_BASE_URL"] || "https://api.razorpay.com",
      })
    : undefined;

// Shared with Step 5's MerchantReadinessService below, so a self-serve
// merchant's synthesized default policy (see merchant-readiness-store.ts's
// header) is written into and read from the SAME store/compiler
// policy-routes.ts's own GET/POST /merchants/:merchantId/policy routes use
// — never a second, shadow policy store.
const policyStore =
  database !== undefined ? createPostgresPolicyStore(database, runtimeEnvironment) : undefined;
const policyCompiler = createDefaultPolicyCompiler();

const readinessService =
  database !== undefined && policyStore !== undefined
    ? new MerchantReadinessService(database, runtimeEnvironment, policyStore, policyCompiler)
    : undefined;

// Kicks off a real product-catalog backfill the moment a merchant's Shopify
// OAuth connection completes, using the access token that connection just
// obtained (never persisted here, never logged - held only for the
// duration of this one call). Fire-and-forget by contract (see
// OnShopifyConnected's doc comment in shopify-connection-store.ts): a
// backfill failure must never surface as an OAuth callback error, since the
// connection itself is already durably saved by the time this runs. This
// is what makes the wizard's catalog-review step (packages/shopify-
// connector's CatalogSyncService + product-index.ts existed and were fully
// tested but wired to nothing before this) actually have real products to
// review.
//
// storeCurrency defaults to INR (CounterX is India-first; every other
// money-handling path in this codebase - recurring mandates, spend limits -
// is already INR-only per PILOT.md) rather than querying the merchant's
// real store currency, a real simplification worth revisiting once a
// non-INR merchant needs onboarding.
function createShopifyConnectedHandler(
  postgresDatabase: PostgresDatabase,
  targetEnvironment: Environment,
): (input: { merchantId: string; shopDomain: string; accessToken: string }) => void {
  const cursorStore = new PostgresCursorStore(postgresDatabase, targetEnvironment);
  const productRepo = new PostgresProductRepository(postgresDatabase, targetEnvironment);
  const variantRepo = new PostgresVariantRepository(postgresDatabase, targetEnvironment);
  const priceRepo = new PostgresPriceRepository(postgresDatabase, targetEnvironment);
  const inventoryRepo = new PostgresInventoryRepository(postgresDatabase, targetEnvironment);

  return (input): void => {
    const client = createHttpGraphQLClient({
      shopDomain: input.shopDomain,
      accessToken: input.accessToken,
    });
    const syncService = new CatalogSyncService(client, cursorStore);

    const runToCompletion = async (): Promise<void> => {
      // backfillProducts is budget-limited per call and saves a durable
      // resume cursor when it stops early - loop until the whole catalog
      // is fetched (hasMore: false) rather than syncing only the first
      // budget-limited chunk on a merchant's very first connection. Capped
      // to bound worst-case work against a pathologically large catalog or
      // a stuck cursor; the durable cursor means a later real sync
      // (webhook-driven incremental update, or a future manual resync)
      // picks up exactly where this leaves off either way.
      const MAX_ITERATIONS = 200;
      for (let iteration = 0; iteration < MAX_ITERATIONS; iteration++) {
        const result = await syncService.backfillProducts(input.merchantId, {
          pageSize: 50,
          costBudget: 5000,
          storeCurrency: "INR" as IsoCurrencyCode,
        });
        for (const product of result.products) {
          await productRepo.save(product);
          for (const variant of product.variants) {
            await variantRepo.save(variant);
          }
        }
        for (const price of result.prices) {
          await priceRepo.save(price);
        }
        for (const inventory of result.inventory) {
          await inventoryRepo.save(inventory);
        }
        if (!result.hasMore) {
          return;
        }
      }
      console.warn(
        `[${APP_NAME}] Catalog backfill for merchant ${input.merchantId} hit the ${String(MAX_ITERATIONS)}-iteration cap without completing - durable cursor saved, will resume on next sync`,
      );
    };

    void runToCompletion().catch((error: unknown) => {
      console.error(
        `[${APP_NAME}] Catalog backfill failed for merchant ${input.merchantId} after a successful Shopify connection`,
        error,
      );
    });
  };
}

// Shared across the revocation cascade AND the new mandate-binding route —
// one durable mandate repository instance, not two, for the same table.
const mandateRepo =
  database !== undefined ? new PostgresMandateRepository(database, runtimeEnvironment) : undefined;

// Durable, signed revocation evidence for recurring-mandate revoke() (Phase
// A4) — only resolved when recurring mandates are actually configured (no
// point requiring a signing key for a feature that isn't enabled).
// requireControlPlaneSigner fails loud in a production-like environment with
// the key unset, matching requireCounterTestPaymentSigner's precedent — this
// is control-plane-api's OWN key, never the worker's
// COUNTER_TEST_PAYMENT_SIGNER (different signer, different purpose).
const revocationConfig: RecurringMandateRevocationConfig | undefined =
  database !== undefined && razorpayRecurringProvider !== undefined && mandateRepo !== undefined
    ? {
        service: new WalletRevocationService(
          new PostgresRevocationStore(database, runtimeEnvironment),
          mandateRepo,
        ),
        kid: requireControlPlaneSigner(process.env, IN_MEMORY_ELIGIBLE).kid,
      }
    : undefined;

// Reused for both the recurring-mandate routes and the webhook route's
// server-side mandate-confirmation fallback, rather than constructing a
// second instance.
const recurringMandateProvisioner =
  database !== undefined && razorpayRecurringProvider !== undefined
    ? new RecurringMandateProvisioner(
        database,
        runtimeEnvironment,
        razorpayRecurringProvider,
        revocationConfig,
      )
    : undefined;

// Independent check that payload.agent_id is a real, active agent
// registered under the target wallet — required as of the Mandate Pivot's
// consent-key/operating-key separation (see mandate-binding-store.ts's
// AgentOwnershipCheck doc for why this can no longer be assumed from the
// envelope's own signature).
function checkAgentOwnership(db: PostgresDatabase, env: Environment) {
  return async (walletId: string, agentId: string): Promise<boolean> => {
    const result = await db.query(
      `SELECT 1 FROM identity.actors
        WHERE environment = $1 AND actor_kind = 'registered_agent' AND actor_id = $2
          AND owner_scope_kind = 'wallet' AND owner_scope_id = $3 AND status = 'active'`,
      [env, agentId, walletId],
    );
    return result.rows.length > 0;
  };
}

// Wallet-mandate binding: verifies an already-signed counter.mandate.v1
// envelope (built client-side, where the buyer's own key lives) and durably
// persists it, bound to an active, human-authorized recurringMandateProvisioner
// mandate — see mandate-binding-store.ts's header for the full design. Only
// resolved when both a durable mandate repo AND the recurring-mandate
// provisioner (the thing it binds against) are configured.
const mandateBindingService =
  database !== undefined && mandateRepo !== undefined && recurringMandateProvisioner !== undefined
    ? new MandateBindingService(
        mandateRepo,
        new PostgresCtpKeyRegistry(database, runtimeEnvironment),
        recurringMandateProvisioner,
        checkAgentOwnership(database, runtimeEnvironment),
      )
    : undefined;

// Prepaid-balance-backed wallet-mandate binding: the SAME durable
// WalletMandate table, but authority is derived from "this wallet has a
// prepaid balance account" instead of an active Razorpay recurring
// mandate — see prepaid-balance-mandate-binding-store.ts's header. A
// wholly separate service instance from mandateBindingService above; the
// recurring path is never touched by this. Only resolved when a durable
// mandate repo AND a wallet balance store are configured.
const walletBalanceStore =
  database !== undefined ? new PostgresWalletBalanceStore(database, runtimeEnvironment) : undefined;

/**
 * Resolves the pilot MerchantId to attach to a wallet top-up's Razorpay
 * order — CreatePaymentInstruction requires a merchantId even though a
 * top-up isn't a purchase from any particular merchant (it's the buyer
 * funding their own Counter-held balance). Same derivation as
 * apps/worker/src/boot.ts's pilotMerchantId(): PILOT_MERCHANT_ID when set,
 * else the same fixed fallback value, so both processes agree without
 * either needing the env var. Not imported from apps/worker directly —
 * apps never import other apps in this repo's dependency graph.
 */
function pilotMerchantId(): MerchantId {
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

// Real self-serve wallet top-up needs the SAME one-shot Razorpay provider as
// refunds (razorpayRefundProvider) — reused, not a third instance — plus the
// wallet balance store it credits. Missing either degrades gracefully, same
// optional-feature pattern as every other route in this file.
const walletTopupRoutes =
  walletBalanceStore !== undefined && razorpayRefundProvider !== undefined
    ? {
        store: walletBalanceStore,
        razorpayProvider: razorpayRefundProvider,
        merchantId: pilotMerchantId(),
      }
    : undefined;

const prepaidBalanceMandateBindingService =
  database !== undefined && mandateRepo !== undefined && walletBalanceStore !== undefined
    ? new PrepaidBalanceMandateBindingService(
        mandateRepo,
        new PostgresCtpKeyRegistry(database, runtimeEnvironment),
        walletBalanceStore,
      )
    : undefined;

// Real webhook ingress (Shopify + Razorpay) — registered only when BOTH real
// secrets are configured, fail-closed rather than registering one adapter
// with an insecure empty-string secret. Shopify signs webhooks with the
// SAME client secret used for the OAuth token exchange (no separate
// "webhook secret" concept for OAuth apps, per Shopify's own convention) —
// reusing shopifyOAuthConfig.clientSecret rather than inventing a second env
// var. Missing config degrades gracefully, same as every other optional
// feature in this file.
const razorpayWebhookSecret = process.env["RAZORPAY_WEBHOOK_SECRET"]?.trim();
const webhookRoutesOptions =
  shopifyOAuthConfig !== undefined &&
  razorpayWebhookSecret !== undefined &&
  razorpayWebhookSecret.length > 0
    ? {
        shopifyWebhookSecret: shopifyOAuthConfig.clientSecret,
        razorpayWebhookSecret,
        ...(recurringMandateProvisioner !== undefined ? { recurringMandateProvisioner } : {}),
        ...(database !== undefined
          ? {
              onShopifyFulfillmentWebhook: createFulfillmentWebhookHandler(
                database,
                runtimeEnvironment,
              ),
            }
          : {}),
      }
    : undefined;

if (webhookRoutesOptions === undefined) {
  console.log(
    `[${APP_NAME}] Shopify OAuth config and/or RAZORPAY_WEBHOOK_SECRET not configured — ` +
      `real webhook ingress routes are not registered.`,
  );
}

const serverOptions: CreateServerOptions = {
  logger: true,
  environment,
  version: process.env["APP_VERSION"] || "0.1.0",
  ...(database !== undefined
    ? {
        ...(policyStore !== undefined ? { policyStore, policyCompiler } : {}),
        transactionStore: createPostgresTransactionStore(database, runtimeEnvironment),
        walletUserProvisioner: new WalletUserProvisioner(
          database,
          runtimeEnvironment,
          runtimeCredentialConfig,
        ),
        merchantApplicationProvisioner: new MerchantApplicationProvisioner(
          database,
          runtimeEnvironment,
        ),
        merchantActivationStore: new MerchantActivationStore(database, runtimeEnvironment),
        merchantPaymentConnectionStore: new MerchantPaymentConnectionStore(
          database,
          runtimeEnvironment,
          {
            ...(process.env["RAZORPAY_BASE_URL"]
              ? { baseUrl: process.env["RAZORPAY_BASE_URL"] }
              : {}),
          },
        ),
        merchantWebhookEndpointStore: new MerchantWebhookEndpointStore(
          database,
          runtimeEnvironment,
        ),
        buyerNotificationStore: new PostgresBuyerNotificationStore(database, runtimeEnvironment),
        // Phase 4 (wallet-dashboard backend): both walletBalanceStore and
        // mandateRepo above already exist unconditionally whenever database
        // is present (constructed earlier for the prepaid-mandate-binding
        // and revocation-cascade paths respectively) — reused here, not a
        // second instance.
        ...(walletBalanceStore !== undefined ? { walletBalanceStore } : {}),
        ...(walletTopupRoutes !== undefined ? { walletTopupRoutes } : {}),
        ...(mandateRepo !== undefined ? { mandateRepository: mandateRepo } : {}),
        ...(readinessService !== undefined
          ? {
              merchantReadinessService: readinessService,
              merchantManifestStore: new MerchantManifestStore(
                database,
                runtimeEnvironment,
                readinessService,
              ),
            }
          : {}),
        ...(recurringMandateProvisioner !== undefined ? { recurringMandateProvisioner } : {}),
        ...(mandateBindingService !== undefined ? { mandateBindingService } : {}),
        ...(prepaidBalanceMandateBindingService !== undefined
          ? { prepaidBalanceMandateBindingService }
          : {}),
        ...(shopifyOAuthConfig !== undefined
          ? {
              shopifyConnectionProvisioner: new ShopifyConnectionProvisioner(
                database,
                runtimeEnvironment,
                shopifyOAuthConfig,
                createShopifyConnectedHandler(database, runtimeEnvironment),
              ),
            }
          : {}),
        ...(razorpayRefundProvider !== undefined
          ? {
              refundRequestStore: new RefundRequestStore(
                database,
                runtimeEnvironment,
                razorpayRefundProvider,
              ),
            }
          : {}),
      }
    : {}),
  ...(webhookRoutesOptions !== undefined ? { webhookRoutes: webhookRoutesOptions } : {}),
};

const server = createServer(serverOptions);

void server.listen({ port, host: "0.0.0.0" }).then((address) => {
  console.log(`${APP_NAME} listening on ${address}`);
});

process.on("SIGTERM", () => {
  void server.close().then(() => {
    if (database !== undefined) {
      return database.close();
    }
    return undefined;
  });
});
