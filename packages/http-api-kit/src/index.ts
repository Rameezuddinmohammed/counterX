/**
 * @counter/http-api-kit
 *
 * Shared Fastify middleware and utilities for Counter HTTP APIs.
 * Provides authentication, correlation tracking, error mapping,
 * scope enforcement, health checks, webhook ingress, and OpenAPI generation.
 */

export { correlationPlugin, getCorrelationId } from "./correlation.js";
export { idempotencyPlugin, getIdempotencyKey } from "./idempotency.js";
export {
  errorHandlerPlugin,
  mapCanonicalErrorToStatus,
  buildErrorResponse,
  CanonicalHttpError,
  throwCanonicalError,
  type HttpErrorResponse,
} from "./error-handler.js";
export { authPlugin, getJwtPayload, type AuthPluginOptions, type JwtPayload } from "./auth.js";
export {
  actorExtractionPlugin,
  getActorContext,
  type ActorExtractionOptions,
} from "./actor-extraction.js";
export {
  scopeEnforcementPlugin,
  registerRoutePermission,
  clearRoutePermissions,
  type RoutePermissionConfig,
  type ScopeEnforcementOptions,
} from "./scope-enforcement.js";
export {
  healthPlugin,
  type HealthPluginOptions,
  type HealthResponse,
  type ReadinessCheck,
  type ReadinessChecker,
  type ReadinessResponse,
} from "./health.js";
export {
  webhookIngressPlugin,
  getRawBody,
  type WebhookHandler,
  type WebhookIngressOptions,
} from "./webhook-ingress.js";
export { openApiPlugin, type OpenApiInfo, type OpenApiPluginOptions } from "./openapi.js";
export {
  createHttpServer,
  attachGracefulShutdown,
  type ServerFactoryOptions,
} from "./server-factory.js";
