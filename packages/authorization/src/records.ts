import {
  compareInstants,
  createCanonicalError,
  createExternalReference,
  err,
  ok,
  scopesEqual,
  type ActorReference,
  type AgentId,
  type CanonicalError,
  type Environment,
  type ExternalReference,
  type Instant,
  type KeyId,
  type MerchantId,
  type MerchantScope,
  type OperatorId,
  type Result,
  type Scope,
  type ServiceId,
  type SupportGrantId,
  type WalletId,
  type WalletScope,
} from "@counter/domain";
import {
  actorKindCanUseScopeKind,
  isPermission,
  isRoleKey,
  normalizeRoles,
  roleSupportsActorAndScope,
  type Permission,
  type RoleKey,
} from "./catalog.js";

export const IDENTITY_STATUSES = ["active", "suspended", "revoked"] as const;
export type IdentityStatus = (typeof IDENTITY_STATUSES)[number];

export const SUPPORT_REASON_CLASSES = [
  "customer_request",
  "incident_response",
  "security_investigation",
  "regulatory_support",
] as const;
export type SupportReasonClass = (typeof SUPPORT_REASON_CLASSES)[number];

export const SUPPORT_GRANT_MAX_DURATION_MILLISECONDS = 4 * 60 * 60 * 1_000;

export const SUPPORT_PERMISSIONS = [
  "identity.scope.read",
  "identity.actor.read",
  "identity.role.read",
  "identity.agent_key.read",
  "identity.service_identity.read",
] as const satisfies readonly Permission[];
export type SupportPermission = (typeof SUPPORT_PERMISSIONS)[number];

const identityStatusSet: ReadonlySet<string> = new Set(IDENTITY_STATUSES);
const supportReasonSet: ReadonlySet<string> = new Set(SUPPORT_REASON_CLASSES);
const supportPermissionSet: ReadonlySet<string> = new Set(SUPPORT_PERMISSIONS);
const supportGrantAuthorizationRecords = new WeakSet<object>();
const supportGrantRecords = new WeakSet<object>();

export interface MerchantScopeRecord {
  readonly scope: MerchantScope;
  readonly createdAt: Instant;
}

export interface WalletScopeRecord {
  readonly scope: WalletScope;
  readonly createdAt: Instant;
}

export type TenantScopeRecord = MerchantScopeRecord | WalletScopeRecord;

export interface ActorRecord {
  readonly actor: ActorReference;
  readonly environment: Environment;
  readonly scope: Scope;
  readonly status: IdentityStatus;
  readonly createdAt: Instant;
  readonly disabledAt?: Instant;
}

export interface RoleAssignmentRecord {
  readonly actor: ActorReference;
  readonly environment: Environment;
  readonly scope: Scope;
  readonly roles: readonly RoleKey[];
  readonly assignedBy: ActorReference;
  readonly assignedAt: Instant;
  readonly revokedAt?: Instant;
}

/** Caller-supplied assignment intent; repository attribution always comes from ActorContext. */
export type RoleAssignmentInput = Omit<RoleAssignmentRecord, "assignedBy">;

export interface AgentPublicKeyRecord {
  readonly keyId: KeyId;
  readonly agentId: AgentId;
  readonly environment: Environment;
  readonly scope: WalletScope;
  readonly algorithm: "Ed25519";
  readonly publicKeyBase64Url: string;
  readonly createdAt: Instant;
  readonly notBefore: Instant;
  readonly expiresAt?: Instant;
  readonly revokedAt?: Instant;
}

export interface ServiceIdentityRecord {
  readonly serviceId: ServiceId;
  readonly environment: Environment;
  readonly scope: Scope;
  readonly authenticationBinding: ExternalReference;
  readonly status: IdentityStatus;
  readonly createdAt: Instant;
  readonly disabledAt?: Instant;
}

export type SupportGrantAuthorization =
  | Readonly<{
      kind: "approved";
      authorizedBy: OperatorId;
      authorizedAt: Instant;
      approvalReference: ExternalReference;
    }>
  | Readonly<{
      kind: "incident";
      authorizedBy: OperatorId;
      authorizedAt: Instant;
      incidentReference: ExternalReference;
    }>;

