-- Durable per-step lifecycle ledger.
--
-- The worker's real transaction lifecycle drives a sequence of external
-- Shopify effects (draft -> finalize -> mark-paid) keyed on a single stable
-- idempotencyKey (the opaque per-transaction reference). Before this table the
-- only cross-restart dedup for the Shopify legs was in-memory, so a crash
-- between draft and finalize could re-drive the draft against a fresh in-memory
-- store and create a DUPLICATE Shopify order after restart.
--
-- This table records the OUTCOME of each individual external-effect step keyed
-- on (environment, idempotency_key, step) so a retry after a crash RESUMES from
-- the last completed step instead of re-driving it. It complements
-- runtime.idempotency_keys (which is keyed on a single (key, digest, operation)
-- tuple); a per-step ledger is cleaner because one transaction has several
-- distinct external effects that must each dedup independently.
--
-- SECURITY: only provider references (order ids) and the terminal step outcome
-- are stored. No raw payment credentials, PAN, CVV, UPI PIN, access tokens, or
-- key secrets are ever written here.
CREATE TABLE runtime.lifecycle_steps (
  id bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  environment platform.counter_environment NOT NULL,
  idempotency_key text NOT NULL,
  step text NOT NULL,
  status text NOT NULL,
  reference text,
  snapshot jsonb,
  created_at timestamptz NOT NULL DEFAULT clock_timestamp(),
  completed_at timestamptz,
  CONSTRAINT lifecycle_steps_status CHECK (status IN ('completed', 'declined')),
  CONSTRAINT lifecycle_steps_step_not_empty CHECK (char_length(step) > 0),
  CONSTRAINT lifecycle_steps_key_not_empty CHECK (char_length(idempotency_key) > 0)
);

-- One durable outcome per (environment, idempotency_key, step). The unique
-- index lets a concurrent racing retry lose the INSERT (ON CONFLICT) and read
-- the winner's recorded outcome rather than re-driving the external effect.
CREATE UNIQUE INDEX lifecycle_steps_natural_key
  ON runtime.lifecycle_steps (environment, idempotency_key, step);
