/**
 * Server factory that produces a configured Fastify instance with all
 * standard middleware registered.
 *
 * Supports graceful shutdown on SIGTERM/SIGINT.
 */
import Fastify, { type FastifyInstance } from "fastify";
import type { JWTVerifyGetKey } from "jose";
import { correlationPlugin } from "./correlation.js";
import { idempotencyPlugin } from "./idempotency.js";
import { errorHandlerPlugin } from "./error-handler.js";
import { authPlugin } from "./auth.js";
import { actorExtractionPlugin } from "./actor-extraction.js";
import { scopeEnforcementPlugin, type ScopeEnforcementOptions } from "./scope-enforcement.js";
import { healthPlugin, type HealthPluginOptions, type ReadinessChecker } from "./health.js";
import { openApiPlugin, type OpenApiInfo } from "./openapi.js";

export interface ServerFactoryOptions {
  readonly name: string;
  readonly version: string;
  readonly environment: string;
  readonly auth: {
    readonly issuer: string;
    readonly audience: string;
    readonly jwks: JWTVerifyGetKey | string;
  };
  readonly health?: {
    readonly readinessChecker?: ReadinessChecker;
  };
  readonly openApi?: OpenApiInfo;
  readonly skipAuthRoutes?: readonly string[];
  readonly scopeEnforcement?: ScopeEnforcementOptions;
  readonly logger?: boolean;
}

export function createHttpServer(options: ServerFactoryOptions): FastifyInstance {
  const skipRoutes = [
    "/health",
    "/ready",
    "/docs/openapi.json",
    "/webhooks/v1",
    ...(options.skipAuthRoutes ?? []),
  ];

  const server = Fastify({
    logger: options.logger ?? false,
    disableRequestLogging: true,
  });

  // Register plugins in order (order matters for hooks)
  void server.register(errorHandlerPlugin);
  void server.register(correlationPlugin);
  void server.register(idempotencyPlugin);
  void server.register(authPlugin, {
    issuer: options.auth.issuer,
    audience: options.auth.audience,
    jwks: options.auth.jwks,
    skipRoutes,
  });
  void server.register(actorExtractionPlugin, { skipRoutes });
  void server.register(scopeEnforcementPlugin, {
    skipRoutes,
    ...(options.scopeEnforcement ?? {}),
  });

  const healthOpts: HealthPluginOptions = options.health?.readinessChecker !== undefined
    ? { version: options.version, environment: options.environment, readinessChecker: options.health.readinessChecker }
    : { version: options.version, environment: options.environment };
  void server.register(healthPlugin, healthOpts);

  if (options.openApi !== undefined) {
    void server.register(openApiPlugin, {
      info: options.openApi,
      environment: options.environment,
    });
  }

  return server;
}

/**
 * Attach graceful shutdown handlers to the server.
 * Listens for SIGTERM and SIGINT and calls server.close().
 */
export function attachGracefulShutdown(server: FastifyInstance): void {
  const shutdown = () => {
    void server.close();
  };

  process.on("SIGTERM", shutdown);
  process.on("SIGINT", shutdown);
}