export interface SupportGrantRecord {
  readonly supportGrantId: SupportGrantId;
  readonly operatorId: OperatorId;
  readonly environment: Environment;
  readonly targetScope: MerchantScope | WalletScope;
  readonly permissions: readonly SupportPermission[];
  readonly reason: SupportReasonClass;
  readonly authorization: SupportGrantAuthorization;
  readonly issuedAt: Instant;
  readonly validFrom: Instant;
  readonly expiresAt: Instant;
  readonly revokedAt?: Instant;
  readonly revokedBy?: OperatorId;
}

/** Immutable approval evidence persisted independently before a support grant is issued. */
export interface SupportGrantAuthorizationRecord {
  readonly supportGrantId: SupportGrantId;
  readonly operatorId: OperatorId;
  readonly environment: Environment;
  readonly targetScope: MerchantScope | WalletScope;
  readonly permissions: readonly SupportPermission[];
  readonly reason: SupportReasonClass;
  readonly authorization: SupportGrantAuthorization;
  readonly validFrom: Instant;
  readonly expiresAt: Instant;
}

export type SupportGrantAuthorizationIntent =
  | Readonly<{
      kind: "approved";
      authorizedAt: Instant;
      approvalReference: ExternalReference;
    }>
  | Readonly<{
      kind: "incident";
      authorizedAt: Instant;
      incidentReference: ExternalReference;
    }>;

/** Caller-supplied approval intent; repository attribution always comes from ActorContext. */
export type SupportGrantAuthorizationInput = Omit<
  SupportGrantAuthorizationRecord,
  "authorization"
> &
  Readonly<{ authorization: SupportGrantAuthorizationIntent }>;

export function createMerchantScopeRecord(
  scope: MerchantScope,
  createdAt: Instant,
): MerchantScopeRecord {
  return Object.freeze({ scope: cloneScope(scope), createdAt });
}

export function createWalletScopeRecord(scope: WalletScope, createdAt: Instant): WalletScopeRecord {
  return Object.freeze({ scope: cloneScope(scope), createdAt });
}

export function createActorRecord(input: ActorRecord): Result<ActorRecord> {
  if (
    input.environment !== input.scope.environment ||
    !actorKindCanUseScopeKind(input.actor.kind, input.scope.kind) ||
    !isIdentityStatus(input.status) ||
    !validDisabledState(input.status, input.createdAt, input.disabledAt)
  ) {
    return invalidRecord();
  }

  return ok(
    freezeOptional<ActorRecord>({
      actor: cloneActor(input.actor),
      environment: input.environment,
      scope: cloneScope(input.scope),
      status: input.status,
      createdAt: input.createdAt,
      disabledAt: input.disabledAt,
    }),
  );
}

export function createRoleAssignmentRecord(
  input: RoleAssignmentRecord,
): Result<RoleAssignmentRecord> {
  if (
    input.environment !== input.scope.environment ||
    !actorKindCanUseScopeKind(input.actor.kind, input.scope.kind) ||
    input.roles.length === 0 ||
    !input.roles.every(isRoleKey) ||
    !input.roles.every((role) =>
      roleSupportsActorAndScope(role, input.actor.kind, input.scope.kind),
    ) ||
    (input.revokedAt !== undefined && compareInstants(input.revokedAt, input.assignedAt) < 0)
  ) {
    return invalidRecord();
  }

  return ok(
    freezeOptional<RoleAssignmentRecord>({
      actor: cloneActor(input.actor),
      environment: input.environment,
      scope: cloneScope(input.scope),
      roles: normalizeRoles(input.roles),
      assignedBy: cloneActor(input.assignedBy),
      assignedAt: input.assignedAt,
      revokedAt: input.revokedAt,
    }),
  );
}

export function createAgentPublicKeyRecord(
  input: AgentPublicKeyRecord,
): Result<AgentPublicKeyRecord> {
  if (
    input.environment !== input.scope.environment ||
    input.algorithm !== "Ed25519" ||
    !isCanonicalEd25519PublicKey(input.publicKeyBase64Url) ||
    compareInstants(input.notBefore, input.createdAt) < 0 ||
    (input.expiresAt !== undefined && compareInstants(input.expiresAt, input.notBefore) <= 0) ||
    (input.revokedAt !== undefined && compareInstants(input.revokedAt, input.createdAt) < 0)
  ) {
    return invalidRecord();
  }

  return ok(
    freezeOptional<AgentPublicKeyRecord>({
      keyId: input.keyId,
      agentId: input.agentId,
      environment: input.environment,
      scope: cloneScope(input.scope),
      algorithm: "Ed25519" as const,
      publicKeyBase64Url: input.publicKeyBase64Url,
      createdAt: input.createdAt,
      notBefore: input.notBefore,
      expiresAt: input.expiresAt,
      revokedAt: input.revokedAt,
    }),
  );
}

