import type {
  ActorReference,
  AgentId,
  Instant,
  KeyId,
  MerchantId,
  OperatorId,
  ServiceId,
  SupportGrantId,
  WalletId,
} from "@counter/domain";
import type { AuthorizedContext } from "./authorize.js";
import type {
  ActorRecord,
  AgentPublicKeyRecord,
  MerchantScopeRecord,
  RoleAssignmentInput,
  RoleAssignmentRecord,
  ServiceIdentityRecord,
  SupportGrantAuthorizationInput,
  SupportGrantRecord,
  WalletScopeRecord,
} from "./records.js";

export interface TenantScopeRepository {
  findMerchantScope(
    context: AuthorizedContext<"identity.scope.read">,
    merchantId: MerchantId,
  ): Promise<MerchantScopeRecord | undefined>;
  findWalletScope(
    context: AuthorizedContext<"identity.scope.read">,
    walletId: WalletId,
  ): Promise<WalletScopeRecord | undefined>;
  createMerchantScope(
    context: AuthorizedContext<"identity.scope.manage">,
    record: MerchantScopeRecord,
  ): Promise<void>;
  createWalletScope(
    context: AuthorizedContext<"identity.scope.manage">,
    record: WalletScopeRecord,
  ): Promise<void>;
}

export interface ActorRepository {
  findActorByReference(
    context: AuthorizedContext<"identity.actor.read">,
    actor: ActorReference,
  ): Promise<ActorRecord | undefined>;
  createActor(
    context: AuthorizedContext<"identity.actor.manage">,
    record: ActorRecord,
  ): Promise<void>;
  disableActor(
    context: AuthorizedContext<"identity.actor.manage">,
    actor: ActorReference,
    disabledAt: Instant,
  ): Promise<boolean>;
}

export interface RoleAssignmentRepository {
  listRolesForActor(
    context: AuthorizedContext<"identity.role.read">,
    actor: ActorReference,
  ): Promise<readonly RoleAssignmentRecord[]>;
  assignRoles(
    context: AuthorizedContext<"identity.role.assign">,
    assignment: RoleAssignmentInput,
  ): Promise<void>;
  revokeRoles(
    context: AuthorizedContext<"identity.role.assign">,
    actor: ActorReference,
    revokedAt: Instant,
  ): Promise<boolean>;
}

export interface AgentPublicKeyRepository {
  findAgentKeyById(
    context: AuthorizedContext<"identity.agent_key.read">,
    keyId: KeyId,
  ): Promise<AgentPublicKeyRecord | undefined>;
  listAgentKeys(
    context: AuthorizedContext<"identity.agent_key.read">,
    agentId: AgentId,
  ): Promise<readonly AgentPublicKeyRecord[]>;
  createAgentKey(
    context: AuthorizedContext<"identity.agent_key.manage">,
    record: AgentPublicKeyRecord,
  ): Promise<void>;
  revokeAgentKey(
    context: AuthorizedContext<"identity.agent_key.manage">,
    keyId: KeyId,
    revokedAt: Instant,
  ): Promise<boolean>;
}

export interface ServiceIdentityRepository {
  findServiceById(
    context: AuthorizedContext<"identity.service_identity.read">,
    serviceId: ServiceId,
  ): Promise<ServiceIdentityRecord | undefined>;
  createService(
    context: AuthorizedContext<"identity.service_identity.manage">,
    record: ServiceIdentityRecord,
  ): Promise<void>;
  disableService(
    context: AuthorizedContext<"identity.service_identity.manage">,
    serviceId: ServiceId,
    disabledAt: Instant,
  ): Promise<boolean>;
}

export interface SupportGrantRepository {
  findSupportGrantById(
    context: AuthorizedContext<"identity.support_grant.read">,
    supportGrantId: SupportGrantId,
  ): Promise<SupportGrantRecord | undefined>;
  listSupportGrantsForOperator(
    context: AuthorizedContext<"identity.support_grant.read">,
    operatorId: OperatorId,
  ): Promise<readonly SupportGrantRecord[]>;
  authorizeSupportGrant(
    context: AuthorizedContext<"identity.support_grant.issue">,
    authorization: SupportGrantAuthorizationInput,
  ): Promise<void>;
  issueSupportGrant(
    context: AuthorizedContext<"identity.support_grant.issue">,
    record: SupportGrantRecord,
  ): Promise<void>;
  revokeSupportGrant(
    context: AuthorizedContext<"identity.support_grant.revoke">,
    supportGrantId: SupportGrantId,
    revokedAt: Instant,
  ): Promise<boolean>;
}
