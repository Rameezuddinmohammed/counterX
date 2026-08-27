-- Durable kill switches.
--
-- Kill switches are server-side, operator-controlled circuit breakers that
-- DENY a consequential external effect for a targeted scope BEFORE the effect
-- is attempted. Before this table kill switches existed only as in-memory
-- registries (packages/observability, packages/payment-sdk) and were NOT
-- consulted by the worker's real transaction lifecycle, so an operator had no
-- durable, cross-restart way to halt live checkouts for a compromised
-- merchant/connector/platform.
--
-- This table records the ACTIVE/INACTIVE state of a kill switch keyed on
-- (environment, scope, entity_id). A platform-wide switch has a NULL entity_id;
-- a scoped switch (merchant/wallet/agent/mandate/connector/payment_adapter)
-- carries the target entity id. The worker consults active switches as a gate
-- in the SAME pre-effect position as the policy allow gate.
--
-- A switch is treated as ACTIVE when status = 'active' AND
-- (expires_at IS NULL OR expires_at > now); an expired row is inert without
-- needing a sweep.
--
-- SECURITY: only operator-supplied metadata (reason, activated_by) and the
-- scope/entity target are stored. No payment credentials, PAN, CVV, UPI PIN,
-- access tokens, or key secrets are ever written here.
CREATE TABLE runtime.kill_switches (
  id bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  environment platform.counter_environment NOT NULL,
  scope text NOT NULL,
  entity_id text,
  status text NOT NULL DEFAULT 'active',
  reason text NOT NULL,
  activated_by text NOT NULL,
  activated_at timestamptz NOT NULL DEFAULT clock_timestamp(),
  expires_at timestamptz,
  CONSTRAINT kill_switches_scope CHECK (
    scope IN ('platform', 'merchant', 'wallet', 'agent', 'mandate', 'connector', 'payment_adapter')
  ),
  CONSTRAINT kill_switches_status CHECK (status IN ('active', 'inactive')),
  CONSTRAINT kill_switches_reason_not_empty CHECK (char_length(reason) > 0),
  CONSTRAINT kill_switches_activated_by_not_empty CHECK (char_length(activated_by) > 0),
  CONSTRAINT kill_switches_expires_after_activated CHECK (
    expires_at IS NULL OR expires_at > activated_at
  ),
  -- A platform-wide switch carries no entity; a scoped switch must name one.
  CONSTRAINT kill_switches_platform_entity CHECK (
    (scope = 'platform' AND entity_id IS NULL)
    OR (scope <> 'platform' AND entity_id IS NOT NULL AND char_length(entity_id) > 0)
  )
);

-- One switch row per (environment, scope, entity_id). entity_id can be NULL for
-- a platform-wide switch, so a partial unique index covers the NULL case
-- separately from the scoped case (NULLs are not equal under a plain UNIQUE).
CREATE UNIQUE INDEX kill_switches_scoped_key
  ON runtime.kill_switches (environment, scope, entity_id)
  WHERE entity_id IS NOT NULL;

CREATE UNIQUE INDEX kill_switches_platform_key
  ON runtime.kill_switches (environment, scope)
  WHERE entity_id IS NULL;

-- Fast lookup of the active switches for an environment.
CREATE INDEX kill_switches_active
  ON runtime.kill_switches (environment, scope, entity_id)
  WHERE status = 'active';