export function createServiceIdentityRecord(
  input: ServiceIdentityRecord,
): Result<ServiceIdentityRecord> {
  const binding = createExternalReference(
    input.authenticationBinding.source,
    input.authenticationBinding.value,
  );
  if (
    !binding.ok ||
    input.environment !== input.scope.environment ||
    !isIdentityStatus(input.status) ||
    !validDisabledState(input.status, input.createdAt, input.disabledAt)
  ) {
    return invalidRecord();
  }

  return ok(
    freezeOptional<ServiceIdentityRecord>({
      serviceId: input.serviceId,
      environment: input.environment,
      scope: cloneScope(input.scope),
      authenticationBinding: binding.value,
      status: input.status,
      createdAt: input.createdAt,
      disabledAt: input.disabledAt,
    }),
  );
}

export function createSupportGrantAuthorizationRecord(
  input: SupportGrantAuthorizationRecord,
): Result<SupportGrantAuthorizationRecord> {
  const authorizationReference = getAuthorizationReference(input.authorization);
  const validatedReference = createExternalReference(
    authorizationReference.source,
    authorizationReference.value,
  );
  const uniquePermissions = [...new Set(input.permissions)];
  const duration = input.expiresAt - input.validFrom;

  if (
    !validatedReference.ok ||
    input.environment !== input.targetScope.environment ||
    input.operatorId === input.authorization.authorizedBy ||
    input.permissions.length === 0 ||
    uniquePermissions.length !== input.permissions.length ||
    !input.permissions.every(isSupportPermission) ||
    !input.permissions.every(isPermission) ||
    !isSupportReasonClass(input.reason) ||
    compareInstants(input.authorization.authorizedAt, input.validFrom) > 0 ||
    compareInstants(input.validFrom, input.expiresAt) >= 0 ||
    duration > SUPPORT_GRANT_MAX_DURATION_MILLISECONDS
  ) {
    return invalidRecord();
  }

  const authorization = freezeAuthorization(input.authorization, validatedReference.value);
  const record = Object.freeze({
    supportGrantId: input.supportGrantId,
    operatorId: input.operatorId,
    environment: input.environment,
    targetScope: cloneScope(input.targetScope),
    permissions: Object.freeze(uniquePermissions),
    reason: input.reason,
    authorization,
    validFrom: input.validFrom,
    expiresAt: input.expiresAt,
  });
  supportGrantAuthorizationRecords.add(record);
  return ok(record);
}

export function isSupportGrantAuthorizationRecord(
  value: unknown,
): value is SupportGrantAuthorizationRecord {
  return (
    typeof value === "object" &&
    value !== null &&
    supportGrantAuthorizationRecords.has(value)
  );
}

export function createSupportGrantRecord(
  input: SupportGrantRecord,
): Result<SupportGrantRecord> {
  const authorizationReference = getAuthorizationReference(input.authorization);
  const validatedReference = createExternalReference(
    authorizationReference.source,
    authorizationReference.value,
  );
  const uniquePermissions = [...new Set(input.permissions)];
  const duration = input.expiresAt - input.validFrom;

  if (
    !validatedReference.ok ||
    input.environment !== input.targetScope.environment ||
    input.operatorId === input.authorization.authorizedBy ||
    input.permissions.length === 0 ||
    uniquePermissions.length !== input.permissions.length ||
    !input.permissions.every(isSupportPermission) ||
    !input.permissions.every(isPermission) ||
    !isSupportReasonClass(input.reason) ||
    compareInstants(input.authorization.authorizedAt, input.issuedAt) > 0 ||
    compareInstants(input.issuedAt, input.validFrom) > 0 ||
    compareInstants(input.validFrom, input.expiresAt) >= 0 ||
    duration > SUPPORT_GRANT_MAX_DURATION_MILLISECONDS ||
    (input.revokedAt === undefined) !== (input.revokedBy === undefined) ||
    (input.revokedAt !== undefined && compareInstants(input.revokedAt, input.issuedAt) < 0)
  ) {
    return invalidRecord();
  }

  const authorization = freezeAuthorization(input.authorization, validatedReference.value);
  const record = freezeOptional<SupportGrantRecord>({
    supportGrantId: input.supportGrantId,
    operatorId: input.operatorId,
    environment: input.environment,
    targetScope: cloneScope(input.targetScope),
    permissions: Object.freeze(uniquePermissions),
    reason: input.reason,
    authorization,
    issuedAt: input.issuedAt,
    validFrom: input.validFrom,
    expiresAt: input.expiresAt,
    revokedAt: input.revokedAt,
    revokedBy: input.revokedBy,
  });
  supportGrantRecords.add(record);
  return ok(record);
}

