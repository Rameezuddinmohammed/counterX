import type { ActorKind } from "@counter/domain";
import type { Permission } from "./catalog.js";

export const AUTHENTICATION_ASSURANCES = [
  "session",
  "multi_factor",
  "step_up",
  "agent_proof",
  "service_authenticated",
] as const;

export type AuthenticationAssurance = (typeof AUTHENTICATION_ASSURANCES)[number];

const assuranceSet: ReadonlySet<string> = new Set(AUTHENTICATION_ASSURANCES);
const authenticatedAssurances: readonly AuthenticationAssurance[] = Object.freeze([
  ...AUTHENTICATION_ASSURANCES,
]);
const tenantMutationAssurances: readonly AuthenticationAssurance[] = Object.freeze([
  "multi_factor",
  "step_up",
  "service_authenticated",
]);
const supportAccessAssurances: readonly AuthenticationAssurance[] = Object.freeze([
  "multi_factor",
  "step_up",
]);
const supportMutationAssurances: readonly AuthenticationAssurance[] = Object.freeze(["step_up"]);

const permissionAssurances: Readonly<Record<Permission, readonly AuthenticationAssurance[]>> =
  Object.freeze({
    "identity.scope.read": authenticatedAssurances,
    "identity.scope.manage": tenantMutationAssurances,
    "identity.actor.read": authenticatedAssurances,
    "identity.actor.manage": tenantMutationAssurances,
    "identity.role.read": authenticatedAssurances,
    "identity.role.assign": tenantMutationAssurances,
    "identity.agent_key.read": authenticatedAssurances,
    "identity.agent_key.manage": tenantMutationAssurances,
    "identity.service_identity.read": authenticatedAssurances,
    "identity.service_identity.manage": tenantMutationAssurances,
    "identity.support_grant.read": supportAccessAssurances,
    "identity.support_grant.issue": supportMutationAssurances,
    "identity.support_grant.revoke": supportMutationAssurances,
    "identity.support_grant.use": supportAccessAssurances,
    // Registering/revoking a recurring-payment mandate is a real standing
    // payment authorization (RBI's e-mandate framework itself requires an
    // Additional Factor of Authentication at registration) — held to the same
    // bar as identity.agent_key.manage, not a plain session.
    "payment.mandate.read": authenticatedAssurances,
    "payment.mandate.manage": tenantMutationAssurances,
  });

export function isAuthenticationAssurance(value: unknown): value is AuthenticationAssurance {
  return typeof value === "string" && assuranceSet.has(value);
}

export function assuranceMatchesActor(
  assurance: AuthenticationAssurance,
  actorKind: ActorKind,
): boolean {
  switch (actorKind) {
    case "merchant_user":
    case "wallet_user":
    case "operator":
      return assurance === "session" || assurance === "multi_factor" || assurance === "step_up";
    case "registered_agent":
      return assurance === "agent_proof";
    case "service":
      return assurance === "service_authenticated";
  }
}

export function assurancePermits(
  assurance: AuthenticationAssurance,
  permission: Permission,
): boolean {
  return permissionAssurances[permission].includes(assurance);
}
