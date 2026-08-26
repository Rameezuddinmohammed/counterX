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

  // Register merchant runtime routes with handler ports
  const handlers = options?.merchantHandlers ?? createMockHandlers();
  void server.register(merchantRoutesPlugin, { handlers });

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

// --- Auto-start when executed directly (e.g., via Dockerfile CMD) ---
import { fileURLToPath } from "node:url";
import { resolve } from "node:path";

const isMainModule =
  resolve(process.argv[1] ?? "") === fileURLToPath(import.meta.url);

if (isMainModule) {
  const port = parseInt(process.env["PORT"] || "8080", 10);
  const server = startServer({
    logger: true,
    environment: process.env["NODE_ENV"] || "production",
    version: process.env["APP_VERSION"] || DEFAULT_VERSION,
  });

  server.listen({ port, host: "0.0.0.0" }).then((address) => {
    server.log.info(`${APP_NAME} listening on ${address}`);
  });
}
