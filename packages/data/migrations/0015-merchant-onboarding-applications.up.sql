-- Self-serve merchant onboarding: an application record created the instant
-- someone clicks "Request access" (see apps/control-plane-api/src/
-- merchant-application-store.ts), mapping a real Auth0 login to a real
-- merchant scope so a repeat login never mints a second merchant. Replaces
-- the old (unwired, unused — see packages/merchant-application/src/
-- invitation.ts) invite-gated AllowlistInvitation concept for this flow.
--
-- approval_status is a lightweight, async operator-review flag — it does
-- NOT gate wizard progress; a merchant can move through lifecycle_state
-- while still 'pending'. lifecycle_state/lifecycle_version track the REAL
-- MERCHANT_LIFECYCLE_STATES state machine (packages/merchant-application/
-- src/lifecycle.ts's transitionMerchantLifecycle), so this table stays the
-- single source of truth for a merchant's onboarding progress rather than
-- the wizard's own client-side state.
--
-- RLS is enabled and forced for structural consistency with the rest of
-- merchant.*, but no policies are defined here: same direct-SQL trust
-- boundary as identity.wallet_users and merchant.shopify_connections — see
-- apps/control-plane-api/src/wallet-user-store.ts's header for the full
-- rationale. No policies means any future non-bypassing role is denied by
-- default until real RBAC policies are added.

CREATE TABLE merchant.onboarding_applications (
  environment platform.counter_environment NOT NULL,
  merchant_id text NOT NULL,
  auth0_subject text NOT NULL,
  actor_kind text NOT NULL DEFAULT 'merchant_user',
  merchant_user_actor_id text NOT NULL,
  legal_entity_name text,
  contact_email text,
  contact_phone text,
  -- Values are FulfillmentCapability strings from
  -- packages/merchant-application/src/capability-manifest.ts:
  --   fulfillment.physical.ship     — ships to an address
  --   fulfillment.digital.deliver   — instant electronic delivery, no address
  --   fulfillment.access.grant      — subscription/membership/paywall access
  --   fulfillment.booking.schedule  — appointment/time-slot
  --   fulfillment.event.ticket      — fixed-inventory, time-bound entry credential
  --   fulfillment.rental.temporary  — temporary possession + return/deposit
  --   fulfillment.quote.custom      — no fixed price, needs a human quote
  -- No per-element CHECK — matches the eligible_merchants/eligible_operations
  -- precedent in migration 0012: the application layer owns this closed
  -- vocabulary, not the database.
  goods_types text[],
  approval_status text NOT NULL DEFAULT 'pending',
  lifecycle_state text NOT NULL DEFAULT 'DRAFT',
  lifecycle_version integer NOT NULL DEFAULT 0,
  created_at timestamptz NOT NULL,
  updated_at timestamptz NOT NULL,
  PRIMARY KEY (environment, merchant_id),
  UNIQUE (environment, auth0_subject),
  CONSTRAINT onboarding_applications_subject_not_empty CHECK (char_length(auth0_subject) > 0),
  CONSTRAINT onboarding_applications_actor_kind CHECK (actor_kind = 'merchant_user'),
  CONSTRAINT onboarding_applications_merchant_id_profile
    CHECK (identity.is_counter_id(merchant_id, 'merchant')),
  CONSTRAINT onboarding_applications_actor_id_profile
    CHECK (identity.is_counter_id(merchant_user_actor_id, 'merchant-user')),
  CONSTRAINT onboarding_applications_approval_status CHECK (
    approval_status IN ('pending', 'approved', 'rejected')
  ),
  CONSTRAINT onboarding_applications_lifecycle_state CHECK (
    lifecycle_state IN (
      'DRAFT', 'CONNECTING', 'MAPPING', 'VERIFYING', 'SANDBOX_READY',
      'ACTIVATION_REVIEW', 'ACTIVE', 'ACTIVE_DEGRADED', 'SUSPENDED',
      'OFFBOARDING', 'CLOSED'
    )
  ),
  CONSTRAINT onboarding_applications_lifecycle_version CHECK (lifecycle_version >= 0),
  CONSTRAINT onboarding_applications_validity CHECK (updated_at >= created_at),
  CONSTRAINT onboarding_applications_merchant_fk
    FOREIGN KEY (environment, merchant_id)
    REFERENCES merchant.scopes (environment, merchant_id),
  CONSTRAINT onboarding_applications_actor_fk
    FOREIGN KEY (environment, actor_kind, merchant_user_actor_id)
    REFERENCES identity.actors (environment, actor_kind, actor_id)
);

-- Minimal non-Shopify catalog entry, Step 2's manual path. No mapping/review
-- logic yet — that belongs to a later pass (Step 3, catalog review).
CREATE TABLE merchant.manual_catalog_items (
  environment platform.counter_environment NOT NULL,
  item_id bigint GENERATED ALWAYS AS IDENTITY,
  merchant_id text NOT NULL,
  name text NOT NULL,
  description text,
  price_minor bigint NOT NULL,
  currency text NOT NULL DEFAULT 'INR',
  created_at timestamptz NOT NULL,
  PRIMARY KEY (environment, item_id),
  CONSTRAINT manual_catalog_items_merchant_id_profile
    CHECK (identity.is_counter_id(merchant_id, 'merchant')),
  CONSTRAINT manual_catalog_items_name_not_empty CHECK (char_length(name) > 0),
  CONSTRAINT manual_catalog_items_price_minor CHECK (price_minor >= 0),
  CONSTRAINT manual_catalog_items_currency CHECK (currency = 'INR'),
  CONSTRAINT manual_catalog_items_merchant_fk
    FOREIGN KEY (environment, merchant_id)
    REFERENCES merchant.scopes (environment, merchant_id)
);

CREATE INDEX manual_catalog_items_merchant
  ON merchant.manual_catalog_items (environment, merchant_id);

ALTER TABLE merchant.onboarding_applications ENABLE ROW LEVEL SECURITY;
ALTER TABLE merchant.onboarding_applications FORCE ROW LEVEL SECURITY;
ALTER TABLE merchant.manual_catalog_items ENABLE ROW LEVEL SECURITY;
ALTER TABLE merchant.manual_catalog_items FORCE ROW LEVEL SECURITY;
