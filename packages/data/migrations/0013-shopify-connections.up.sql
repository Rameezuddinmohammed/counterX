-- Self-serve Shopify OAuth: durable storage for a merchant's own Shopify
-- Admin API access token (obtained via the real authorization-code grant,
-- not an operator-supplied env var), plus the short-lived, single-use,
-- hashed OAuth state nonce that ties a callback back to the authorize
-- request that started it (CSRF protection, per Shopify's documented OAuth
-- security requirements).
--
-- SECURITY: shopify_connections.access_token is a real, live credential
-- capable of acting on the merchant's store — NOT a payment credential
-- (PAN/CVV/UPI PIN/private signing key), so CLAUDE.md's "no raw payment
-- credentials" invariant does not literally cover it, but it is sensitive
-- and is handled with the same care. This repo has no precedent anywhere
-- for application-level encryption of a stored secret (grep
-- packages/data/migrations/*.sql: every sensitive column — spend amounts,
-- Razorpay's own opaque provider_customer_id/provider_token_id references —
-- relies solely on the "direct-SQL trust boundary, RLS enabled+forced with
-- NO policies" convention, never pgcrypto or app-level encryption). This
-- table follows that SAME convention rather than inventing a new one.
-- KNOWN LIMITATION, not solved here: encryption-at-rest for this column
-- would be a real hardening step or a real follow-up, tracked, not silently
-- skipped.
--
-- RLS is enabled and forced for structural consistency with the rest of
-- merchant.*, but no policies are defined here: these tables are written
-- exclusively via direct parameterized SQL from a role that bypasses RLS
-- (the same trust boundary already used by identity.wallet_users — see
-- apps/control-plane-api/src/wallet-user-store.ts's header — and now by
-- apps/control-plane-api/src/shopify-connection-store.ts). No policies
-- means any future non-bypassing role is denied by default until real RBAC
-- policies are added.

CREATE TABLE merchant.shopify_oauth_states (
  environment platform.counter_environment NOT NULL,
  state_hash text NOT NULL,
  merchant_id text NOT NULL,
  shop_domain text NOT NULL,
  created_at timestamptz NOT NULL,
  expires_at timestamptz NOT NULL,
  used_at timestamptz,
  PRIMARY KEY (environment, state_hash),
  CONSTRAINT shopify_oauth_states_hash_format CHECK (state_hash ~ '^[0-9a-f]{64}$'),
  CONSTRAINT shopify_oauth_states_merchant_id_profile
    CHECK (identity.is_counter_id(merchant_id, 'merchant')),
  CONSTRAINT shopify_oauth_states_shop_domain_format
    CHECK (shop_domain ~ '^[a-zA-Z0-9][a-zA-Z0-9\-]*\.myshopify\.com$'),
  CONSTRAINT shopify_oauth_states_validity CHECK (
    expires_at > created_at
    AND (used_at IS NULL OR used_at >= created_at)
  ),
  CONSTRAINT shopify_oauth_states_merchant_fk
    FOREIGN KEY (environment, merchant_id)
    REFERENCES merchant.scopes (environment, merchant_id)
);

CREATE INDEX shopify_oauth_states_expiry
  ON merchant.shopify_oauth_states (environment, expires_at);

CREATE TABLE merchant.shopify_connections (
  environment platform.counter_environment NOT NULL,
  merchant_id text NOT NULL,
  shop_domain text NOT NULL,
  access_token text NOT NULL,
  granted_scope text NOT NULL,
  status text NOT NULL DEFAULT 'active',
  connected_at timestamptz NOT NULL,
  updated_at timestamptz NOT NULL DEFAULT clock_timestamp(),
  PRIMARY KEY (environment, merchant_id),
  CONSTRAINT shopify_connections_status CHECK (status IN ('active', 'revoked')),
  CONSTRAINT shopify_connections_access_token_not_empty CHECK (char_length(access_token) > 0),
  CONSTRAINT shopify_connections_merchant_id_profile
    CHECK (identity.is_counter_id(merchant_id, 'merchant')),
  CONSTRAINT shopify_connections_shop_domain_format
    CHECK (shop_domain ~ '^[a-zA-Z0-9][a-zA-Z0-9\-]*\.myshopify\.com$'),
  CONSTRAINT shopify_connections_merchant_fk
    FOREIGN KEY (environment, merchant_id)
    REFERENCES merchant.scopes (environment, merchant_id)
);

-- One Shopify store may be connected to at most one merchant at a time —
-- prevents silently pointing two Counter merchants at the same live store.
-- Partial index: a revoked connection's shop_domain is exempt, so
-- reconnecting the SAME merchant to the SAME store, or moving a store to a
-- different merchant after a deliberate revoke, both remain possible.
CREATE UNIQUE INDEX shopify_connections_shop_domain_active
  ON merchant.shopify_connections (environment, shop_domain)
  WHERE status = 'active';

ALTER TABLE merchant.shopify_oauth_states ENABLE ROW LEVEL SECURITY;
ALTER TABLE merchant.shopify_oauth_states FORCE ROW LEVEL SECURITY;
ALTER TABLE merchant.shopify_connections ENABLE ROW LEVEL SECURITY;
ALTER TABLE merchant.shopify_connections FORCE ROW LEVEL SECURITY;
