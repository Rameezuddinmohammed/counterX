CREATE SCHEMA runtime;

-- Idempotency keys: prevents duplicate processing of the same operation
CREATE TABLE runtime.idempotency_keys (
  id bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  environment platform.counter_environment NOT NULL,
  scope_kind text NOT NULL,
  scope_id text NOT NULL,
  operation text NOT NULL,
  key text NOT NULL,
  material_request_digest text NOT NULL,
  status text NOT NULL DEFAULT 'pending',
  response_snapshot jsonb,
  created_at timestamptz NOT NULL DEFAULT clock_timestamp(),
  completed_at timestamptz,
  expires_at timestamptz NOT NULL,
  CONSTRAINT idempotency_keys_scope_kind CHECK (scope_kind IN ('merchant', 'wallet', 'platform')),
  CONSTRAINT idempotency_keys_status CHECK (status IN ('pending', 'completed', 'failed')),
  CONSTRAINT idempotency_keys_digest_format CHECK (
    material_request_digest ~ '^sha256:[0-9a-f]{64}$'
  ),
  CONSTRAINT idempotency_keys_completed_state CHECK (
    (status = 'pending' AND completed_at IS NULL AND response_snapshot IS NULL)
    OR (status = 'completed' AND completed_at IS NOT NULL AND response_snapshot IS NOT NULL)
    OR (status = 'failed' AND completed_at IS NOT NULL)
  ),
  CONSTRAINT idempotency_keys_expires_after_created CHECK (expires_at > created_at),
  CONSTRAINT idempotency_keys_operation_not_empty CHECK (char_length(operation) > 0),
  CONSTRAINT idempotency_keys_key_not_empty CHECK (char_length(key) > 0)
);

CREATE UNIQUE INDEX idempotency_keys_natural_key
  ON runtime.idempotency_keys (environment, scope_kind, scope_id, operation, key);

-- Workflow intents: tracks in-flight command executions within a transaction
CREATE TABLE runtime.workflow_intents (
  id text PRIMARY KEY,
  transaction_id text NOT NULL,
  environment platform.counter_environment NOT NULL,
  scope_kind text NOT NULL,
  scope_id text NOT NULL,
  command_type text NOT NULL,
  command_digest text NOT NULL,
  authority_context jsonb NOT NULL,
  status text NOT NULL DEFAULT 'pending',
  created_at timestamptz NOT NULL DEFAULT clock_timestamp(),
  CONSTRAINT workflow_intents_scope_kind CHECK (scope_kind IN ('merchant', 'wallet', 'platform')),
  CONSTRAINT workflow_intents_status CHECK (
    status IN ('pending', 'executing', 'completed', 'failed')
  ),
  CONSTRAINT workflow_intents_command_type_not_empty CHECK (char_length(command_type) > 0),
  CONSTRAINT workflow_intents_command_digest_not_empty CHECK (char_length(command_digest) > 0),
  CONSTRAINT workflow_intents_transaction_id_not_empty CHECK (char_length(transaction_id) > 0)
);

CREATE UNIQUE INDEX workflow_intents_dedup
  ON runtime.workflow_intents (environment, transaction_id, command_type, command_digest);

-- Outbox events: reliable event publishing with at-least-once delivery
CREATE TABLE runtime.outbox_events (
  id text PRIMARY KEY,
  environment platform.counter_environment NOT NULL,
  scope_kind text NOT NULL,
  scope_id text NOT NULL,
  event_type text NOT NULL,
  event_version int NOT NULL DEFAULT 1,
  payload jsonb NOT NULL,
  correlation_id text,
  idempotency_key text,
  status text NOT NULL DEFAULT 'pending',
  attempts int NOT NULL DEFAULT 0,
  next_attempt_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT clock_timestamp(),
  dispatched_at timestamptz,
  error_class text,
  owner text,
  CONSTRAINT outbox_events_scope_kind CHECK (scope_kind IN ('merchant', 'wallet', 'platform')),
  CONSTRAINT outbox_events_status CHECK (
    status IN ('pending', 'dispatched', 'failed', 'dead_letter')
  ),
  CONSTRAINT outbox_events_event_version_positive CHECK (event_version >= 1),
  CONSTRAINT outbox_events_attempts_non_negative CHECK (attempts >= 0),
  CONSTRAINT outbox_events_event_type_not_empty CHECK (char_length(event_type) > 0),
  CONSTRAINT outbox_events_dispatched_state CHECK (
    (status = 'dispatched' AND dispatched_at IS NOT NULL)
    OR (status <> 'dispatched')
  )
);

