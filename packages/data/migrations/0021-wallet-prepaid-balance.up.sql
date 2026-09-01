-- Durable prepaid wallet balance (fund-once, spend-many under Counter's own
-- policy/mandate rules — no per-purchase provider round trip).
--
-- WHY THIS EXISTS: Razorpay's UPI Autopay (letting an agent charge a human's
-- bank account repeatedly, up to a limit, without a human re-approving each
-- time) requires a Razorpay account-level feature ("UPI Intent") that isn't
-- enabled by default and isn't self-service — confirmed by direct testing
-- against two separate fresh Razorpay test accounts, reproducing identically
-- on every documented integration path Razorpay offers (Standard Checkout
-- AND their fully-hosted Registration Link). This is a real, external,
-- provider-side gate, not a gap in this codebase.
--
-- This table gives Counter a genuinely real, provider-agnostic alternative
-- that needs no such feature: the human makes ONE real one-time Razorpay
-- TEST MODE payment (Cards/Netbanking — always available, no special
-- enablement) to fund a wallet balance; every subsequent agent purchase
-- draws down that ALREADY-COLLECTED balance under Counter's own real policy
-- checks (merchant allowlist, per-transaction ceiling, category limits,
-- mandate/wallet revocation — all unchanged, all still enforced) with no
-- further payment-provider round trip required. The money moved through a
-- real Razorpay TEST MODE payment exactly once, at top-up time.
--
-- wallet.balances: current balance per (environment, wallet_id). Never goes
-- negative (CHECK constraint + the atomic debit in
-- PostgresWalletBalanceStore.debit() only decrements when sufficient funds
-- are locked FOR UPDATE, same concurrency-safe pattern as
-- runtime.spend_ledger / PostgresSpendLedger).
--
-- wallet.balance_events: append-only ledger of every credit (topup) and
-- debit, keyed by (environment, wallet_id, reference) so both a real
-- Razorpay payment id (topup) and a transaction idempotency key (debit) make
-- a retry a safe no-op rather than double-crediting/double-debiting — same
-- idempotency shape as runtime.spend_ledger's (environment, wallet, reference)
-- unique index. This is also the audit trail: every rupee in the balance
-- traces back to a specific real Razorpay payment id via its topup event.
--
-- RLS is enabled and forced on both tables for structural consistency with
-- the rest of wallet.*, but no policies are defined — same direct-SQL trust
-- boundary as wallet.mandates (migration 0019) and every other wallet.*
-- table: no policies means any future non-bypassing role is denied by
-- default until real RBAC policies are added.

CREATE TABLE wallet.balances (
  environment platform.counter_environment NOT NULL,
  wallet_id text NOT NULL,
  balance_minor bigint NOT NULL DEFAULT 0,
  currency text NOT NULL DEFAULT 'INR',
  updated_at timestamptz NOT NULL DEFAULT clock_timestamp(),
  PRIMARY KEY (environment, wallet_id),
  CONSTRAINT balances_wallet_id_profile CHECK (identity.is_counter_id(wallet_id, 'wallet')),
  CONSTRAINT balances_non_negative CHECK (balance_minor >= 0),
  CONSTRAINT balances_currency_len CHECK (char_length(currency) = 3),
  CONSTRAINT balances_wallet_fk
    FOREIGN KEY (environment, wallet_id)
    REFERENCES wallet.scopes (environment, wallet_id)
);

ALTER TABLE wallet.balances ENABLE ROW LEVEL SECURITY;
ALTER TABLE wallet.balances FORCE ROW LEVEL SECURITY;

CREATE TABLE wallet.balance_events (
  environment platform.counter_environment NOT NULL,
  wallet_id text NOT NULL,
  reference text NOT NULL,
  event_type text NOT NULL,
  amount_minor bigint NOT NULL,
  currency text NOT NULL,
  -- For a topup event: the real Razorpay payment id that funded it (the
  -- audit trail back to real money). Null for a debit event.
  provider_payment_id text,
  created_at timestamptz NOT NULL DEFAULT clock_timestamp(),
  PRIMARY KEY (environment, wallet_id, reference),
  CONSTRAINT balance_events_wallet_id_profile CHECK (identity.is_counter_id(wallet_id, 'wallet')),
  CONSTRAINT balance_events_type CHECK (event_type IN ('topup', 'debit')),
  CONSTRAINT balance_events_amount_positive CHECK (amount_minor > 0),
  CONSTRAINT balance_events_currency_len CHECK (char_length(currency) = 3),
  CONSTRAINT balance_events_reference_not_empty CHECK (char_length(reference) > 0),
  CONSTRAINT balance_events_wallet_fk
    FOREIGN KEY (environment, wallet_id)
    REFERENCES wallet.scopes (environment, wallet_id)
);

CREATE INDEX balance_events_wallet_lookup
  ON wallet.balance_events (environment, wallet_id, created_at DESC);

ALTER TABLE wallet.balance_events ENABLE ROW LEVEL SECURITY;
ALTER TABLE wallet.balance_events FORCE ROW LEVEL SECURITY;
