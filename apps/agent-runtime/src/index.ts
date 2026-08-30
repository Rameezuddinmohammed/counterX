/**
 * apps/agent-runtime
 *
 * Latency-sensitive discovery/quote/transaction commands under
 * `/runtime/v1/...`. Webhook ingress under `/webhooks/v1/{adapter}/*`.
 *
 * Uses @counter/http-api-kit for standard middleware (auth, correlation,
 * error mapping, scope enforcement, health checks, webhooks, and OpenAPI).
 */
import type { FastifyInstance } from "fastify";
import type { JWTVerifyGetKey } from "jose";
import {
  createHttpServer,
  attachGracefulShutdown,
  webhookIngressPlugin,
  registerRoutePermission,
  type ServerFactoryOptions,
  type WebhookIngressOptions,
} from "@counter/http-api-kit";
import { merchantRoutesPlugin } from "./merchant-routes.js";
import type { MerchantHandlers } from "./merchant-handlers.js";
import { createMockHandlers } from "./merchant-handlers.js";
import {
  createInMemoryRuntimeIdempotencyStore,
  type RuntimeIdempotencyStore,
} from "./idempotency-store.js";

export const APP_NAME = "@counter/agent-runtime";

const DEFAULT_VERSION = "0.1.0";
const DEFAULT_ENVIRONMENT = "local";
const AUTH_ISSUER = "https://dev-jzw3etjxnn3svs56.us.auth0.com/";
const AUTH_AUDIENCE = "https://api.counter.dev";

export interface CreateServerOptions {
  readonly version?: string | undefined;
  readonly environment?: string | undefined;
  readonly jwks?: JWTVerifyGetKey | string | undefined;
  readonly logger?: boolean | undefined;
  readonly webhooks?: WebhookIngressOptions | undefined;
  readonly merchantHandlers?: MerchantHandlers | undefined;
  /**
   * Optional durable idempotency store for mutating routes. In production-like
   * environments a store MUST be provided (wired from DATABASE_URL in main.ts);
   * local/test fall back to an in-memory store so existing tests are unchanged.
   */
  readonly idempotencyStore?: RuntimeIdempotencyStore | undefined;
  /**
   * Explicit opt-in to fall back to mock merchant handlers when no real
   * handlers are supplied. Mock handlers are ONLY permitted in local/test
   * environments. In production-like environments this flag is ignored and
   * the server refuses to start without real handlers.
   */
  readonly allowMockHandlers?: boolean | undefined;
}

/**
 * Environments that are permitted to fall back to mock merchant handlers.
 *
 * NOTE: main.ts passes environment as NODE_ENV (development/test/production),
 * NOT the COUNTER_ENV taxonomy. We therefore treat both the Counter local
 * tiers (local/test) and the Node development tier as the non-production tier
 * that MAY use mocks (only with an explicit opt-in). Everything else
 * (production/sandbox/pilot and any unknown value) is production-like and MUST
 * be given real handlers.
 */
const MOCK_ELIGIBLE_ENVIRONMENTS: ReadonlySet<string> = new Set(["local", "test", "development"]);

function resolveMerchantHandlers(
  environment: string,
  options: CreateServerOptions | undefined,
): MerchantHandlers {
  if (options?.merchantHandlers !== undefined) {
    return options.merchantHandlers;
  }

  const mockEligible = MOCK_ELIGIBLE_ENVIRONMENTS.has(environment);
  if (mockEligible && options?.allowMockHandlers === true) {
    return createMockHandlers();
  }

  if (mockEligible) {
    throw new Error(
      `[${APP_NAME}] No merchantHandlers were provided. Mock handlers are ` +
        `available in the '${environment}' environment but only when ` +
        `allowMockHandlers is explicitly set to true. Provide real ` +
        `merchantHandlers or set allowMockHandlers: true for local/test use.`,
    );
  }

  throw new Error(
    `[${APP_NAME}] Refusing to start in production-like environment ` +
      `'${environment}' without real merchantHandlers. Mock handlers are not ` +
      `permitted outside local/test/development. Wire real merchant handlers ` +
      `before deploying.`,
  );
}

function resolveIdempotencyStore(
  options: CreateServerOptions | undefined,
): RuntimeIdempotencyStore {
  if (options?.idempotencyStore !== undefined) {
    return options.idempotencyStore;
  }

  // Default to an in-memory store. The fail-loud requirement for durable
  // idempotency lives in main.ts, which requires DATABASE_URL in production-like
  // environments and injects a PostgresIdempotencyStore. Keeping createServer's
  // default in-memory preserves the options-injection contract that existing
  // unit tests rely on (real handlers injected without a store still start).
  return createInMemoryRuntimeIdempotencyStore();
}

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
      ? { openApi: { title: "Counter Agent Runtime API", version } }
      : {}),
    logger: options?.logger ?? false,
  };

  const server = createHttpServer(serverOptions);

  // Register webhook ingress (raw body, no auth, content-type agnostic)
  if (options?.webhooks !== undefined) {
    void server.register(webhookIngressPlugin, options.webhooks);
  } else {
    void server.register(webhookIngressPlugin, {});
  }

  // Register route permissions for runtime routes
  registerRoutePermission("GET:/runtime/v1/status", {
    permission: "identity.scope.read",
  });

  // Sample protected route for testing auth and scope enforcement
  server.get("/runtime/v1/status", async (_request, reply) => {
    void reply.send({ status: "operational", version, environment });
  });

  // Register merchant runtime routes with handler ports.
  // Mock handlers are only permitted in local/test/development with an
  // explicit opt-in; production-like environments must supply real handlers.
  const handlers = resolveMerchantHandlers(environment, options);
  const idempotencyStore = resolveIdempotencyStore(options);
  void server.register(merchantRoutesPlugin, { handlers, idempotencyStore });

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
