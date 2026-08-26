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

export const APP_NAME = "@counter/control-plane-api";

const DEFAULT_VERSION = "0.1.0";
const DEFAULT_ENVIRONMENT = "local";
const AUTH_ISSUER = "https://dev-jzw3etjxnn3svs56.us.auth0.com/";
const AUTH_AUDIENCE = "https://api.counter.dev";

export interface CreateServerOptions {
  readonly version?: string | undefined;
  readonly environment?: string | undefined;
  readonly jwks?: JWTVerifyGetKey | string | undefined;
  readonly logger?: boolean | undefined;
  readonly policyStore?: PolicyStore | undefined;
  readonly policyCompiler?: PolicyCompiler | undefined;
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

  // Register policy management routes
  const store = options?.policyStore ?? createInMemoryPolicyStore();
  const compiler = options?.policyCompiler ?? createDefaultPolicyCompiler();
  void server.register(policyRoutesPlugin, { store, compiler });

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
