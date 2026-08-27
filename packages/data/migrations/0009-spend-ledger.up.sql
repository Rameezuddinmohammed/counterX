-- Durable, cross-instance rolling-spend ledger.
--
-- The production authorization policy enforces a rolling 24-hour spend total
-- and attempt-count ceiling per wallet (PILOT.md Profile 0.1). Before this
-- table those checks used a per-PROCESS in-memory ledger, so two worker
-- instances running concurrently did not share the running total: each could
-- independently pass its own check and together exceed the rolling cap.
--
-- The check-and-reserve is performed inside a single database transaction with
-- row locking (see PostgresTransactionLedger), so two concurrent reservations
-- that each fit alone but together exceed the cap cannot both succeed — the
-- guarantee is enforced by Postgres, not by application control flow.
--
-- Idempotency: the reference is UNIQUE per (environment, wallet_id), so a retry
-- of the same transaction reference cannot double-count against the window.
--
-- SECURITY: stores only scope ids, an integer minor-unit amount, a currency
-- code, and a timestamp. No raw payment credentials or secrets are written.
CREATE TABLE runtime.spend_ledger (
  id bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  environment platform.counter_environment NOT NULL,
  wallet_id text NOT NULL,
  reference text NOT NULL,
  amount_minor bigint NOT NULL,
  currency text NOT NULL,
  spent_at timestamptz NOT NULL DEFAULT clock_timestamp(),
  CONSTRAINT spend_ledger_amount_positive CHECK (amount_minor > 0),
  CONSTRAINT spend_ledger_wallet_not_empty CHECK (char_length(wallet_id) > 0),
  CONSTRAINT spend_ledger_reference_not_empty CHECK (char_length(reference) > 0),
  CONSTRAINT spend_ledger_currency_len CHECK (char_length(currency) = 3)
);

CREATE UNIQUE INDEX spend_ledger_idempotent_reference
  ON runtime.spend_ledger (environment, wallet_id, reference);

CREATE INDEX spend_ledger_window
  ON runtime.spend_ledger (environment, wallet_id, spent_at);
