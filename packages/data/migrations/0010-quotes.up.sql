-- Durable, cross-instance quote store for the agent-runtime merchant API.
--
-- POST /quotes returns only a quoteId to the caller; POST /transactions later
-- receives that quoteId alone (not the full quote content), so a subsequent
-- request routed to a different agent-runtime machine must still be able to
-- resolve it. A per-process in-memory quote cache cannot do that.
--
-- Stores the CTP-digest-signed immutable quote content produced at quote time
-- so transactionCreate can re-verify amount, expiry, and tamper-evidence
-- (digest match) before enqueuing a job, and so the receipt handler can later
-- show the original quoted line items.
--
-- SECURITY: stores only variant/price/quantity/currency and a content digest.
-- No payment credentials, PAN, CVV, UPI PIN, or private keys are ever written.
CREATE TABLE runtime.quotes (
  id text NOT NULL,
  environment platform.counter_environment NOT NULL,
  merchant_id text NOT NULL,
  variant_id text NOT NULL,
  quantity integer NOT NULL,
  unit_price_minor bigint NOT NULL,
  total_price_minor bigint NOT NULL,
  currency text NOT NULL,
  ctp_digest text NOT NULL,
  quote_content jsonb NOT NULL,
  created_at timestamptz NOT NULL DEFAULT clock_timestamp(),
  expires_at timestamptz NOT NULL,
  consumed_at timestamptz,
  PRIMARY KEY (environment, id),
  CONSTRAINT quotes_quantity_positive CHECK (quantity > 0),
  CONSTRAINT quotes_unit_price_positive CHECK (unit_price_minor > 0),
  CONSTRAINT quotes_total_price_positive CHECK (total_price_minor > 0),
  CONSTRAINT quotes_currency_len CHECK (char_length(currency) = 3),
  CONSTRAINT quotes_merchant_not_empty CHECK (char_length(merchant_id) > 0)
);

CREATE INDEX quotes_expiry ON runtime.quotes (environment, expires_at);
