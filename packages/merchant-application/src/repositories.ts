/**
 * Persistence port interfaces for the merchant-application package.
 *
 * These are pure interfaces (ports) that define the contract for persisting
 * and retrieving merchant domain objects. Implementations are provided by
 * infrastructure packages.
 */

import type { CounterId, Instant, Result } from "@counter/domain";
import type { MerchantOrganization, OrganizationId } from "./tenancy.js";
import type { MerchantLifecycleState, MerchantLifecycleTransition } from "./lifecycle.js";
import type { AllowlistInvitation } from "./invitation.js";
import type { ActivationSnapshot } from "./activation.js";

// ─── Merchant Organization Repository ───────────────────────────────────────

export interface MerchantOrganizationRepository {
  readonly save: (organization: MerchantOrganization) => Promise<Result<void>>;
  readonly findById: (id: OrganizationId) => Promise<Result<MerchantOrganization | undefined>>;
  readonly findByMerchantId: (
    merchantId: CounterId<"merchant">,
  ) => Promise<Result<MerchantOrganization | undefined>>;
}

// ─── Merchant Lifecycle Repository ──────────────────────────────────────────

export interface MerchantLifecycleRepository {
  readonly getCurrentState: (
    merchantId: CounterId<"merchant">,
  ) => Promise<Result<MerchantLifecycleState | undefined>>;
  readonly saveTransition: (transition: MerchantLifecycleTransition) => Promise<Result<void>>;
  readonly getTransitionHistory: (
    merchantId: CounterId<"merchant">,
  ) => Promise<Result<readonly MerchantLifecycleTransition[]>>;
}

// ─── Invitation Repository ──────────────────────────────────────────────────

export interface InvitationRepository {
  readonly save: (invitation: AllowlistInvitation) => Promise<Result<void>>;
  readonly findByCode: (invitationId: string) => Promise<Result<AllowlistInvitation | undefined>>;
  readonly findByEmail: (email: string) => Promise<Result<readonly AllowlistInvitation[]>>;
  readonly findPending: (now: Instant) => Promise<Result<readonly AllowlistInvitation[]>>;
}

// ─── Activation Snapshot Repository ─────────────────────────────────────────

export interface ActivationSnapshotRepository {
  readonly save: (snapshot: ActivationSnapshot) => Promise<Result<void>>;
  readonly findByMerchant: (
    merchantId: CounterId<"merchant">,
  ) => Promise<Result<ActivationSnapshot | undefined>>;
}
