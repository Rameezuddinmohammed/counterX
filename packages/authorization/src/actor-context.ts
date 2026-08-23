import {
  createCanonicalError,
  err,
  ok,
  type ActorReference,
  type CanonicalErrorFor,
  type CorrelationId,
  type Environment,
  type Result,
  type Scope,
} from "@counter/domain";
import {
  assuranceMatchesActor,
  isAuthenticationAssurance,
  type AuthenticationAssurance,
} from "./assurance.js";
import {
  actorKindCanUseScopeKind,
  isRoleKey,
  normalizeRoles,
  permissionsForRoles,
  roleSupportsActorAndScope,
  type Permission,
  type RoleKey,
} from "./catalog.js";
import { isSupportGrantRecord, type SupportGrantRecord } from "./records.js";

const actorContextBrand: unique symbol = Symbol("ActorContext");
const actorContexts = new WeakSet<object>();

export interface ActorContext {
  readonly [actorContextBrand]: true;
  readonly actor: ActorReference;
  readonly environment: Environment;
  readonly scope: Scope;
  readonly assurance: AuthenticationAssurance;
  readonly roles: readonly RoleKey[];
  readonly permissions: readonly Permission[];
  readonly correlationId: CorrelationId;
  readonly supportGrant?: SupportGrantRecord;
}

export interface ActorContextInput {
  readonly actor: ActorReference;
  readonly environment: Environment;
  readonly scope: Scope;
  readonly assurance: AuthenticationAssurance;
  readonly roles: readonly RoleKey[];
  readonly correlationId: CorrelationId;
  readonly supportGrant?: SupportGrantRecord;
}

export function createActorContext(
  input: ActorContextInput,
): Result<ActorContext, CanonicalErrorFor<"UNAUTHORIZED">> {
  if (
    input.environment !== input.scope.environment ||
    !actorKindCanUseScopeKind(input.actor.kind, input.scope.kind) ||
    !isAuthenticationAssurance(input.assurance) ||
    !assuranceMatchesActor(input.assurance, input.actor.kind) ||
    !input.roles.every(isRoleKey) ||
    !input.roles.every((role) =>
      roleSupportsActorAndScope(role, input.actor.kind, input.scope.kind),
    ) ||
    !validSupportGrant(input)
  ) {
    return unauthorized();
  }

  const roles = normalizeRoles(input.roles);
  const base = {
    [actorContextBrand]: true as const,
    actor: cloneActor(input.actor),
    environment: input.environment,
    scope: cloneScope(input.scope),
    assurance: input.assurance,
    roles,
    permissions: permissionsForRoles(roles),
    correlationId: input.correlationId,
  };
  const context: ActorContext = Object.freeze(
    input.supportGrant === undefined ? base : { ...base, supportGrant: input.supportGrant },
  );
  actorContexts.add(context);
  return ok(context);
}

export function isActorContext(value: unknown): value is ActorContext {
  return typeof value === "object" && value !== null && actorContexts.has(value);
}

function validSupportGrant(input: ActorContextInput): boolean {
  if (input.supportGrant === undefined) {
    return true;
  }
  return (
    isSupportGrantRecord(input.supportGrant) &&
    input.actor.kind === "operator" &&
    input.scope.kind === "platform" &&
    input.roles.includes("platform.operator") &&
    input.supportGrant.operatorId === input.actor.id &&
    input.supportGrant.environment === input.environment
  );
}

function unauthorized(): Result<never, CanonicalErrorFor<"UNAUTHORIZED">> {
  return err(createCanonicalError("UNAUTHORIZED"));
}

function cloneActor(actor: ActorReference): ActorReference {
  return Object.freeze({ kind: actor.kind, id: actor.id }) as ActorReference;
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
