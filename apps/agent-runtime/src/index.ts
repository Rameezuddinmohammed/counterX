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

export const APP_NAME = "@counter/agent-runtime";

const DEFAULT_VERSION = "0.1.0";
const DEFAULT_ENVIRONMENT = "local";
const AUTH_ISSUER = "https://dev-jzw3etjxnn3svs56.us.auth0.com/";
const AUTH_AUDIENCE = "https://api.counter.dev";

export interface CreateServerOptions {
  readonly version?: string;
  readonly environment?: string;
  readonly jwks?: JWTVerifyGetKey | string;
  readonly logger?: boolean;
  readonly webhooks?: WebhookIngressOptions;
}

export function createServer(options?: CreateServerOptions): FastifyInstance {
  const version = options?.version ?? DEFAULT_VERSION;
  const environment = options?.environment ?? DEFAULT_ENVIRONMENT;

  const jwks: JWTVerifyGetKey | string =
    options?.jwks ?? `${AUTH_ISSUER}.well-known/jwks.json`;

  const baseOptions = {
    name: APP_NAME,
    version,
    environment,
    auth: {
      issuer: AUTH_ISSUER,
      audience: AUTH_AUDIENCE,
      jwks,
    },
    logger: options?.logger ?? false,
  } as const;

  const serverOptions: ServerFactoryOptions =
    environment !== "production"
      ? { ...baseOptions, openApi: { title: "Counter Agent Runtime API", version } }
      : baseOptions;

  const server = createHttpServer(serverOptions);

  // Register webhook ingress (raw body, no auth, content-type agnostic)
  void server.register(webhookIngressPlugin, options?.webhooks ?? {});

  // Register route permissions for runtime routes
  registerRoutePermission("GET:/runtime/v1/status", {
    permission: "identity.scope.read",
  });

  // Sample protected route for testing auth and scope enforcement
  server.get("/runtime/v1/status", async (_request, reply) => {
    void reply.send({ status: "operational", version, environment });
  });

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
