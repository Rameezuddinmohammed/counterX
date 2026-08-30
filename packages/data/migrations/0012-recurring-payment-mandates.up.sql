-- Recurring payment mandates: the durable home for a wallet owner's
-- one-time, human-authenticated Razorpay recurring-payment (UPI Autopay /
-- e-mandate) authorization, so their agent can later draw repeated,
-- variable-amount charges against it without a fresh checkout each time.
--
-- This is the FIRST durable persistence for any PaymentAuthorizationReference
-- (packages/wallet-domain/src/payment-references.ts) — until now only an
-- in-memory repository existed for that type, so any reference's authority
-- evaporated on a process restart. This table is genuinely load-bearing,
-- not incremental.
--
-- SECURITY: only Razorpay's own opaque customer/token identifiers
-- (provider_customer_id, provider_token_id) are stored. Never a UPI VPA,
-- bank account number, card number, or any other raw payment instrument
-- detail — consistent with payment-references.ts's "no raw credential"
-- invariant, extended into storage.
--
-- RLS is enabled and forced for structural consistency with the rest of
-- wallet.*, but no policies are defined here: this table is written
-- exclusively via direct parameterized SQL from a role that bypasses RLS,
-- the same trust boundary already used by identity.wallet_users (see
-- apps/control-plane-api/src/wallet-user-store.ts's header) and now by
-- apps/control-plane-api/src/recurring-mandate-store.ts. No policies means
-- any future non-bypassing role is denied by default until real RBAC
-- policies are added.

CREATE TABLE wallet.recurring_payment_mandates (
  environment platform.counter_environment NOT NULL,
  reference_id text NOT NULL,
  wallet_id text NOT NULL,
  principal_id text NOT NULL,
  principal_actor_kind text NOT NULL DEFAULT 'wallet_user',
  adapter text NOT NULL DEFAULT 'razorpay_recurring',
  status text NOT NULL DEFAULT 'pending',
  provider_customer_id text NOT NULL,
  provider_token_id text,
  ceiling_minor bigint NOT NULL,
  currency text NOT NULL DEFAULT 'INR',
  valid_from timestamptz NOT NULL,
  valid_until timestamptz NOT NULL,
  eligible_merchants text[] NOT NULL DEFAULT '{}',
  eligible_operations text[] NOT NULL DEFAULT '{}',
  created_at timestamptz NOT NULL DEFAULT clock_timestamp(),
  updated_at timestamptz NOT NULL DEFAULT clock_timestamp(),
  PRIMARY KEY (environment, reference_id),
  CONSTRAINT recurring_mandates_status
    CHECK (status IN ('pending', 'active', 'revoked', 'cancelled')),
  CONSTRAINT recurring_mandates_adapter CHECK (adapter = 'razorpay_recurring'),
  CONSTRAINT recurring_mandates_principal_actor_kind CHECK (principal_actor_kind = 'wallet_user'),
  CONSTRAINT recurring_mandates_currency CHECK (currency = 'INR'),
  CONSTRAINT recurring_mandates_ceiling_positive CHECK (ceiling_minor > 0),
  CONSTRAINT recurring_mandates_validity CHECK (valid_until > valid_from),
  CONSTRAINT recurring_mandates_reference_id_profile
    CHECK (identity.is_counter_id(reference_id, 'payment-reference')),
  CONSTRAINT recurring_mandates_wallet_id_profile
    CHECK (identity.is_counter_id(wallet_id, 'wallet')),
  CONSTRAINT recurring_mandates_principal_id_profile
    CHECK (identity.is_counter_id(principal_id, 'wallet-user')),
  CONSTRAINT recurring_mandates_wallet_fk
    FOREIGN KEY (environment, wallet_id)
    REFERENCES wallet.scopes (environment, wallet_id),
  CONSTRAINT recurring_mandates_principal_fk
    FOREIGN KEY (environment, principal_actor_kind, principal_id)
    REFERENCES identity.actors (environment, actor_kind, actor_id)
);

-- One CONFIRMED Razorpay token maps to at most one Counter reference —
-- prevents silently reusing the same recurring-payment authorization across
-- two different references. Partial index: pending registrations (still
-- NULL) are exempt, since a merchant may retry a checkout attempt.
CREATE UNIQUE INDEX recurring_mandates_provider_token
  ON wallet.recurring_payment_mandates (environment, provider_token_id)
  WHERE provider_token_id IS NOT NULL;

CREATE INDEX recurring_mandates_wallet_active
  ON wallet.recurring_payment_mandates (environment, wallet_id)
  WHERE status = 'active';

ALTER TABLE wallet.recurring_payment_mandates ENABLE ROW LEVEL SECURITY;
ALTER TABLE wallet.recurring_payment_mandates FORCE ROW LEVEL SECURITY;
