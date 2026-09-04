/**
 * apps/control-plane-api
 *
 * Merchant and Wallet configuration API: enrollment, policy, keys,
 * activation, and support grants under `/control/v1/...`.
 *
 * Uses @counter/http-api-kit for standard middleware (auth, correlation,
 * error mapping, scope enforcement, health checks, and OpenAPI).
 */
import type { FastifyInstance } from "fastify";
import type { JWTVerifyGetKey } from "jose";
import {
  createHttpServer,
  attachGracefulShutdown,
  registerRoutePermission,
  type ServerFactoryOptions,
} from "@counter/http-api-kit";
import {
  policyRoutesPlugin,
  createInMemoryPolicyStore,
  createDefaultPolicyCompiler,
  type PolicyStore,
  type PolicyCompiler,
} from "./policy-routes.js";
import {
  transactionRoutesPlugin,
  createInMemoryTransactionStore,
  type TransactionReadStore,
} from "./transaction-routes.js";
import { walletUserRoutesPlugin } from "./wallet-user-routes.js";
import type { WalletUserProvisionerLike } from "./wallet-user-store.js";
import { recurringMandateRoutesPlugin } from "./recurring-mandate-routes.js";
import type { RecurringMandateProvisionerLike } from "./recurring-mandate-store.js";
import { mandateBindingRoutesPlugin } from "./mandate-binding-routes.js";
import type { MandateBindingService } from "./mandate-binding-store.js";
import { shopifyConnectRoutesPlugin } from "./shopify-connect-routes.js";
import type { ShopifyConnectionProvisionerLike } from "./shopify-connection-store.js";
import { refundRequestRoutesPlugin } from "./refund-request-routes.js";
import type { RefundRequestStoreLike } from "./refund-request-store.js";
import { merchantApplicationRoutesPlugin } from "./merchant-application-routes.js";
import type { MerchantApplicationProvisionerLike } from "./merchant-application-store.js";
import { merchantPaymentConnectionRoutesPlugin } from "./merchant-payment-connection-routes.js";
import type { MerchantPaymentConnectionStoreLike } from "./merchant-payment-connection-store.js";
import { merchantWebhookEndpointRoutesPlugin } from "./merchant-webhook-endpoint-routes.js";
import type { MerchantWebhookEndpointStoreLike } from "./merchant-webhook-endpoint-store.js";
import { buyerNotificationRoutesPlugin } from "./buyer-notification-routes.js";
import type { PostgresBuyerNotificationStore } from "@counter/data";
import { walletMandateRoutesPlugin } from "./wallet-mandate-routes.js";
import type { MandateRepository } from "@counter/wallet-domain";
import { merchantReadinessRoutesPlugin } from "./merchant-readiness-routes.js";
import type { MerchantReadinessServiceLike } from "./merchant-readiness-store.js";
import { merchantManifestRoutesPlugin } from "./merchant-manifest-routes.js";
import type { MerchantManifestStoreLike } from "./merchant-manifest-store.js";
import { webhookRoutesPlugin, type WebhookRoutesOptions } from "./webhook-routes.js";

export const APP_NAME = "@counter/control-plane-api";

/**
 * Shopify's own redirect back from the OAuth consent screen carries no
 * Counter session at all, and its path includes a dynamic :merchantId
 * segment, so it can't be listed as a literal skip-auth path. See
 * @counter/http-api-kit's auth.ts isSkipped, which matches this against
 * the request's resolved route PATTERN, not the literal URL.
 */
const SHOPIFY_CALLBACK_ROUTE_PATTERN = "/control/v1/merchants/:merchantId/shopify/callback";

const DEFAULT_VERSION = "0.1.0";
const DEFAULT_ENVIRONMENT = "local";
// Env-var driven, matching the pattern every Next.js console already uses
// (apps/{merchant,wallet,operations}-console/src/lib/auth.ts's
// AUTH0_ISSUER_BASE_URL/AUTH0_AUDIENCE) — previously hardcoded to the dev
// tenant here only, which meant a different Auth0 tenant (e.g. a real
// production one) required a source change instead of an env flip like
// every other app in this repo. The dev-tenant string stays as the
// fallback default so nothing breaks when unset.
//
// The consoles' own AUTH0_ISSUER_BASE_URL convention has no trailing slash
// (`https://${domain}`), but the JWKS URL below is built by string
// concatenation (`${AUTH_ISSUER}.well-known/jwks.json`) and the Auth0
// issuer claim itself is conventionally slash-terminated — normalize to
// exactly one trailing slash regardless of how the operator sets it.
function withTrailingSlash(url: string): string {
  return url.endsWith("/") ? url : `${url}/`;
}

