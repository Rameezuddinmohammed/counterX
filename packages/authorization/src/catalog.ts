import type { ActorKind } from "@counter/domain";

export const PERMISSIONS = [
  "identity.scope.read",
  "identity.scope.manage",
  "identity.actor.read",
  "identity.actor.manage",
  "identity.role.read",
  "identity.role.assign",
  "identity.agent_key.read",
  "identity.agent_key.manage",
  "identity.service_identity.read",
  "identity.service_identity.manage",
  "identity.support_grant.read",
  "identity.support_grant.issue",
  "identity.support_grant.revoke",
  "identity.support_grant.use",
  "payment.mandate.read",
  "payment.mandate.manage",
] as const;

export type Permission = (typeof PERMISSIONS)[number];

export const ROLE_KEYS = [
  "merchant.owner",
  "merchant.admin",
  "merchant.integration",
  "merchant.operations",
  "merchant.auditor",
  "merchant.read_only",
  "wallet.owner",
  "platform.operator",
  "service.identity",
  "service.onboarding",
] as const;

export type RoleKey = (typeof ROLE_KEYS)[number];
export type ScopeKind = "merchant" | "wallet" | "platform";

export interface RoleDefinition {
  readonly actorKinds: readonly ActorKind[];
  readonly scopeKinds: readonly ScopeKind[];
  readonly permissions: readonly Permission[];
}

const tenantReadPermissions = [
  "identity.scope.read",
  "identity.actor.read",
  "identity.role.read",
  "identity.agent_key.read",
  "identity.service_identity.read",
] as const satisfies readonly Permission[];

const tenantManagePermissions = [
  ...tenantReadPermissions,
  "identity.scope.manage",
  "identity.actor.manage",
  "identity.role.assign",
  "identity.agent_key.manage",
  "identity.service_identity.manage",
] as const satisfies readonly Permission[];

export const ROLE_DEFINITIONS: Readonly<Record<RoleKey, RoleDefinition>> = Object.freeze({
  "merchant.owner": definition(["merchant_user"], ["merchant"], tenantManagePermissions),
  "merchant.admin": definition(["merchant_user"], ["merchant"], tenantManagePermissions),
  "merchant.integration": definition(
    ["merchant_user"],
    ["merchant"],
    [
      "identity.scope.read",
      "identity.actor.read",
      "identity.agent_key.read",
      "identity.agent_key.manage",
      "identity.service_identity.read",
      "identity.service_identity.manage",
    ],
  ),
  "merchant.operations": definition(["merchant_user"], ["merchant"], tenantReadPermissions),
  "merchant.auditor": definition(["merchant_user"], ["merchant"], tenantReadPermissions),
  "merchant.read_only": definition(["merchant_user"], ["merchant"], tenantReadPermissions),
  "wallet.owner": definition(
    ["wallet_user"],
    ["wallet"],
    [...tenantManagePermissions, "payment.mandate.read", "payment.mandate.manage"],
  ),
  "platform.operator": definition(
    ["operator"],
    ["platform"],
    [
      ...tenantReadPermissions,
      "identity.scope.manage",
      "identity.support_grant.read",
      "identity.support_grant.issue",
      "identity.support_grant.revoke",
      "identity.support_grant.use",
    ],
  ),
  "service.identity": definition(
    ["service"],
    ["merchant", "wallet", "platform"],
    tenantReadPermissions,
  ),
  /**
   * The ONE deliberate exception to "machine credentials are read-only":
   * a service actor allowed to create wallet-user identity records, and
   * nothing else. Exists for the login-triggered self-serve provisioning
   * flow (apps/control-plane-api/src/wallet-user-routes.ts), where a
   * Post-Login Action — not a human operator — must create a wallet the
   * instant someone logs in. Scoped to platform only, and to exactly the
   * one permission that route needs.
   */
  "service.onboarding": definition(["service"], ["platform"], ["identity.scope.manage"]),
});

const permissionSet: ReadonlySet<string> = new Set(PERMISSIONS);
const roleSet: ReadonlySet<string> = new Set(ROLE_KEYS);
const permissionOrder = new Map(PERMISSIONS.map((permission, index) => [permission, index]));
const roleOrder = new Map(ROLE_KEYS.map((role, index) => [role, index]));

export function isPermission(value: unknown): value is Permission {
  return typeof value === "string" && permissionSet.has(value);
}

export function isRoleKey(value: unknown): value is RoleKey {
  return typeof value === "string" && roleSet.has(value);
}

export function permissionsForRoles(roles: readonly RoleKey[]): readonly Permission[] {
  const permissions = new Set<Permission>();
  for (const role of roles) {
    for (const permission of ROLE_DEFINITIONS[role].permissions) {
      permissions.add(permission);
    }
  }

  return Object.freeze(
    [...permissions].sort(
      (left, right) =>
        (permissionOrder.get(left) ?? Number.MAX_SAFE_INTEGER) -
        (permissionOrder.get(right) ?? Number.MAX_SAFE_INTEGER),
    ),
  );
}

export function normalizeRoles(roles: readonly RoleKey[]): readonly RoleKey[] {
  return Object.freeze(
    [...new Set(roles)].sort(
      (left, right) =>
        (roleOrder.get(left) ?? Number.MAX_SAFE_INTEGER) -
        (roleOrder.get(right) ?? Number.MAX_SAFE_INTEGER),
    ),
  );
}

export function actorKindCanUseScopeKind(actorKind: ActorKind, scopeKind: ScopeKind): boolean {
  switch (actorKind) {
    case "merchant_user":
      return scopeKind === "merchant";
    case "wallet_user":
    case "registered_agent":
      return scopeKind === "wallet";
    case "operator":
      return scopeKind === "platform";
    case "service":
      return true;
  }
}

export function roleSupportsActorAndScope(
  role: RoleKey,
  actorKind: ActorKind,
  scopeKind: ScopeKind,
): boolean {
  const roleDefinition = ROLE_DEFINITIONS[role];
  return (
    roleDefinition.actorKinds.includes(actorKind) && roleDefinition.scopeKinds.includes(scopeKind)
  );
}

function definition(
  actorKinds: readonly ActorKind[],
  scopeKinds: readonly ScopeKind[],
  permissions: readonly Permission[],
): RoleDefinition {
  return Object.freeze({
    actorKinds: Object.freeze([...actorKinds]),
    scopeKinds: Object.freeze([...scopeKinds]),
    permissions: Object.freeze([...permissions]),
  });
}