CREATE INDEX outbox_events_claimable
  ON runtime.outbox_events (status, next_attempt_at)
  WHERE status IN ('pending', 'failed');

-- Inbox events: idempotent event reception (exactly-once processing)
CREATE TABLE runtime.inbox_events (
  id text PRIMARY KEY,
  environment platform.counter_environment NOT NULL,
  source text NOT NULL,
  source_event_id text NOT NULL,
  event_type text NOT NULL,
  payload jsonb NOT NULL,
  correlation_id text,
  status text NOT NULL DEFAULT 'received',
  received_at timestamptz NOT NULL DEFAULT clock_timestamp(),
  processed_at timestamptz,
  CONSTRAINT inbox_events_status CHECK (status IN ('received', 'processed', 'duplicate')),
  CONSTRAINT inbox_events_source_not_empty CHECK (char_length(source) > 0),
  CONSTRAINT inbox_events_source_event_id_not_empty CHECK (char_length(source_event_id) > 0),
  CONSTRAINT inbox_events_event_type_not_empty CHECK (char_length(event_type) > 0),
  CONSTRAINT inbox_events_processed_state CHECK (
    (status = 'processed' AND processed_at IS NOT NULL)
    OR (status <> 'processed')
  )
);

CREATE UNIQUE INDEX inbox_events_dedup
  ON runtime.inbox_events (environment, source, source_event_id);

-- Jobs: durable background job processing with lease-based ownership
CREATE TABLE runtime.jobs (
  id text PRIMARY KEY,
  environment platform.counter_environment NOT NULL,
  scope_kind text NOT NULL,
  scope_id text NOT NULL,
  type text NOT NULL,
  payload_reference text,
  status text NOT NULL DEFAULT 'available',
  available_at timestamptz NOT NULL DEFAULT clock_timestamp(),
  lease_owner text,
  lease_expires_at timestamptz,
  attempt_count int NOT NULL DEFAULT 0,
  max_attempts int NOT NULL DEFAULT 5,
  last_error_class text,
  correlation_id text,
  created_at timestamptz NOT NULL DEFAULT clock_timestamp(),
  completed_at timestamptz,
  CONSTRAINT jobs_scope_kind CHECK (scope_kind IN ('merchant', 'wallet', 'platform')),
  CONSTRAINT jobs_status CHECK (
    status IN ('available', 'leased', 'completed', 'failed', 'dead_letter')
  ),
  CONSTRAINT jobs_type_not_empty CHECK (char_length(type) > 0),
  CONSTRAINT jobs_attempt_count_non_negative CHECK (attempt_count >= 0),
  CONSTRAINT jobs_max_attempts_positive CHECK (max_attempts >= 1),
  CONSTRAINT jobs_lease_state CHECK (
    (status = 'leased' AND lease_owner IS NOT NULL AND lease_expires_at IS NOT NULL)
    OR (status <> 'leased' AND lease_owner IS NULL AND lease_expires_at IS NULL)
  ),
  CONSTRAINT jobs_completed_state CHECK (
    (status = 'completed' AND completed_at IS NOT NULL)
    OR (status <> 'completed')
  )
);

CREATE INDEX jobs_claimable
  ON runtime.jobs (status, type, available_at)
  WHERE status = 'available';

-- Job attempts: audit trail for each job execution attempt
CREATE TABLE runtime.job_attempts (
  id bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  job_id text NOT NULL REFERENCES runtime.jobs (id) ON DELETE CASCADE,
  attempt_number int NOT NULL,
  started_at timestamptz NOT NULL DEFAULT clock_timestamp(),
  completed_at timestamptz,
  status text NOT NULL DEFAULT 'running',
  error_class text,
  error_message text,
  CONSTRAINT job_attempts_status CHECK (status IN ('running', 'succeeded', 'failed')),
  CONSTRAINT job_attempts_attempt_number_positive CHECK (attempt_number >= 1),
  CONSTRAINT job_attempts_completed_state CHECK (
    (status = 'running' AND completed_at IS NULL AND error_class IS NULL AND error_message IS NULL)
    OR (status = 'succeeded' AND completed_at IS NOT NULL AND error_class IS NULL AND error_message IS NULL)
    OR (status = 'failed' AND completed_at IS NOT NULL)
  )
);

CREATE UNIQUE INDEX job_attempts_unique
  ON runtime.job_attempts (job_id, attempt_number);
