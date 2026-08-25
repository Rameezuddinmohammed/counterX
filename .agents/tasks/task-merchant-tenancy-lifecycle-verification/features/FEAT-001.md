# FEAT-001: Merchant Tenancy, Lifecycle State Machine, Organization Model

Status: completed

## Modules Implemented
1. tenancy.ts - MerchantOrganization and MerchantTenantEnvironment types with OrganizationId branded type
2. lifecycle.ts - Full 11-state lifecycle machine with LIFECYCLE_TRANSITIONS, transitionMerchantLifecycle, isTerminalState, isMerchantSuspended
3. invitation.ts - AllowlistInvitation with createInvitation, acceptInvitation, revokeInvitation, isInvitationValid
4. activation.ts - ActivationSnapshot with createActivationSnapshot (validates digests/connectors)
5. suspension.ts - SuspensionRecord with voluntary/kill_switch/policy kinds, ReactivationRequest with requestReactivation
6. repositories.ts - Port interfaces: MerchantOrganizationRepository, MerchantLifecycleRepository, InvitationRepository, ActivationSnapshotRepository
7. index.ts - Re-exports all modules, removed old stub types

## Verification
- pnpm typecheck: PASS
- pnpm build: PASS
- pnpm test: 25/25 tests PASS
