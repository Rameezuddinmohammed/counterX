INSERT INTO platform.synthetic_fixtures (
  fixture_id,
  environment,
  label,
  classification,
  payload
)
VALUES (
  'fixture_local_foundation_0001',
  'local',
  'Synthetic local foundation fixture',
  'synthetic',
  '{"synthetic": true, "purpose": "local-lifecycle-validation", "owner": "example-only"}'::jsonb
)
ON CONFLICT (fixture_id) DO NOTHING;
