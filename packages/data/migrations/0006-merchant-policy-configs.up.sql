-- Merchant policy configurations: durable, versioned policy documents keyed by
-- (environment, merchant_id) with optimistic-concurrency support via a
-- monotonically increasing integer version.
CREATE TABLE merchant.policy_configs (
  id bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  environment platform.counter_environment NOT NULL,
  merchant_id text NOT NULL,
  version int NOT NULL,
  config jsonb NOT NULL,
  created_at timestamptz NOT NULL DEFAULT clock_timestamp(),
  updated_at timestamptz NOT NULL DEFAULT clock_timestamp(),
  CONSTRAINT policy_configs_version_positive CHECK (version >= 1),
  CONSTRAINT policy_configs_merchant_id_not_empty CHECK (char_length(merchant_id) > 0)
);

CREATE UNIQUE INDEX policy_configs_natural_key
  ON merchant.policy_configs (environment, merchant_id);
