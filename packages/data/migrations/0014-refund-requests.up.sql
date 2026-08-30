-- Refund requests: CounterX RELAYS a refund request instead of executing it
-- immediately. The merchant (a human, or their own configured auto-approve
-- threshold) decides whether the refund actually happens.
--
-- WHY A RELAY, NOT AN IMMEDIATE ACTION: for a merchant using CounterX's own
-- Razorpay integration, CounterX technically COULD call the refund API
-- directly (as the superseded immediate path used to). But for a merchant on
-- their own separate payment gateway (parallel work, not yet built),
-- CounterX has no ability to reverse a charge it never processed — relay is
-- the ONLY option there. Rather than run two different refund workflows
-- (relay for some merchants, immediate for others), this table is the ONE
-- workflow for every merchant: request captured here, decided by the
-- merchant, executed only on approval. See apps/agent-runtime/src/
-- real-handlers.ts's createRefundHandler (now relay-only) and
-- apps/control-plane-api/src/refund-request-routes.ts (the merchant-facing
-- approve/deny surface that performs the actual Razorpay call on approval).
--
-- transaction_id is the SAME raw, opaque per-transaction reference string
-- used throughout runtime.* (see runtime.lifecycle_steps.idempotency_key and
-- apps/worker/src/transaction-lifecycle.ts's idempotencyKey doc comment) —
-- deliberately NOT a foreign key, matching that table's existing convention:
-- there is no single durable "transactions" row to reference against, only
-- this stable opaque string that workflow_intents/lifecycle_steps/spend_ledger
-- all key on independently.
--
-- SECURITY: only the requested amount/currency/reason and (once executed) the
-- Razorpay refund reference are stored. No raw payment credentials, PAN, CVV,
-- UPI PIN, or private keys are ever written here.
--
-- Same direct-SQL trust boundary as wallet.recurring_payment_mandates (see
-- that migration's header, and apps/control-plane-api/src/wallet-user-store.ts's):
-- no RLS here either, for structural consistency with every OTHER runtime.*
-- table (workflow_intents, lifecycle_steps, outbox_events, jobs, spend_ledger,
-- kill_switches, quotes) — none of which enable it. All of runtime.* is
-- written exclusively via direct parameterized SQL from a role that bypasses
-- RLS.

CREATE TABLE runtime.refund_requests (
  id text NOT NULL,
  environment platform.counter_environment NOT NULL,
  transaction_id text NOT NULL,
  merchant_id text NOT NULL,
  requested_amount_minor bigint NOT NULL,
  currency text NOT NULL DEFAULT 'INR',
  reason text NOT NULL,
  status text NOT NULL DEFAULT 'pending',
  auto_approved boolean NOT NULL DEFAULT false,
  -- Razorpay's refund reference, populated only once status = 'executed'.
  provider_reference text,
  requested_at timestamptz NOT NULL DEFAULT clock_timestamp(),
  decided_at timestamptz,
  decided_by text,
  created_at timestamptz NOT NULL DEFAULT clock_timestamp(),
  updated_at timestamptz NOT NULL DEFAULT clock_timestamp(),
  PRIMARY KEY (environment, id),
  CONSTRAINT refund_requests_status
    CHECK (status IN ('pending', 'approved', 'denied', 'executed')),
  CONSTRAINT refund_requests_id_profile
    CHECK (identity.is_counter_id(id, 'refund-request')),
  CONSTRAINT refund_requests_merchant_id_profile
    CHECK (identity.is_counter_id(merchant_id, 'merchant')),
  CONSTRAINT refund_requests_transaction_id_not_empty
    CHECK (char_length(transaction_id) > 0),
  CONSTRAINT refund_requests_reason_not_empty
    CHECK (char_length(reason) > 0),
  CONSTRAINT refund_requests_amount_positive
    CHECK (requested_amount_minor > 0),
  CONSTRAINT refund_requests_currency
    CHECK (currency = 'INR'),
  -- pending: no decision yet. approved/denied/executed: a decision was made,
  -- by someone, at some time. executed additionally carries the Razorpay
  -- reference proving the refund actually happened (not just decided).
  CONSTRAINT refund_requests_decided_state CHECK (
    (status = 'pending' AND decided_at IS NULL AND decided_by IS NULL)
    OR (status IN ('approved', 'denied', 'executed')
        AND decided_at IS NOT NULL AND decided_by IS NOT NULL)
  ),
  CONSTRAINT refund_requests_executed_state CHECK (
    (status = 'executed' AND provider_reference IS NOT NULL)
    OR (status <> 'executed')
  ),
  CONSTRAINT refund_requests_merchant_fk
    FOREIGN KEY (environment, merchant_id)
    REFERENCES merchant.scopes (environment, merchant_id)
);

CREATE INDEX refund_requests_merchant_pending
  ON runtime.refund_requests (environment, merchant_id)
  WHERE status = 'pending';

CREATE INDEX refund_requests_merchant_all
  ON runtime.refund_requests (environment, merchant_id, created_at DESC);

-- At most one live (pending) refund request per transaction — a merchant
-- deciding on a prior request must resolve it before a new one can be filed;
-- prevents silently racing two simultaneous relays for the same transaction.
CREATE UNIQUE INDEX refund_requests_one_pending_per_transaction
  ON runtime.refund_requests (environment, transaction_id)
  WHERE status = 'pending';
