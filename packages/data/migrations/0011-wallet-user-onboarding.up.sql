-- Self-serve wallet onboarding: maps a real login (Auth0's stable subject) to
-- a wallet so repeat logins never mint a second wallet, and a short-lived,
-- single-use, hashed setup token that lets a local script (which has no
-- browser session) prove it belongs to the person who just logged in.
--
-- RLS is enabled and forced for structural consistency with the rest of
-- identity.*, but no policies are defined here: these tables are written
-- exclusively via direct parameterized SQL from a role that bypasses RLS
-- (the same trust boundary already used by the migration/policy-seed scripts
-- and by PostgresQuoteStore et al. — see apps/control-plane-api/src/
-- wallet-user-store.ts's header for why the RBAC-gated repository path
-- isn't used here). No policies means any future non-bypassing role is
-- denied by default until real RBAC policies are added.

CREATE TABLE identity.wallet_users (
  environment platform.counter_environment NOT NULL,
  auth0_subject text NOT NULL,
  wallet_id text NOT NULL,
  actor_kind text NOT NULL DEFAULT 'wallet_user',
  wallet_user_actor_id text NOT NULL,
  created_at timestamptz NOT NULL,
  PRIMARY KEY (environment, auth0_subject),
  UNIQUE (environment, wallet_id),
  CONSTRAINT wallet_users_subject_not_empty CHECK (char_length(auth0_subject) > 0),
  CONSTRAINT wallet_users_actor_kind CHECK (actor_kind = 'wallet_user'),
  CONSTRAINT wallet_users_wallet_id_profile CHECK (identity.is_counter_id(wallet_id, 'wallet')),
  CONSTRAINT wallet_users_actor_id_profile CHECK (identity.is_counter_id(wallet_user_actor_id, 'wallet-user')),
  CONSTRAINT wallet_users_wallet_fk
    FOREIGN KEY (environment, wallet_id)
    REFERENCES wallet.scopes (environment, wallet_id),
  CONSTRAINT wallet_users_actor_fk
    FOREIGN KEY (environment, actor_kind, wallet_user_actor_id)
    REFERENCES identity.actors (environment, actor_kind, actor_id)
);

CREATE TABLE identity.wallet_setup_tokens (
  environment platform.counter_environment NOT NULL,
  token_hash text NOT NULL,
  wallet_id text NOT NULL,
  created_at timestamptz NOT NULL,
  expires_at timestamptz NOT NULL,
  used_at timestamptz,
  PRIMARY KEY (environment, token_hash),
  CONSTRAINT wallet_setup_tokens_hash_format CHECK (token_hash ~ '^[0-9a-f]{64}$'),
  CONSTRAINT wallet_setup_tokens_wallet_id_profile CHECK (identity.is_counter_id(wallet_id, 'wallet')),
  CONSTRAINT wallet_setup_tokens_validity CHECK (
    expires_at > created_at
    AND (used_at IS NULL OR used_at >= created_at)
  ),
  CONSTRAINT wallet_setup_tokens_wallet_fk
    FOREIGN KEY (environment, wallet_id)
    REFERENCES wallet.scopes (environment, wallet_id)
);

CREATE INDEX wallet_setup_tokens_expiry ON identity.wallet_setup_tokens (environment, expires_at);

ALTER TABLE identity.wallet_users ENABLE ROW LEVEL SECURITY;
ALTER TABLE identity.wallet_users FORCE ROW LEVEL SECURITY;
ALTER TABLE identity.wallet_setup_tokens ENABLE ROW LEVEL SECURITY;
ALTER TABLE identity.wallet_setup_tokens FORCE ROW LEVEL SECURITY;