const AUTH_ISSUER = withTrailingSlash(
  process.env["AUTH0_ISSUER_BASE_URL"] ?? "https://dev-jzw3etjxnn3svs56.us.auth0.com/",
);
const AUTH_AUDIENCE = process.env["AUTH0_AUDIENCE"] ?? "https://api.counter.dev";

/**
 * Environments that MAY fall back to an in-memory policy store when no store is
 * injected. NOTE: main.ts passes environment as NODE_ENV (development/test/
 * production), NOT the COUNTER_ENV taxonomy, so we treat the Counter local
 * tiers (local/test) and the Node development tier as non-production. Everything
 * else (production/sandbox/pilot and any unknown value) is production-like and
 * MUST be given a durable store explicitly (wired from DATABASE_URL in main.ts).
 */
const IN_MEMORY_ELIGIBLE_ENVIRONMENTS: ReadonlySet<string> = new Set([
  "local",
  "test",
  "development",
]);

function resolvePolicyStore(
  environment: string,
  options: CreateServerOptions | undefined,
): PolicyStore {
  if (options?.policyStore !== undefined) {
    return options.policyStore;
  }

  if (IN_MEMORY_ELIGIBLE_ENVIRONMENTS.has(environment)) {
    return createInMemoryPolicyStore();
  }

  throw new Error(
    `[${APP_NAME}] Refusing to start in production-like environment ` +
      `'${environment}' without a durable policyStore. The in-memory policy ` +
      `store is only permitted in local/test/development. Wire a Postgres-backed ` +
      `store (from DATABASE_URL) before deploying.`,
  );
}

function resolveTransactionStore(
  environment: string,
  options: CreateServerOptions | undefined,
): TransactionReadStore {
  if (options?.transactionStore !== undefined) {
    return options.transactionStore;
  }

  if (IN_MEMORY_ELIGIBLE_ENVIRONMENTS.has(environment)) {
    return createInMemoryTransactionStore();
  }

  throw new Error(
    `[${APP_NAME}] Refusing to start in production-like environment ` +
      `'${environment}' without a durable transactionStore. The in-memory ` +
      `transaction store is only permitted in local/test/development. Wire a ` +
      `Postgres-backed store (from DATABASE_URL) before deploying.`,
  );
}

export interface CreateServerOptions {
  readonly version?: string | undefined;
  readonly environment?: string | undefined;
  readonly jwks?: JWTVerifyGetKey | string | undefined;
  readonly logger?: boolean | undefined;
  readonly policyStore?: PolicyStore | undefined;
  readonly policyCompiler?: PolicyCompiler | undefined;
  readonly transactionStore?: TransactionReadStore | undefined;
  /**
   * Only when present is /control/v1/wallet-users/* registered — this is a
   * new, optional feature (self-serve onboarding), not one every deployment
   * of this app needs, unlike policy/transaction routes.
   */
  readonly walletUserProvisioner?: WalletUserProvisionerLike | undefined;
  /**
   * Only when present is /control/v1/wallets/*\/recurring-mandates
   * registered — same optional-feature pattern as walletUserProvisioner.
   */
  readonly recurringMandateProvisioner?: RecurringMandateProvisionerLike | undefined;
  /**
   * Only when present is /control/v1/wallets/*\/mandates registered — same
   * optional-feature pattern as walletUserProvisioner.
   */
  readonly mandateBindingService?: MandateBindingService | undefined;
  /**
   * Only when present is /control/v1/merchants/:merchantId/shopify/*
   * registered — a new, optional feature (self-serve Shopify OAuth), not
   * one every deployment of this app needs.
   */
  readonly shopifyConnectionProvisioner?: ShopifyConnectionProvisionerLike | undefined;
  /**
   * Only when present is /control/v1/merchants/*\/refund-requests
   * registered — same optional-feature pattern as walletUserProvisioner.
   */
  readonly refundRequestStore?: RefundRequestStoreLike | undefined;
  /**
   * Only when present is /control/v1/merchant-applications/* registered —
   * same optional-feature pattern as walletUserProvisioner.
   */
  readonly merchantApplicationProvisioner?: MerchantApplicationProvisionerLike | undefined;
  /**
   * Only when present is /control/v1/merchant-applications/:merchantId/
   * payment-connection registered — Step 4 (own-gateway Razorpay connect),
   * same optional-feature pattern as merchantApplicationProvisioner.
   */
  readonly merchantPaymentConnectionStore?: MerchantPaymentConnectionStoreLike | undefined;
  /**
   * Only when present is /control/v1/merchants/:merchantId/webhook-endpoint
   * registered — Phase 2 of the remote-MCP plan (notifications backbone):
   * a merchant registers a callback URL for real order/fulfillment event
   * delivery. Same optional-feature pattern as merchantPaymentConnectionStore.
   */
  readonly merchantWebhookEndpointStore?: MerchantWebhookEndpointStoreLike | undefined;
  /**
   * Only when present is /control/v1/wallets/:walletId/notifications
   * registered — Phase 2 of the remote-MCP plan (notifications backbone),
   * serving the notifications.list/invoices.get MCP tools. Same
   * optional-feature pattern as merchantWebhookEndpointStore.
   */
  readonly buyerNotificationStore?: PostgresBuyerNotificationStore | undefined;
  /**
   * Only when present is /control/v1/wallets/:walletId/mandates (GET)
   * registered — Phase 4 of the remote-MCP plan: a wallet's currently-active
   * mandates, read-only. Independent of mandateBindingService (which only
   * registers the POST that CREATES a mandate) — this can be wired even
   * when no binding service is configured, since it only reads the same
   * durable mandateRepo every binding path already writes to.
   */
  readonly mandateRepository?: MandateRepository | undefined;
  /**
   * Only when present is /control/v1/merchant-applications/:merchantId/
   * readiness registered — Step 5, same optional-feature pattern.
   */
  readonly merchantReadinessService?: MerchantReadinessServiceLike | undefined;
  /**
   * Only when present is /control/v1/merchant-applications/:merchantId/
   * manifest registered — Step 6, same optional-feature pattern.
   */
  readonly merchantManifestStore?: MerchantManifestStoreLike | undefined;
  /**
   * Only when present is POST /webhooks/v1/{shopify,razorpay} registered —
   * real HMAC-verified webhook ingress for both providers, same
   * optional-feature pattern as every other provisioner above.
   */
  readonly webhookRoutes?: WebhookRoutesOptions | undefined;
}

