DO $$
BEGIN
  CREATE TYPE platform.counter_environment AS ENUM (
    'local',
    'test',
    'sandbox',
    'pilot',
    'production'
  );
EXCEPTION
  WHEN duplicate_object THEN NULL;
END
$$;

CREATE TABLE platform.environment_registry (
  environment platform.counter_environment PRIMARY KEY,
  created_at timestamptz NOT NULL DEFAULT clock_timestamp()
);

INSERT INTO platform.environment_registry (environment)
VALUES ('local'), ('test'), ('sandbox'), ('pilot'), ('production');
