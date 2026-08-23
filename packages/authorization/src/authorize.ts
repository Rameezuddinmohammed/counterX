import {
  createCanonicalError,
  err,
  ok,
  scopesEqual,
  type ActorReference,
  type CanonicalErrorFor,
  type CorrelationId,
  type Environment,
  type Instant,
  type Result,
  type Scope,
  type SupportGrantId,
} from "@counter/domain";
import { isActorContext, type ActorContext } from "./actor-context.js";
import { assurancePermits } from "./assurance.js";
import { isPermission, type Permission, type RoleKey } from "./catalog.js";
import {
  isSupportGrantActiveAt,
  isSupportPermission,
  supportGrantTargets,
  type SupportGrantRecord,
} from "./records.js";

const authorizedContextBrand: unique symbol = Symbol("AuthorizedContext");
const authorizedContexts = new WeakSet<object>();

export interface AuthorizationRequest<PermissionType extends Permission = Permission> {
  readonly permission: PermissionType;
  readonly environment: Environment;
  readonly scope: Scope;
  readonly at: Instant;
}

export interface AuthorizedContext<PermissionType extends Permission = Permission> {
  readonly [authorizedContextBrand]: true;
  readonly actor: ActorReference;
  readonly environment: Environment;
  readonly homeScope: Scope;
  readonly effectiveScope: Scope;
  readonly assurance: ActorContext["assurance"];
  readonly roles: readonly RoleKey[];
  readonly permissions: readonly Permission[];
  readonly authorizedPermission: PermissionType;
  readonly correlationId: CorrelationId;
  readonly supportGrantId?: SupportGrantId;
}

export function authorize<PermissionType extends Permission>(
  context: ActorContext,
  request: AuthorizationRequest<PermissionType>,
): Result<AuthorizedContext<PermissionType>, CanonicalErrorFor<"UNAUTHORIZED">> {
  if (
    !isActorContext(context) ||
    !isPermission(request.permission) ||
    context.environment !== request.environment ||
    request.scope.environment !== request.environment ||
    !context.permissions.includes(request.permission) ||
    !assurancePermits(context.assurance, request.permission)
  ) {
    return unauthorized();
  }

  if (scopesEqual(context.scope, request.scope)) {
    return ok(createAuthorizedContext(context, request, undefined));
  }

  if (allowsTenantScopeProvisioning(context, request)) {
    return ok(createAuthorizedContext(context, request, undefined));
  }

  const supportGrant = context.supportGrant;
  if (!supportAllows(context, request, supportGrant)) {
    return unauthorized();
  }

  return ok(createAuthorizedContext(context, request, supportGrant));
}

export function isAuthorizedContext(value: unknown): value is AuthorizedContext {
  return typeof value === "object" && value !== null && authorizedContexts.has(value);
}

function allowsTenantScopeProvisioning<PermissionType extends Permission>(
  context: ActorContext,
  request: AuthorizationRequest<PermissionType>,
): boolean {
  return (
    request.permission === "identity.scope.manage" &&
    context.actor.kind === "operator" &&
    context.scope.kind === "platform" &&
    context.roles.includes("platform.operator") &&
    context.assurance === "step_up" &&
    (request.scope.kind === "merchant" || request.scope.kind === "wallet")
  );
}

function supportAllows<PermissionType extends Permission>(
  context: ActorContext,
  request: AuthorizationRequest<PermissionType>,
  grant: SupportGrantRecord | undefined,
): grant is SupportGrantRecord {
  const permission: Permission = request.permission;
  if (!isSupportPermission(permission)) {
    return false;
  }

  return (
    grant !== undefined &&
    context.actor.kind === "operator" &&
    context.scope.kind === "platform" &&
    context.permissions.includes("identity.support_grant.use") &&
    assurancePermits(context.assurance, "identity.support_grant.use") &&
    grant.operatorId === context.actor.id &&
    grant.permissions.includes(permission) &&
    supportGrantTargets(grant, request.environment, request.scope) &&
    isSupportGrantActiveAt(grant, request.at)
  );
}

function createAuthorizedContext<PermissionType extends Permission>(
  context: ActorContext,
  request: AuthorizationRequest<PermissionType>,
  supportGrant: SupportGrantRecord | undefined,
): AuthorizedContext<PermissionType> {
  const base = {
    [authorizedContextBrand]: true as const,
    actor: context.actor,
    environment: context.environment,
    homeScope: context.scope,
    effectiveScope: cloneScope(request.scope),
    assurance: context.assurance,
    roles: context.roles,
    permissions: context.permissions,
    authorizedPermission: request.permission,
    correlationId: context.correlationId,
  };
  const authorizedContext: AuthorizedContext<PermissionType> = Object.freeze(
    supportGrant === undefined ? base : { ...base, supportGrantId: supportGrant.supportGrantId },
  );
  authorizedContexts.add(authorizedContext);
  return authorizedContext;
}

function cloneScope(scope: Scope): Scope {
  switch (scope.kind) {
    case "merchant":
      return Object.freeze({
        kind: "merchant",
        environment: scope.environment,
        merchantId: scope.merchantId,
      });
    case "wallet":
      return Object.freeze({
        kind: "wallet",
        environment: scope.environment,
        walletId: scope.walletId,
      });
    case "platform":
      return Object.freeze({ kind: "platform", environment: scope.environment });
  }
}

function unauthorized(): Result<never, CanonicalErrorFor<"UNAUTHORIZED">> {
  return err(createCanonicalError("UNAUTHORIZED"));
}
