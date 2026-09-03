-- Durable revocation trail + durable wallet mandates (Phase A4).
--
-- packages/wallet-application/src/revocation-service.ts's WalletRevocationService
-- is well-built (monotonic, cascades wallet->mandates, produces a signed CTP
-- counter.revocation.v1 envelope) but until now nothing durable backed it
-- anywhere -- not even apps/local-mcp's "most real" entrypoint, which
-- disclosed InMemoryRevocationStore as an explicit known limitation. This
-- migration gives apps/control-plane-api a real, durable store so a
-- recurring-mandate revocation (see recurring-mandate-store.ts's revoke())
-- produces a genuine, cross-restart revocation record, not just an in-memory
-- one that evaporates on redeploy.
--
-- wallet.revocations: one row per (environment, scope_type, scope_id) --
-- revocation is monotonic (once revoked, stays revoked; no un-revoke), so a
-- second revoke() call on the same scope is idempotent by construction (the
-- application layer checks first; the primary key + ON CONFLICT DO NOTHING
-- the store uses makes this safe under a race too, not just in the common
-- case). Deliberately polymorphic scope_id (no per-kind CounterId format
-- check) -- mirrors runtime.kill_switches (migration 0008), which stores the
-- same kind of "one column, several different id kinds depending on scope"
-- data with no format constraint either.
--
-- wallet.mandates: the durable home for WalletMandate
-- (packages/wallet-domain/src/mandate.ts) -- a CTP counter.mandate.v1 binding
-- of an agent to bounded buyer-policy constraints, issued only from a fresh
-- stepped-up consent attestation. Written server-side by
-- apps/control-plane-api/src/mandate-binding-store.ts's
-- MandateBindingService.bind(), reached via
-- POST /control/v1/wallets/:walletId/mandates: the client (apps/local-mcp,
-- holding the buyer's own key) builds+signs the counter.mandate.v1 envelope,
-- the server independently verifies the signature against the agent's
-- registered key and re-checks it's bound to an active, human-authorized
-- Razorpay recurring mandate for this wallet before persisting here. Read
-- server-side by apps/agent-runtime's checkMandateAuthority (before a
-- transaction.lifecycle job is enqueued) and by apps/worker's durable
-- revocation re-check (before the external payment effect). Also backs
-- WalletRevocationService's wallet/agent -> mandate cascade.
--
-- RLS is enabled and forced on both tables for structural consistency with
-- the rest of wallet.*, but no policies are defined: same direct-SQL trust
-- boundary as wallet.recurring_payment_mandates (migration 0012) and
-- identity.wallet_users. No policies means any future non-bypassing role is
-- denied by default until real RBAC policies are added.

CREATE TABLE wallet.revocations (
  environment platform.counter_environment NOT NULL,
  revocation_id text NOT NULL,
  scope_type text NOT NULL,
  scope_id text NOT NULL,
  effective_time timestamptz NOT NULL,
  reason_class text NOT NULL,
  reason text,
  replacement_id text,
  sequence integer NOT NULL,
  created_at timestamptz NOT NULL DEFAULT clock_timestamp(),
  principal_id text NOT NULL,
  PRIMARY KEY (environment, scope_type, scope_id),
  CONSTRAINT revocations_revocation_id_not_empty CHECK (char_length(revocation_id) > 0),
  CONSTRAINT revocations_scope_type CHECK (
    scope_type IN ('wallet', 'agent', 'key', 'mandate', 'trigger', 'payment_reference')
  ),
  CONSTRAINT revocations_scope_id_not_empty CHECK (char_length(scope_id) > 0),
  CONSTRAINT revocations_reason_class CHECK (
    reason_class IN (
      'principal_initiated', 'security_compromise', 'policy_violation',
      'system_enforcement', 'expiry'
    )
  ),
  CONSTRAINT revocations_sequence_positive CHECK (sequence > 0),
  CONSTRAINT revocations_principal_id_not_empty CHECK (char_length(principal_id) > 0)
);

CREATE INDEX revocations_scope_type_lookup
  ON wallet.revocations (environment, scope_type);

ALTER TABLE wallet.revocations ENABLE ROW LEVEL SECURITY;
ALTER TABLE wallet.revocations FORCE ROW LEVEL SECURITY;

CREATE TABLE wallet.mandates (
  environment platform.counter_environment NOT NULL,
  mandate_id text NOT NULL,
  wallet_id text NOT NULL,
  principal_id text NOT NULL,
  agent_id text NOT NULL,
  kid text NOT NULL,
  constraints jsonb NOT NULL,
  payment_reference_id text NOT NULL,
  valid_from timestamptz NOT NULL,
  valid_until timestamptz NOT NULL,
  issued_at timestamptz NOT NULL,
  consent_attestation_digest text NOT NULL,
  status text NOT NULL DEFAULT 'active',
  revocation_locator text NOT NULL,
  policy_version_id text NOT NULL,
  created_at timestamptz NOT NULL DEFAULT clock_timestamp(),
  updated_at timestamptz NOT NULL DEFAULT clock_timestamp(),
  PRIMARY KEY (environment, mandate_id),
  CONSTRAINT mandates_status CHECK (status IN ('active', 'revoked', 'expired')),
  CONSTRAINT mandates_mandate_id_profile CHECK (identity.is_counter_id(mandate_id, 'mandate')),
  CONSTRAINT mandates_wallet_id_profile CHECK (identity.is_counter_id(wallet_id, 'wallet')),
  CONSTRAINT mandates_agent_id_profile CHECK (identity.is_counter_id(agent_id, 'agent')),
  CONSTRAINT mandates_kid_not_empty CHECK (char_length(kid) > 0),
  CONSTRAINT mandates_payment_reference_id_not_empty CHECK (char_length(payment_reference_id) > 0),
  CONSTRAINT mandates_validity CHECK (valid_until > valid_from),
  CONSTRAINT mandates_consent_digest_not_empty CHECK (char_length(consent_attestation_digest) > 0),
  CONSTRAINT mandates_revocation_locator_not_empty CHECK (char_length(revocation_locator) > 0),
  CONSTRAINT mandates_policy_version_not_empty CHECK (char_length(policy_version_id) > 0),
  CONSTRAINT mandates_wallet_fk
    FOREIGN KEY (environment, wallet_id)
    REFERENCES wallet.scopes (environment, wallet_id)
);

CREATE INDEX mandates_wallet_active
  ON wallet.mandates (environment, wallet_id)
  WHERE status = 'active';

CREATE INDEX mandates_agent
  ON wallet.mandates (environment, agent_id);

ALTER TABLE wallet.mandates ENABLE ROW LEVEL SECURITY;
ALTER TABLE wallet.mandates FORCE ROW LEVEL SECURITY;
