-- Hackathon-scoped merchant onboarding: "where do I receive crypto payments."
-- A merchant records ONE Solana devnet address to receive crypto payments at.
--
-- SECURITY, address vs. key_secret: unlike merchant.payment_connections'
-- key_secret column (a real, live Razorpay credential — see migration 0016's
-- header for that disclosure), the `address` column here is a Solana
-- RECEIVING address only — a public value, safe to store in this simple
-- form, never a private key. Nothing in this table, this migration, or the
-- store/routes built on top of it ever accepts or stores a private key,
-- seed phrase, or signing credential.
--
-- DISCLOSED LIMITATION, deliberate: this pass does NOT perform any live
-- on-chain verification that the address exists, is funded, or is owned by
-- the merchant who entered it — there is no Solana connector package in
-- this repo yet to verify against (confirmed by reading the repo; this task
-- was explicitly scoped to not build one). apps/control-plane-api/src/
-- merchant-wallet-connection-store.ts only checks that the address is
-- *well-formed* base58 Solana address shape (decodes to exactly 32 bytes)
-- — "verified vs. merely accepted," same honesty this repo insists on
-- elsewhere. This is intentionally minimal, built for a hackathon demo, and
-- real on-chain verification is tracked follow-up work once a Solana
-- connector exists.
--
-- `chain` is hardcoded to 'solana-devnet' via CHECK for now — a single
-- supported chain, expanded later if/when more chains are supported.
--
-- RLS is enabled and forced for structural consistency with the rest of
-- merchant.*, but no policies are defined: same direct-SQL trust boundary
-- as merchant.payment_connections (migration 0016) and
-- merchant.shopify_connections (migration 0013). No policies means any
-- future non-bypassing role is denied by default until real RBAC policies
-- are added.

CREATE TABLE merchant.wallet_connections (
  environment platform.counter_environment NOT NULL,
  merchant_id text NOT NULL,
  chain text NOT NULL,
  address text NOT NULL,
  created_at timestamptz NOT NULL,
  updated_at timestamptz NOT NULL,
  PRIMARY KEY (environment, merchant_id),
  CONSTRAINT wallet_connections_chain CHECK (chain = 'solana-devnet'),
  CONSTRAINT wallet_connections_address_not_empty CHECK (char_length(address) > 0),
  CONSTRAINT wallet_connections_merchant_id_profile
    CHECK (identity.is_counter_id(merchant_id, 'merchant')),
  CONSTRAINT wallet_connections_validity CHECK (updated_at >= created_at),
  CONSTRAINT wallet_connections_merchant_fk
    FOREIGN KEY (environment, merchant_id)
    REFERENCES merchant.scopes (environment, merchant_id)
);

ALTER TABLE merchant.wallet_connections ENABLE ROW LEVEL SECURITY;
ALTER TABLE merchant.wallet_connections FORCE ROW LEVEL SECURITY;
