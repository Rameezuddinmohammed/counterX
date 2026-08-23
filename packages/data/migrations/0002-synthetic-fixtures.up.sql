CREATE TABLE platform.synthetic_fixtures (
  fixture_id text PRIMARY KEY,
  environment platform.counter_environment NOT NULL,
  label text NOT NULL,
  classification text NOT NULL,
  payload jsonb NOT NULL,
  created_at timestamptz NOT NULL DEFAULT clock_timestamp(),
  CONSTRAINT synthetic_fixtures_classification
    CHECK (classification = 'synthetic'),
  CONSTRAINT synthetic_fixtures_payload_marker
    CHECK (payload @> '{"synthetic": true}'::jsonb)
);