export function isSupportGrantRecord(value: unknown): value is SupportGrantRecord {
  return typeof value === "object" && value !== null && supportGrantRecords.has(value);
}

export function isSupportGrantActiveAt(grant: SupportGrantRecord, at: Instant): boolean {
  return (
    compareInstants(at, grant.validFrom) >= 0 &&
    compareInstants(at, grant.expiresAt) < 0 &&
    (grant.revokedAt === undefined || compareInstants(at, grant.revokedAt) < 0)
  );
}

export function supportGrantTargets(
  grant: SupportGrantRecord,
  environment: Environment,
  scope: Scope,
): boolean {
  return grant.environment === environment && scopesEqual(grant.targetScope, scope);
}

export function isIdentityStatus(value: unknown): value is IdentityStatus {
  return typeof value === "string" && identityStatusSet.has(value);
}

export function isSupportReasonClass(value: unknown): value is SupportReasonClass {
  return typeof value === "string" && supportReasonSet.has(value);
}

export function isSupportPermission(value: unknown): value is SupportPermission {
  return typeof value === "string" && supportPermissionSet.has(value);
}

function isCanonicalEd25519PublicKey(value: string): boolean {
  if (!/^[A-Za-z0-9_-]{43}$/u.test(value)) {
    return false;
  }
  const decoded = Buffer.from(value, "base64url");
  return decoded.byteLength === 32 && Buffer.from(decoded).toString("base64url") === value;
}

function validDisabledState(
  status: IdentityStatus,
  createdAt: Instant,
  disabledAt: Instant | undefined,
): boolean {
  if (status === "active") {
    return disabledAt === undefined;
  }
  return disabledAt !== undefined && compareInstants(disabledAt, createdAt) >= 0;
}

function invalidRecord(): Result<never, CanonicalError> {
  return err(createCanonicalError("INVALID_FORMAT"));
}

function cloneActor(actor: ActorReference): ActorReference {
  return Object.freeze({ kind: actor.kind, id: actor.id }) as ActorReference;
}

function cloneScope<ScopeType extends Scope>(scope: ScopeType): ScopeType {
  switch (scope.kind) {
    case "merchant":
      return Object.freeze({
        kind: "merchant",
        environment: scope.environment,
        merchantId: scope.merchantId,
      }) as ScopeType;
    case "wallet":
      return Object.freeze({
        kind: "wallet",
        environment: scope.environment,
        walletId: scope.walletId,
      }) as ScopeType;
    case "platform":
      return Object.freeze({
        kind: "platform",
        environment: scope.environment,
      }) as ScopeType;
  }
}

function getAuthorizationReference(authorization: SupportGrantAuthorization): ExternalReference {
  return authorization.kind === "approved"
    ? authorization.approvalReference
    : authorization.incidentReference;
}

function freezeAuthorization(
  authorization: SupportGrantAuthorization,
  reference: ExternalReference,
): SupportGrantAuthorization {
  return authorization.kind === "approved"
    ? Object.freeze({
        kind: "approved",
        authorizedBy: authorization.authorizedBy,
        authorizedAt: authorization.authorizedAt,
        approvalReference: reference,
      })
    : Object.freeze({
        kind: "incident",
        authorizedBy: authorization.authorizedBy,
        authorizedAt: authorization.authorizedAt,
        incidentReference: reference,
      });
}

function freezeOptional<Output extends object>(value: object): Output {
  return Object.freeze(
    Object.fromEntries(Object.entries(value).filter(([, entry]) => entry !== undefined)),
  ) as Output;
}

export type MerchantScopeIdentity = Readonly<{
  environment: Environment;
  merchantId: MerchantId;
}>;

export type WalletScopeIdentity = Readonly<{
  environment: Environment;
  walletId: WalletId;
}>;
