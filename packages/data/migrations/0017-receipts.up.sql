-- Durable, append-only store for CTP-signed transaction receipts.
--
-- Receipts are IMMUTABLE (packages/evidence/src/receipt-store.ts's own
-- doc comment: "Corrections create a new receipt that references the
-- predecessor. No update or delete methods exist.") - there is
-- deliberately no UPDATE/DELETE path here, matching that contract at the
-- schema level, not just in application code.
--
-- Lives in `runtime`, matching runtime.outbox_events/spend_ledger/
-- idempotency_keys: backend-service-only infrastructure, scoped by
-- application code (environment + transaction_id + audience), not by
-- Postgres RLS - none of the sibling runtime.* tables use RLS either.
CREATE TABLE runtime.receipts (
  id text PRIMARY KEY,
  environment platform.counter_environment NOT NULL,
  transaction_id text NOT NULL,
  audience text NOT NULL,
  version int NOT NULL,
  canonical_commitment_digest text NOT NULL,
  receipt_envelope jsonb NOT NULL,
  predecessor_receipt_id text REFERENCES runtime.receipts (id),
  issued_at timestamptz NOT NULL,
  signing_key_id text NOT NULL,
  created_at timestamptz NOT NULL DEFAULT clock_timestamp(),
  CONSTRAINT receipts_id_format CHECK (identity.is_counter_id(id, 'receipt')),
  CONSTRAINT receipts_transaction_id_format
    CHECK (identity.is_counter_id(transaction_id, 'transaction')),
  CONSTRAINT receipts_predecessor_id_format
    CHECK (predecessor_receipt_id IS NULL OR identity.is_counter_id(predecessor_receipt_id, 'receipt')),
  CONSTRAINT receipts_audience CHECK (audience IN ('merchant', 'wallet')),
  CONSTRAINT receipts_version_positive CHECK (version > 0),
  CONSTRAINT receipts_digest_format
    CHECK (canonical_commitment_digest ~ '^sha256:[0-9a-f]{64}$'),
  CONSTRAINT receipts_signing_key_id_not_empty CHECK (char_length(signing_key_id) > 0)
);

-- One receipt per (transaction, audience, version) - matches
-- getLatestByTransactionAndAudience's "highest version wins" contract and
-- issueReceipt's own version-increment-from-predecessor logic.
CREATE UNIQUE INDEX receipts_transaction_audience_version
  ON runtime.receipts (environment, transaction_id, audience, version);

-- Supports getByTransaction/getByTransactionAndAudience without a version
-- filter (every receipt for a transaction, either audience).
CREATE INDEX receipts_transaction_lookup
  ON runtime.receipts (environment, transaction_id);
