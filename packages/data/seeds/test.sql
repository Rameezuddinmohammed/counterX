INSERT INTO platform.synthetic_fixtures (
  fixture_id,
  environment,
  label,
  classification,
  payload
)
VALUES (
  'fixture_test_foundation_0001',
  'test',
  'Synthetic test foundation fixture',
  'synthetic',
  '{"synthetic": true, "purpose": "test-lifecycle-validation", "owner": "example-only"}'::jsonb
)
ON CONFLICT (fixture_id) DO NOTHING;
