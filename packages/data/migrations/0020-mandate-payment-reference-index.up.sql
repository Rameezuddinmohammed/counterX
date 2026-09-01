-- Index for MandateRepository.findByPaymentReference(): the join point that
-- lets a revoked provider mandate (RecurringMandateSummary /
-- wallet.recurring_payment_mandates) cascade to every Counter-native
-- WalletMandate issued against it (WalletRevocationService's
-- payment_reference cascade branch).
CREATE INDEX mandates_payment_reference
  ON wallet.mandates (environment, payment_reference_id);
