CREATE TABLE identity.support_grant_authorizations (
  support_grant_id text PRIMARY KEY,
  environment platform.counter_environment NOT NULL,
  target_scope_kind text NOT NULL,
  target_scope_id text NOT NULL,
  operator_id text NOT NULL,
  reason text NOT NULL,
  authorization_kind text NOT NULL,
  authorized_by text NOT NULL,
  authorized_at timestamptz NOT NULL,
  authorization_reference_source text NOT NULL,
  authorization_reference_value text NOT NULL,
  valid_from timestamptz NOT NULL,
  expires_at timestamptz NOT NULL,
  CONSTRAINT support_grant_authorizations_id CHECK (
    identity.is_counter_id(support_grant_id, 'support-grant')
  ),
  CONSTRAINT support_grant_authorizations_target_scope_kind CHECK (
    target_scope_kind IN ('merchant', 'wallet')
  ),
  CONSTRAINT support_grant_authorizations_target_scope_id CHECK (
    (target_scope_kind = 'merchant' AND identity.is_counter_id(target_scope_id, 'merchant'))
    OR (target_scope_kind = 'wallet' AND identity.is_counter_id(target_scope_id, 'wallet'))
  ),
  CONSTRAINT support_grant_authorizations_target_scope_fk
    FOREIGN KEY (environment, target_scope_kind, target_scope_id)
    REFERENCES identity.scope_registry (environment, scope_kind, scope_id)
    ON DELETE RESTRICT,
  CONSTRAINT support_grant_authorizations_operator_id CHECK (
    identity.is_counter_id(operator_id, 'operator')
  ),
  CONSTRAINT support_grant_authorizations_reason CHECK (reason IN (
    'customer_request', 'incident_response', 'security_investigation', 'regulatory_support'
  )),
  CONSTRAINT support_grant_authorizations_authorization_kind CHECK (
    authorization_kind IN ('approved', 'incident')
  ),
  CONSTRAINT support_grant_authorizations_authorized_by CHECK (
    identity.is_counter_id(authorized_by, 'operator') AND authorized_by <> operator_id
  ),
  CONSTRAINT support_grant_authorizations_authorization_reference_source CHECK (
    authorization_reference_source ~ '^[a-z][a-z0-9.-]{0,63}$'
  ),
  CONSTRAINT support_grant_authorizations_authorization_reference_value CHECK (
    char_length(authorization_reference_value) BETWEEN 1 AND 256
    AND authorization_reference_value !~ '[[:cntrl:]]'
  ),
  CONSTRAINT support_grant_authorizations_validity CHECK (
    authorized_at <= valid_from
    AND valid_from < expires_at
    AND expires_at - valid_from <= interval '4 hours'
  )
);

CREATE TABLE identity.support_grant_authorization_permissions (
  support_grant_id text NOT NULL
    REFERENCES identity.support_grant_authorizations (support_grant_id) ON DELETE RESTRICT,
  permission_key text NOT NULL
    REFERENCES identity.permissions (permission_key) ON DELETE RESTRICT,
  PRIMARY KEY (support_grant_id, permission_key),
  CONSTRAINT support_grant_authorization_permissions_read_only CHECK (permission_key IN (
    'identity.scope.read',
    'identity.actor.read',
    'identity.role.read',
    'identity.agent_key.read',
    'identity.service_identity.read'
  ))
);

CREATE FUNCTION identity.require_support_grant_authorization_permission()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = pg_catalog, pg_temp
SET row_security = off
AS $$
BEGIN
  IF NOT EXISTS (
    SELECT 1
    FROM identity.support_grant_authorization_permissions grant_permission
    WHERE grant_permission.support_grant_id = NEW.support_grant_id
  ) THEN
    RAISE EXCEPTION 'support grant authorization requires at least one permission'
      USING ERRCODE = 'check_violation';
  END IF;
  RETURN NEW;
END
$$;

CREATE TRIGGER support_grant_authorizations_immutable
BEFORE UPDATE ON identity.support_grant_authorizations
FOR EACH ROW EXECUTE FUNCTION identity.reject_column_changes(
  'support_grant_id', 'environment', 'target_scope_kind', 'target_scope_id',
  'operator_id', 'reason', 'authorization_kind', 'authorized_by', 'authorized_at',
  'authorization_reference_source', 'authorization_reference_value',
  'valid_from', 'expires_at'
);

CREATE CONSTRAINT TRIGGER support_grant_authorizations_require_permission
AFTER INSERT ON identity.support_grant_authorizations
DEFERRABLE INITIALLY DEFERRED
FOR EACH ROW EXECUTE FUNCTION identity.require_support_grant_authorization_permission();

ALTER TABLE identity.support_grant_authorizations ENABLE ROW LEVEL SECURITY;
ALTER TABLE identity.support_grant_authorizations FORCE ROW LEVEL SECURITY;
ALTER TABLE identity.support_grant_authorization_permissions ENABLE ROW LEVEL SECURITY;
ALTER TABLE identity.support_grant_authorization_permissions FORCE ROW LEVEL SECURITY;

CREATE POLICY support_grant_authorizations_select ON identity.support_grant_authorizations
FOR SELECT USING (
  identity.operator_platform_claim(environment, 'identity.support_grant.issue')
);

CREATE POLICY support_grant_authorizations_insert ON identity.support_grant_authorizations
FOR INSERT WITH CHECK (
  identity.operator_platform_claim(environment, 'identity.support_grant.issue')
);

CREATE POLICY support_grant_authorization_permissions_select
ON identity.support_grant_authorization_permissions
FOR SELECT USING (
  EXISTS (
    SELECT 1
    FROM identity.support_grant_authorizations auth_record
    WHERE auth_record.support_grant_id = support_grant_authorization_permissions.support_grant_id
  )
);

CREATE POLICY support_grant_authorization_permissions_insert
ON identity.support_grant_authorization_permissions
FOR INSERT WITH CHECK (
  EXISTS (
    SELECT 1
    FROM identity.support_grant_authorizations auth_record
    WHERE auth_record.support_grant_id = support_grant_authorization_permissions.support_grant_id
  )
  AND current_setting('counter.permission', true) = 'identity.support_grant.issue'
);

REVOKE EXECUTE ON FUNCTION identity.require_support_grant_authorization_permission() FROM PUBLIC;
