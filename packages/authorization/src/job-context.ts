import {
  createCanonicalError,
  err,
  isEnvironment,
  ok,
  parseCounterId,
  scopesEqual,
  type CanonicalErrorFor,
  type CorrelationId,
  type Environment,
  type Instant,
  type MerchantId,
  type Result,
  type Scope,
  type ServiceId,
  type WalletId,
} from "@counter/domain";
import type { ActorContext } from "./actor-context.js";
import { authorize, isAuthorizedContext, type AuthorizedContext } from "./authorize.js";
import { isPermission, type Permission } from "./catalog.js";

export type JobScope =
  | Readonly<{ kind: "merchant"; merchantId: MerchantId }>
  | Readonly<{ kind: "wallet"; walletId: WalletId }>
  | Readonly<{ kind: "platform" }>;

export interface JobAuthorizationEnvelope {
  readonly serviceId: ServiceId;
  readonly environment: Environment;
  readonly scope: JobScope;
  readonly correlationId: CorrelationId;
  readonly requiredPermission: Permission;
}

export function createJobAuthorizationEnvelope(
  context: AuthorizedContext,
): Result<JobAuthorizationEnvelope, CanonicalErrorFor<"UNAUTHORIZED">> {
  if (
    !isAuthorizedContext(context) ||
    context.actor.kind !== "service" ||
    context.supportGrantId !== undefined
  ) {
    return unauthorized();
  }

  return ok(
    Object.freeze({
      serviceId: context.actor.id,
      environment: context.environment,
      scope: scopeToJobScope(context.effectiveScope),
      correlationId: context.correlationId,
      requiredPermission: context.authorizedPermission,
    }),
  );
}

export function parseJobAuthorizationEnvelope(
  value: unknown,
): Result<JobAuthorizationEnvelope, CanonicalErrorFor<"UNAUTHORIZED">> {
  if (
    !isRecord(value) ||
    !isEnvironment(value["environment"]) ||
    !isPermission(value["requiredPermission"])
  ) {
    return unauthorized();
  }
  const serviceId = parseCounterId(value["serviceId"], "service");
  const correlationId = parseCounterId(value["correlationId"], "correlation");
  const scope = parseJobScope(value["scope"]);
  if (!serviceId.ok || !correlationId.ok || !scope.ok) {
    return unauthorized();
  }

  return ok(
    Object.freeze({
      serviceId: serviceId.value,
      environment: value["environment"],
      scope: scope.value,
      correlationId: correlationId.value,
      requiredPermission: value["requiredPermission"],
    }),
  );
}

export function reauthorizeJob(
  envelope: JobAuthorizationEnvelope,
  currentContext: ActorContext,
  at: Instant,
): Result<AuthorizedContext, CanonicalErrorFor<"UNAUTHORIZED">> {
  if (
    currentContext.actor.kind !== "service" ||
    currentContext.actor.id !== envelope.serviceId ||
    currentContext.environment !== envelope.environment ||
    currentContext.correlationId !== envelope.correlationId
  ) {
    return unauthorized();
  }

  const scope = jobScopeToScope(envelope.scope, envelope.environment);
  if (!scopesEqual(currentContext.scope, scope)) {
    return unauthorized();
  }

  return authorize(currentContext, {
    permission: envelope.requiredPermission,
    environment: envelope.environment,
    scope,
    at,
  });
}

function parseJobScope(value: unknown): Result<JobScope, CanonicalErrorFor<"UNAUTHORIZED">> {
  if (!isRecord(value) || typeof value["kind"] !== "string") {
    return unauthorized();
  }
  if (value["kind"] === "platform") {
    return ok(Object.freeze({ kind: "platform" }));
  }
  if (value["kind"] === "merchant") {
    const merchantId = parseCounterId(value["merchantId"], "merchant");
    return merchantId.ok
      ? ok(Object.freeze({ kind: "merchant", merchantId: merchantId.value }))
      : unauthorized();
  }
  if (value["kind"] === "wallet") {
    const walletId = parseCounterId(value["walletId"], "wallet");
    return walletId.ok
      ? ok(Object.freeze({ kind: "wallet", walletId: walletId.value }))
      : unauthorized();
  }
  return unauthorized();
}

function scopeToJobScope(scope: Scope): JobScope {
  switch (scope.kind) {
    case "merchant":
      return Object.freeze({ kind: "merchant", merchantId: scope.merchantId });
    case "wallet":
      return Object.freeze({ kind: "wallet", walletId: scope.walletId });
    case "platform":
      return Object.freeze({ kind: "platform" });
  }
}

function jobScopeToScope(scope: JobScope, environment: Environment): Scope {
  switch (scope.kind) {
    case "merchant":
      return Object.freeze({ kind: "merchant", environment, merchantId: scope.merchantId });
    case "wallet":
      return Object.freeze({ kind: "wallet", environment, walletId: scope.walletId });
    case "platform":
      return Object.freeze({ kind: "platform", environment });
  }
}

function isRecord(value: unknown): value is Readonly<Record<string, unknown>> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function unauthorized(): Result<never, CanonicalErrorFor<"UNAUTHORIZED">> {
  return err(createCanonicalError("UNAUTHORIZED"));
}
