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
import { importSPKI, type JWTVerifyGetKey } from "jose";
import { RUNTIME_TOKEN_TEST_PUBLIC_KEY_PEM } from "@counter/domain";
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

// AUTH0_DOMAIN (this app's actual deployed secret name — confirmed against
// `flyctl secrets list`) / AUTH0_AUDIENCE — this app previously hardcoded
// its own dev tenant here with no env override at all, so a different Auth0
// tenant required a source change instead of an env flip. The dev-tenant
// string stays as the fallback default so nothing breaks when unset.
//
// The JWKS URL below is built by string concatenation
// (`${AUTH_ISSUER}.well-known/jwks.json`) and the Auth0 issuer claim itself
// is conventionally slash-terminated — normalize to exactly one trailing
// slash regardless of how the operator sets AUTH0_DOMAIN.
function withTrailingSlash(url: string): string {
  return url.endsWith("/") ? url : `${url}/`;
}

const AUTH_ISSUER = withTrailingSlash(
  `https://${process.env["AUTH0_DOMAIN"] ?? "dev-jzw3etjxnn3svs56.us.auth0.com"}`,
);
const AUTH_AUDIENCE = process.env["AUTH0_AUDIENCE"] ?? "https://api.counter.dev";

// Second trusted issuer: control-plane-api's own self-signed buyer-runtime
// credentials (apps/control-plane-api/src/wallet-user-store.ts's
// mintRuntimeCredential), alongside Auth0 for every other actor. The public
// key is base64-encoded PEM, matching the private key's encoding on the
// signing side (env-var-safe, no newline/quoting hazard). Outside
// production this falls back to the same public, non-secret test fixture
// control-plane-api's signer falls back to, so a local dev loop or test
// server works with zero configuration — see
// packages/domain/src/runtime-token-test-fixture.ts's docs.
const RUNTIME_TOKEN_ISSUER =
  process.env["COUNTER_RUNTIME_TOKEN_ISSUER"] || "https://runtime.counter.dev/";

/** Resolves the runtime-token public key: real key when configured, the public test fixture only outside production. */
function resolveRuntimeTokenPublicKeyPem(environment: string): string | undefined {
  const encoded = process.env["COUNTER_RUNTIME_TOKEN_PUBLIC_KEY_BASE64"];
  if (encoded !== undefined && encoded.trim().length > 0) {
    return Buffer.from(encoded, "base64").toString("utf8");
  }
  return environment === "production" ? undefined : RUNTIME_TOKEN_TEST_PUBLIC_KEY_PEM;
}

/** Lazily imports and caches a PEM public key as a JWTVerifyGetKey. */
function createLocalPemKeyGetter(pem: string): JWTVerifyGetKey {
  let cached: ReturnType<typeof importSPKI> | undefined;
  return (async () => {
    cached ??= importSPKI(pem, "RS256");
    return cached;
  }) as JWTVerifyGetKey;
}

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
  const runtimeTokenPublicKeyPem = resolveRuntimeTokenPublicKeyPem(environment);

  const serverOptions: ServerFactoryOptions = {
    name: APP_NAME,
    version,
    environment,
    auth: {
      issuer: AUTH_ISSUER,
      audience: AUTH_AUDIENCE,
      jwks,
      ...(runtimeTokenPublicKeyPem !== undefined
        ? {
            secondaryIssuer: {
              issuer: RUNTIME_TOKEN_ISSUER,
              jwks: createLocalPemKeyGetter(runtimeTokenPublicKeyPem),
            },
          }
        : {}),
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
