-- Phase 2 of the remote-MCP plan: notifications backbone.
--
-- Two additive tables sharing one write path (the durable outbox ->
-- dispatcher fan-out, wired in apps/worker/src/outbox-dispatcher.ts):
--   1. merchant.webhook_endpoints — a merchant's own registered callback URL
--      + signing secret, so real order/fulfillment events can be pushed to
--      their systems. Mirrors merchant.shopify_connections' exact shape
--      (migration 0013): PK on (environment, merchant_id) — one endpoint per
--      merchant, upsert-on-connect — same "no app-level encryption for the
--      stored secret" convention already established for that table's
--      access_token column (see that migration's header for the full
--      rationale; this repeats, not invents, that trade-off).
--   2. runtime.buyer_notifications — the wallet-queryable read model the new
--      notifications.list/invoices.get MCP tools serve from. Populated from
--      the SAME outbox event stream as the merchant webhook dispatch (one
--      write path, two consumers). runtime.receipts itself is NOT
--      wallet-indexed and stays untouched — this is a new, separate
--      projection, not a change to receipts.
--
-- RLS enabled+forced with no policies on both, matching every other
-- direct-SQL-written table in this repo (see migration 0013's header for
-- the full rationale): written exclusively via parameterized SQL from a
-- role that bypasses RLS; no policies means any future non-bypassing role
-- is denied by default until real RBAC policies are added.

CREATE TABLE merchant.webhook_endpoints (
  environment platform.counter_environment NOT NULL,
  merchant_id text NOT NULL,
  url text NOT NULL,
  signing_secret text NOT NULL,
  status text NOT NULL DEFAULT 'active',
  created_at timestamptz NOT NULL,
  updated_at timestamptz NOT NULL DEFAULT clock_timestamp(),
  PRIMARY KEY (environment, merchant_id),
  CONSTRAINT webhook_endpoints_status CHECK (status IN ('active', 'revoked')),
  CONSTRAINT webhook_endpoints_url_format CHECK (url ~ '^https://'),
  CONSTRAINT webhook_endpoints_secret_not_empty CHECK (char_length(signing_secret) > 0),
  CONSTRAINT webhook_endpoints_merchant_id_profile
    CHECK (identity.is_counter_id(merchant_id, 'merchant')),
  CONSTRAINT webhook_endpoints_merchant_fk
    FOREIGN KEY (environment, merchant_id)
    REFERENCES merchant.scopes (environment, merchant_id)
);

CREATE TABLE runtime.buyer_notifications (
  id text PRIMARY KEY,
  environment platform.counter_environment NOT NULL,
  wallet_id text NOT NULL,
  notification_type text NOT NULL,
  transaction_id text,
  payload jsonb NOT NULL,
  created_at timestamptz NOT NULL DEFAULT clock_timestamp(),
  CONSTRAINT buyer_notifications_type_not_empty CHECK (char_length(notification_type) > 0),
  CONSTRAINT buyer_notifications_wallet_id_profile
    CHECK (identity.is_counter_id(wallet_id, 'wallet'))
);

-- Idempotent projection writes: the dispatcher's buyer-notification
-- consumer keys ON CONFLICT DO NOTHING on this, so replaying the same
-- outbox event (at-least-once delivery, by design — see
-- outbox-dispatcher.ts's header) never creates a duplicate row.
CREATE UNIQUE INDEX buyer_notifications_dedup
  ON runtime.buyer_notifications (environment, wallet_id, notification_type, transaction_id);

CREATE INDEX buyer_notifications_wallet_recent
  ON runtime.buyer_notifications (environment, wallet_id, created_at DESC);

ALTER TABLE merchant.webhook_endpoints ENABLE ROW LEVEL SECURITY;
ALTER TABLE merchant.webhook_endpoints FORCE ROW LEVEL SECURITY;
ALTER TABLE runtime.buyer_notifications ENABLE ROW LEVEL SECURITY;
ALTER TABLE runtime.buyer_notifications FORCE ROW LEVEL SECURITY;
