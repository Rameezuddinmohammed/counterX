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

export const APP_NAME = "@counter/control-plane-api";

const DEFAULT_VERSION = "0.1.0";
const DEFAULT_ENVIRONMENT = "local";
const AUTH_ISSUER = "https://dev-jzw3etjxnn3svs56.us.auth0.com/";
const AUTH_AUDIENCE = "https://api.counter.dev";

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
}

export function createServer(options?: CreateServerOptions): FastifyInstance {
  const version = options?.version ?? DEFAULT_VERSION;
  const environment = options?.environment ?? DEFAULT_ENVIRONMENT;

  const jwks: JWTVerifyGetKey | string =
    options?.jwks ?? `${AUTH_ISSUER}.well-known/jwks.json`;

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