/**
 * The self-serve provision route needs a valid Bearer JWT (so an anonymous
 * request is still rejected) but must NOT be auto-401'd by
 * actor-extraction's hard requirement for Counter's own custom claims — a
 * brand-new merchant-console user has a real Auth0 session with no such
 * claims yet, since no Post-Login Action stamps them for merchant users.
 * See merchant-application-routes.ts's header for the full reasoning and
 * server-factory.ts's skipActorClaimsRoutes docs for the mechanism.
 */
const MERCHANT_APPLICATION_PROVISION_ROUTE = "/control/v1/merchant-applications/provision";

export function createServer(options?: CreateServerOptions): FastifyInstance {
  const version = options?.version ?? DEFAULT_VERSION;
  const environment = options?.environment ?? DEFAULT_ENVIRONMENT;

  const jwks: JWTVerifyGetKey | string = options?.jwks ?? `${AUTH_ISSUER}.well-known/jwks.json`;

  const serverOptions: ServerFactoryOptions = {
    name: APP_NAME,
    version,
    environment,
    auth: {
      issuer: AUTH_ISSUER,
      audience: AUTH_AUDIENCE,
      jwks,
    },
    ...(environment !== "production"
      ? { openApi: { title: "Counter Control Plane API", version } }
      : {}),
    // A fresh local setup script has no browser session or JWT at all — the
    // setup token itself (single-use, 15-minute expiry) is the entire proof
    // of identity for this one route. See wallet-user-routes.ts's header.
    // Shopify's OAuth callback also carries no Counter session — see the
    // SHOPIFY_CALLBACK_ROUTE_PATTERN comment above. Webhook senders
    // (Shopify, Razorpay) carry no Counter Bearer JWT either — their own
    // HMAC signature, verified inside webhook-routes.ts, is the entire
    // proof of authenticity for those routes; isSkipped's prefix match
    // (path.startsWith(route + "/")) covers both the bare
    // /webhooks/v1/:adapter route and the /webhooks/v1/:adapter/* one.
    skipAuthRoutes: [
      "/control/v1/wallet-users/agent-keys",
      ...(options?.shopifyConnectionProvisioner !== undefined
        ? [SHOPIFY_CALLBACK_ROUTE_PATTERN]
        : []),
      ...(options?.webhookRoutes !== undefined ? ["/webhooks/v1"] : []),
    ],
    ...(options?.merchantApplicationProvisioner !== undefined
      ? { skipActorClaimsRoutes: [MERCHANT_APPLICATION_PROVISION_ROUTE] }
      : {}),
    logger: options?.logger ?? false,
  };

  const server = createHttpServer(serverOptions);

  // Register route permissions for control-plane routes
  registerRoutePermission("GET:/control/v1/status", {
    permission: "identity.scope.read",
  });

  registerRoutePermission("GET:/control/v1/merchants", {
    permission: "identity.scope.read",
  });

  // Sample protected route for testing auth and scope enforcement
  server.get("/control/v1/status", async (_request, reply) => {
    void reply.send({ status: "operational", version, environment });
  });

  // Merchant route placeholders
  server.get("/control/v1/merchants", async (_request, reply) => {
    void reply.send({
      placeholder: true,
      message: "Merchant routes - to be implemented in Merchant Task 3",
    });
  });

  // Register policy management routes. In production-like environments a
  // durable store MUST be injected; local/test fall back to in-memory.
  const store = resolvePolicyStore(environment, options);
  const compiler = options?.policyCompiler ?? createDefaultPolicyCompiler();
  void server.register(policyRoutesPlugin, { store, compiler });

  // Register merchant transaction read-model routes. In production-like
  // environments a durable store MUST be injected; local/test fall back to
  // in-memory.
  const transactionStore = resolveTransactionStore(environment, options);
  void server.register(transactionRoutesPlugin, { store: transactionStore, environment });

  // Self-serve wallet onboarding routes — only registered when a
  // provisioner is wired (see CreateServerOptions.walletUserProvisioner).
  if (options?.walletUserProvisioner !== undefined) {
    void server.register(walletUserRoutesPlugin, {
      provisioner: options.walletUserProvisioner,
    });
  }

  // Recurring payment mandate routes — only registered when a provisioner
  // is wired (see CreateServerOptions.recurringMandateProvisioner).
  if (options?.recurringMandateProvisioner !== undefined) {
    void server.register(recurringMandateRoutesPlugin, {
      provisioner: options.recurringMandateProvisioner,
    });
  }

  // Wallet-mandate binding route — only registered when a binding service
  // is wired (see CreateServerOptions.mandateBindingService).
  if (options?.mandateBindingService !== undefined) {
    void server.register(mandateBindingRoutesPlugin, {
      bindingService: options.mandateBindingService,
    });
  }

  // Self-serve Shopify OAuth routes — only registered when a provisioner is
  // wired (see CreateServerOptions.shopifyConnectionProvisioner).
  if (options?.shopifyConnectionProvisioner !== undefined) {
    void server.register(shopifyConnectRoutesPlugin, {
      provisioner: options.shopifyConnectionProvisioner,
    });
  }

  // Refund-request relay routes (list/approve/deny) — only registered when
  // a store is wired (see CreateServerOptions.refundRequestStore).
  if (options?.refundRequestStore !== undefined) {
    void server.register(refundRequestRoutesPlugin, {
      store: options.refundRequestStore,
    });
  }

  // Self-serve merchant onboarding routes — only registered when a
  // provisioner is wired (see CreateServerOptions.merchantApplicationProvisioner).
  if (options?.merchantApplicationProvisioner !== undefined) {
    void server.register(merchantApplicationRoutesPlugin, {
      provisioner: options.merchantApplicationProvisioner,
    });
  }

  // Self-serve onboarding, Step 4 (own-gateway Razorpay connect) — only
  // registered when a store is wired.
  if (options?.merchantPaymentConnectionStore !== undefined) {
    void server.register(merchantPaymentConnectionRoutesPlugin, {
      store: options.merchantPaymentConnectionStore,
    });
  }

  // Merchant webhook endpoint registration (Phase 2 notifications backbone)
  // — only registered when a store is wired.
  if (options?.merchantWebhookEndpointStore !== undefined) {
    void server.register(merchantWebhookEndpointRoutesPlugin, {
      store: options.merchantWebhookEndpointStore,
    });
  }

  // Buyer-facing notifications/invoices (Phase 2 notifications backbone) —
  // only registered when a store is wired.
  if (options?.buyerNotificationStore !== undefined) {
    void server.register(buyerNotificationRoutesPlugin, {
      store: options.buyerNotificationStore,
    });
  }

  // Buyer-facing active-mandates listing (Phase 4, wallet-dashboard
  // backend) — only registered when a repository is wired.
  if (options?.mandateRepository !== undefined) {
    void server.register(walletMandateRoutesPlugin, {
      mandateRepository: options.mandateRepository,
    });
  }

  // Self-serve onboarding, Step 5 (readiness check) — only registered when
  // a service is wired.
  if (options?.merchantReadinessService !== undefined) {
    void server.register(merchantReadinessRoutesPlugin, {
      service: options.merchantReadinessService,
    });
  }

  // Self-serve onboarding, Step 6 (manifest confirmation) — only registered
  // when a store is wired.
  if (options?.merchantManifestStore !== undefined) {
    void server.register(merchantManifestRoutesPlugin, {
      store: options.merchantManifestStore,
    });
  }

  // Real webhook ingress for Shopify and Razorpay — only registered when
  // configured (see CreateServerOptions.webhookRoutes).
  if (options?.webhookRoutes !== undefined) {
    void server.register(webhookRoutesPlugin, options.webhookRoutes);
  }

  return server;
}

/**
 * Start the server with graceful shutdown support.
 */
export function startServer(options?: CreateServerOptions): FastifyInstance {
  const server = createServer(options);
  attachGracefulShutdown(server);
  return server;
}
