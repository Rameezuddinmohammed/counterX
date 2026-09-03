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
    /** See AuthPluginOptions.resourceMetadataUrl. */
    readonly resourceMetadataUrl?: string;
  };
  readonly health?: {
    readonly readinessChecker?: ReadinessChecker;
  };
  readonly openApi?: OpenApiInfo;
  readonly skipAuthRoutes?: readonly string[];
  /**
   * Routes where a valid Bearer JWT is still required (authPlugin runs
   * normally — a request with no session at all is still rejected with 401)
   * but actor-extraction's hard requirement for Counter's OWN custom claims
   * (actor_kind/environment/scope, normally stamped by a Post-Login Action)
   * is relaxed, so getActorContext() is simply undefined on these routes
   * rather than the request being auto-401'd before the handler runs.
   *
   * Exists for apps/control-plane-api/src/merchant-application-routes.ts's
   * self-serve provision route: a brand-new Auth0 user has a real, valid
   * session but no Counter custom claims yet, because no Post-Login Action
   * exists for merchant onboarding (that Auth0-side wiring is out of scope
   * for the pass that added this). The route itself reads the verified raw
   * JWT payload (getJwtPayload) to decide what a claims-less-but-genuinely-
   * authenticated caller may do — see that file's header for the full
   * reasoning.
   *
   * Distinct from skipAuthRoutes, which skips ALL THREE plugins (auth
   * included) and is for requests that carry no JWT/session at all (e.g.
   * the wallet-user agent-keys route, or an external OAuth callback).
   */
  readonly skipActorClaimsRoutes?: readonly string[];
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
  const actorSkipRoutes = [...skipRoutes, ...(options.skipActorClaimsRoutes ?? [])];

  const server = Fastify({
    logger: options.logger ?? false,
    disableRequestLogging: true,
    // Every app built by this factory deploys on Fly, and Fly's edge proxy
    // is the only thing that can ever reach these apps directly, adding
    // exactly one X-Forwarded-For hop. `1` trusts that one hop for
    // Fastify's own request.ip resolution (used for correlation/logging,
    // and by anything mounted on top - see oauth-router.ts's comment on
    // @fastify/express for why that dependency in particular needs this
    // set here, at the Fastify level, and not only on the Express side).
    trustProxy: 1,
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
    ...(options.auth.resourceMetadataUrl !== undefined
      ? { resourceMetadataUrl: options.auth.resourceMetadataUrl }
      : {}),
  });
  void server.register(actorExtractionPlugin, { skipRoutes: actorSkipRoutes });
  void server.register(scopeEnforcementPlugin, {
    skipRoutes: actorSkipRoutes,
    ...(options.scopeEnforcement ?? {}),
  });

  const healthOpts: HealthPluginOptions =
    options.health?.readinessChecker !== undefined
      ? {
          version: options.version,
          environment: options.environment,
          readinessChecker: options.health.readinessChecker,
        }
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
