CREATE SCHEMA identity;
CREATE SCHEMA merchant;
CREATE SCHEMA wallet;

CREATE FUNCTION identity.is_counter_id(value text, expected_kind text)
RETURNS boolean
LANGUAGE sql
IMMUTABLE
PARALLEL SAFE
AS $$
  SELECT value ~ ('^ctr_' || expected_kind || '_[A-Za-z0-9_-]{21}[AQgw]$')
$$;

CREATE FUNCTION identity.scope_claim_matches(
  row_environment platform.counter_environment,
  row_scope_kind text,
  row_scope_id text
)
RETURNS boolean
LANGUAGE sql
STABLE
PARALLEL SAFE
AS $$
  SELECT
    current_setting('counter.environment', true) = row_environment::text
    AND current_setting('counter.scope_kind', true) = row_scope_kind
    AND current_setting('counter.scope_id', true) = row_scope_id
$$;

CREATE FUNCTION identity.permission_claim_in(allowed_permissions text[])
RETURNS boolean
LANGUAGE sql
STABLE
PARALLEL SAFE
AS $$
  SELECT current_setting('counter.permission', true) = ANY (allowed_permissions)
$$;

CREATE FUNCTION identity.assurance_claim_permits(required_permission text)
RETURNS boolean
LANGUAGE sql
STABLE
PARALLEL SAFE
AS $$
  SELECT
    CASE current_setting('counter.actor_kind', true)
      WHEN 'merchant_user' THEN
        current_setting('counter.assurance', true) IN ('session', 'multi_factor', 'step_up')
      WHEN 'wallet_user' THEN
        current_setting('counter.assurance', true) IN ('session', 'multi_factor', 'step_up')
      WHEN 'operator' THEN
        current_setting('counter.assurance', true) IN ('session', 'multi_factor', 'step_up')
      WHEN 'registered_agent' THEN
        current_setting('counter.assurance', true) = 'agent_proof'
      WHEN 'service' THEN
        current_setting('counter.assurance', true) = 'service_authenticated'
      ELSE false
    END
    AND CASE required_permission
      WHEN 'identity.scope.read' THEN true
      WHEN 'identity.actor.read' THEN true
      WHEN 'identity.role.read' THEN true
      WHEN 'identity.agent_key.read' THEN true
      WHEN 'identity.service_identity.read' THEN true
      WHEN 'identity.scope.manage' THEN
        CASE current_setting('counter.actor_kind', true)
          WHEN 'operator' THEN current_setting('counter.assurance', true) = 'step_up'
          ELSE current_setting('counter.assurance', true) IN (
            'multi_factor', 'step_up', 'service_authenticated'
          )
        END
      WHEN 'identity.actor.manage' THEN
        current_setting('counter.assurance', true) IN (
          'multi_factor', 'step_up', 'service_authenticated'
        )
      WHEN 'identity.role.assign' THEN
        current_setting('counter.assurance', true) IN (
          'multi_factor', 'step_up', 'service_authenticated'
        )
      WHEN 'identity.agent_key.manage' THEN
        current_setting('counter.assurance', true) IN (
          'multi_factor', 'step_up', 'service_authenticated'
        )
      WHEN 'identity.service_identity.manage' THEN
        current_setting('counter.assurance', true) IN (
          'multi_factor', 'step_up', 'service_authenticated'
        )
      WHEN 'identity.support_grant.read' THEN
        current_setting('counter.assurance', true) IN ('multi_factor', 'step_up')
      WHEN 'identity.support_grant.use' THEN
        current_setting('counter.assurance', true) IN ('multi_factor', 'step_up')
      WHEN 'identity.support_grant.issue' THEN
        current_setting('counter.assurance', true) = 'step_up'
      WHEN 'identity.support_grant.revoke' THEN
        current_setting('counter.assurance', true) = 'step_up'
      ELSE false
    END
$$;

CREATE FUNCTION identity.reject_column_changes()
RETURNS trigger
LANGUAGE plpgsql
AS $$
DECLARE
  column_name text;
BEGIN
  FOREACH column_name IN ARRAY TG_ARGV LOOP
    IF (to_jsonb(OLD) -> column_name) IS DISTINCT FROM (to_jsonb(NEW) -> column_name) THEN
      RAISE EXCEPTION 'immutable identity ownership or evidence column cannot be changed'
        USING ERRCODE = 'check_violation';
    END IF;
  END LOOP;
  RETURN NEW;
END
$$;

CREATE FUNCTION identity.reject_event_mutation()
RETURNS trigger
LANGUAGE plpgsql
AS $$
BEGIN
  RAISE EXCEPTION 'support grant events are append-only'
    USING ERRCODE = 'check_violation';
END
$$;

CREATE FUNCTION identity.require_registered_owner_scope()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = pg_catalog, pg_temp
SET row_security = off
AS $$
BEGIN
  IF NEW.owner_scope_kind <> 'platform' AND NOT EXISTS (
    SELECT 1
    FROM identity.scope_registry registered_scope
    WHERE registered_scope.environment = NEW.environment
      AND registered_scope.scope_kind = NEW.owner_scope_kind
      AND registered_scope.scope_id = NEW.owner_scope_id
  ) THEN
    RAISE EXCEPTION 'tenant owner scope is not registered'
      USING ERRCODE = 'foreign_key_violation';
  END IF;
  RETURN NEW;
END
$$;

CREATE TABLE identity.scope_registry (
  environment platform.counter_environment NOT NULL,
  scope_kind text NOT NULL,
  scope_id text NOT NULL,
  created_at timestamptz NOT NULL,
  PRIMARY KEY (environment, scope_kind, scope_id),
  CONSTRAINT scope_registry_kind CHECK (scope_kind IN ('merchant', 'wallet')),
  CONSTRAINT scope_registry_id_profile CHECK (
    (scope_kind = 'merchant' AND identity.is_counter_id(scope_id, 'merchant'))
    OR (scope_kind = 'wallet' AND identity.is_counter_id(scope_id, 'wallet'))
  )
);

CREATE TABLE merchant.scopes (
  environment platform.counter_environment NOT NULL,
  scope_kind text NOT NULL DEFAULT 'merchant',
  merchant_id text NOT NULL,
  created_at timestamptz NOT NULL,
  PRIMARY KEY (environment, merchant_id),
  CONSTRAINT merchant_scopes_kind CHECK (scope_kind = 'merchant'),
  CONSTRAINT merchant_scopes_id_profile CHECK (identity.is_counter_id(merchant_id, 'merchant')),
  CONSTRAINT merchant_scopes_registry_fk
    FOREIGN KEY (environment, scope_kind, merchant_id)
    REFERENCES identity.scope_registry (environment, scope_kind, scope_id)
    ON DELETE RESTRICT
);

CREATE TABLE wallet.scopes (
  environment platform.counter_environment NOT NULL,
  scope_kind text NOT NULL DEFAULT 'wallet',
  wallet_id text NOT NULL,
  created_at timestamptz NOT NULL,
  PRIMARY KEY (environment, wallet_id),
  CONSTRAINT wallet_scopes_kind CHECK (scope_kind = 'wallet'),
  CONSTRAINT wallet_scopes_id_profile CHECK (identity.is_counter_id(wallet_id, 'wallet')),
  CONSTRAINT wallet_scopes_registry_fk
    FOREIGN KEY (environment, scope_kind, wallet_id)
    REFERENCES identity.scope_registry (environment, scope_kind, scope_id)
    ON DELETE RESTRICT
);

CREATE TABLE identity.permissions (
  permission_key text PRIMARY KEY,
  created_at timestamptz NOT NULL DEFAULT clock_timestamp(),
  CONSTRAINT permissions_closed_vocabulary CHECK (permission_key IN (
    'identity.scope.read',
    'identity.scope.manage',
    'identity.actor.read',
    'identity.actor.manage',
    'identity.role.read',
    'identity.role.assign',
    'identity.agent_key.read',
    'identity.agent_key.manage',
    'identity.service_identity.read',
    'identity.service_identity.manage',
    'identity.support_grant.read',
    'identity.support_grant.issue',
    'identity.support_grant.revoke',
    'identity.support_grant.use'
  ))
);

CREATE TABLE identity.roles (
  role_key text PRIMARY KEY,
  actor_kind text NOT NULL,
  scope_kind text NOT NULL,
  created_at timestamptz NOT NULL DEFAULT clock_timestamp(),
  CONSTRAINT roles_actor_kind CHECK (actor_kind IN (
    'merchant_user', 'wallet_user', 'operator', 'service'
  )),
  CONSTRAINT roles_scope_kind CHECK (scope_kind IN ('merchant', 'wallet', 'platform', 'any')),
  CONSTRAINT roles_closed_vocabulary CHECK (role_key IN (
    'merchant.owner',
    'merchant.admin',
    'merchant.integration',
    'merchant.operations',
    'merchant.auditor',
    'merchant.read_only',
    'wallet.owner',
    'platform.operator',
    'service.identity'
  ))
);

CREATE TABLE identity.role_permissions (
  role_key text NOT NULL REFERENCES identity.roles (role_key) ON DELETE RESTRICT,
  permission_key text NOT NULL REFERENCES identity.permissions (permission_key) ON DELETE RESTRICT,
  PRIMARY KEY (role_key, permission_key)
);

CREATE TABLE identity.actors (
  environment platform.counter_environment NOT NULL,
  actor_kind text NOT NULL,
  actor_id text NOT NULL,
  owner_scope_kind text NOT NULL,
  owner_scope_id text NOT NULL,
  status text NOT NULL,
  created_at timestamptz NOT NULL,
  disabled_at timestamptz,
  PRIMARY KEY (environment, actor_kind, actor_id),
  UNIQUE (environment, actor_kind, actor_id, owner_scope_kind, owner_scope_id),
  CONSTRAINT actors_kind CHECK (actor_kind IN (
    'merchant_user', 'wallet_user', 'registered_agent', 'operator', 'service'
  )),
  CONSTRAINT actors_scope_kind CHECK (owner_scope_kind IN ('merchant', 'wallet', 'platform')),
  CONSTRAINT actors_scope_relation CHECK (
    (actor_kind = 'merchant_user' AND owner_scope_kind = 'merchant')
    OR (actor_kind IN ('wallet_user', 'registered_agent') AND owner_scope_kind = 'wallet')
    OR (actor_kind = 'operator' AND owner_scope_kind = 'platform' AND owner_scope_id = 'platform')
    OR actor_kind = 'service'
  ),
  CONSTRAINT actors_id_profile CHECK (
    (actor_kind = 'merchant_user' AND identity.is_counter_id(actor_id, 'merchant-user'))
    OR (actor_kind = 'wallet_user' AND identity.is_counter_id(actor_id, 'wallet-user'))
    OR (actor_kind = 'registered_agent' AND identity.is_counter_id(actor_id, 'agent'))
    OR (actor_kind = 'operator' AND identity.is_counter_id(actor_id, 'operator'))
    OR (actor_kind = 'service' AND identity.is_counter_id(actor_id, 'service'))
  ),
  CONSTRAINT actors_owner_id_profile CHECK (
    (owner_scope_kind = 'merchant' AND identity.is_counter_id(owner_scope_id, 'merchant'))
    OR (owner_scope_kind = 'wallet' AND identity.is_counter_id(owner_scope_id, 'wallet'))
    OR (owner_scope_kind = 'platform' AND owner_scope_id = 'platform')
  ),
  CONSTRAINT actors_status CHECK (status IN ('active', 'suspended', 'revoked')),
  CONSTRAINT actors_disabled_state CHECK (
    (status = 'active' AND disabled_at IS NULL)
    OR (status IN ('suspended', 'revoked') AND disabled_at IS NOT NULL AND disabled_at >= created_at)
  )
);

CREATE TABLE identity.actor_role_assignments (
  assignment_id bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  environment platform.counter_environment NOT NULL,
  actor_kind text NOT NULL,
  actor_id text NOT NULL,
  owner_scope_kind text NOT NULL,
  owner_scope_id text NOT NULL,
  role_key text NOT NULL REFERENCES identity.roles (role_key) ON DELETE RESTRICT,
  assigned_by_kind text NOT NULL,
  assigned_by_id text NOT NULL,
  assigned_at timestamptz NOT NULL,
  revoked_at timestamptz,
  CONSTRAINT actor_role_assignments_actor_fk
    FOREIGN KEY (
      environment, actor_kind, actor_id, owner_scope_kind, owner_scope_id
    )
    REFERENCES identity.actors (
      environment, actor_kind, actor_id, owner_scope_kind, owner_scope_id
    )
    ON DELETE RESTRICT,
  CONSTRAINT actor_role_assignments_owner_kind CHECK (
    owner_scope_kind IN ('merchant', 'wallet', 'platform')
  ),
  CONSTRAINT actor_role_assignments_assigned_by_kind CHECK (
    assigned_by_kind IN ('merchant_user', 'wallet_user', 'registered_agent', 'operator', 'service')
  ),
  CONSTRAINT actor_role_assignments_revocation_time CHECK (
    revoked_at IS NULL OR revoked_at >= assigned_at
  )
);

CREATE UNIQUE INDEX actor_role_assignments_active_unique
  ON identity.actor_role_assignments (
    environment, actor_kind, actor_id, owner_scope_kind, owner_scope_id, role_key
  )
  WHERE revoked_at IS NULL;

CREATE TABLE identity.agent_public_keys (
  environment platform.counter_environment NOT NULL,
  owner_scope_kind text NOT NULL DEFAULT 'wallet',
  owner_scope_id text NOT NULL,
  key_id text NOT NULL,
  actor_kind text NOT NULL DEFAULT 'registered_agent',
  agent_id text NOT NULL,
  algorithm text NOT NULL,
  public_key_base64url text NOT NULL,
  created_at timestamptz NOT NULL,
  not_before timestamptz NOT NULL,
  expires_at timestamptz,
  revoked_at timestamptz,
  PRIMARY KEY (environment, key_id),
  CONSTRAINT agent_public_keys_owner_kind CHECK (owner_scope_kind = 'wallet'),
  CONSTRAINT agent_public_keys_owner_id CHECK (
    identity.is_counter_id(owner_scope_id, 'wallet')
  ),
  CONSTRAINT agent_public_keys_key_id CHECK (identity.is_counter_id(key_id, 'key')),
  CONSTRAINT agent_public_keys_actor_kind CHECK (actor_kind = 'registered_agent'),
  CONSTRAINT agent_public_keys_agent_id CHECK (identity.is_counter_id(agent_id, 'agent')),
  CONSTRAINT agent_public_keys_algorithm CHECK (algorithm = 'Ed25519'),
  CONSTRAINT agent_public_keys_public_key CHECK (
    public_key_base64url ~ '^[A-Za-z0-9_-]{42}[AEIMQUYcgkosw048]$'
  ),
  CONSTRAINT agent_public_keys_validity CHECK (
    not_before >= created_at
    AND (expires_at IS NULL OR expires_at > not_before)
    AND (revoked_at IS NULL OR revoked_at >= created_at)
  ),
  CONSTRAINT agent_public_keys_scope_fk
    FOREIGN KEY (environment, owner_scope_kind, owner_scope_id)
    REFERENCES identity.scope_registry (environment, scope_kind, scope_id)
    ON DELETE RESTRICT,
  CONSTRAINT agent_public_keys_actor_fk
    FOREIGN KEY (
      environment, actor_kind, agent_id, owner_scope_kind, owner_scope_id
    )
    REFERENCES identity.actors (
      environment, actor_kind, actor_id, owner_scope_kind, owner_scope_id
    )
    ON DELETE RESTRICT
);

CREATE TABLE identity.service_identities (
  environment platform.counter_environment NOT NULL,
  owner_scope_kind text NOT NULL,
  owner_scope_id text NOT NULL,
  actor_kind text NOT NULL DEFAULT 'service',
  service_id text NOT NULL,
  binding_source text NOT NULL,
  binding_value text NOT NULL,
  status text NOT NULL,
  created_at timestamptz NOT NULL,
  disabled_at timestamptz,
  PRIMARY KEY (environment, service_id),
  UNIQUE (environment, binding_source, binding_value),
  CONSTRAINT service_identities_scope_kind CHECK (
    owner_scope_kind IN ('merchant', 'wallet', 'platform')
  ),
  CONSTRAINT service_identities_owner_id CHECK (
    (owner_scope_kind = 'merchant' AND identity.is_counter_id(owner_scope_id, 'merchant'))
    OR (owner_scope_kind = 'wallet' AND identity.is_counter_id(owner_scope_id, 'wallet'))
    OR (owner_scope_kind = 'platform' AND owner_scope_id = 'platform')
  ),
  CONSTRAINT service_identities_service_id CHECK (
    identity.is_counter_id(service_id, 'service')
  ),
  CONSTRAINT service_identities_actor_kind CHECK (actor_kind = 'service'),
  CONSTRAINT service_identities_binding_source CHECK (
    binding_source ~ '^[a-z][a-z0-9.-]{0,63}$'
  ),
  CONSTRAINT service_identities_binding_value CHECK (
    char_length(binding_value) BETWEEN 1 AND 256
    AND binding_value !~ '[[:cntrl:]]'
  ),
  CONSTRAINT service_identities_status CHECK (status IN ('active', 'suspended', 'revoked')),
  CONSTRAINT service_identities_disabled_state CHECK (
    (status = 'active' AND disabled_at IS NULL)
    OR (status IN ('suspended', 'revoked') AND disabled_at IS NOT NULL AND disabled_at >= created_at)
  ),
  CONSTRAINT service_identities_actor_fk
    FOREIGN KEY (
      environment, actor_kind, service_id, owner_scope_kind, owner_scope_id
    )
    REFERENCES identity.actors (
      environment, actor_kind, actor_id, owner_scope_kind, owner_scope_id
    )
    ON DELETE RESTRICT
);

CREATE TABLE identity.support_grants (
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
  issued_at timestamptz NOT NULL,
  valid_from timestamptz NOT NULL,
  expires_at timestamptz NOT NULL,
  revoked_at timestamptz,
  revoked_by text,
  CONSTRAINT support_grants_id CHECK (
    identity.is_counter_id(support_grant_id, 'support-grant')
  ),
  CONSTRAINT support_grants_target_scope_kind CHECK (
    target_scope_kind IN ('merchant', 'wallet')
  ),
  CONSTRAINT support_grants_target_scope_id CHECK (
    (target_scope_kind = 'merchant' AND identity.is_counter_id(target_scope_id, 'merchant'))
    OR (target_scope_kind = 'wallet' AND identity.is_counter_id(target_scope_id, 'wallet'))
  ),
  CONSTRAINT support_grants_target_scope_fk
    FOREIGN KEY (environment, target_scope_kind, target_scope_id)
    REFERENCES identity.scope_registry (environment, scope_kind, scope_id)
    ON DELETE RESTRICT,
  CONSTRAINT support_grants_operator_id CHECK (identity.is_counter_id(operator_id, 'operator')),
  CONSTRAINT support_grants_reason CHECK (reason IN (
    'customer_request', 'incident_response', 'security_investigation', 'regulatory_support'
  )),
  CONSTRAINT support_grants_authorization_kind CHECK (
    authorization_kind IN ('approved', 'incident')
  ),
  CONSTRAINT support_grants_authorized_by CHECK (
    identity.is_counter_id(authorized_by, 'operator') AND authorized_by <> operator_id
  ),
  CONSTRAINT support_grants_authorization_reference_source CHECK (
    authorization_reference_source ~ '^[a-z][a-z0-9.-]{0,63}$'
  ),
  CONSTRAINT support_grants_authorization_reference_value CHECK (
    char_length(authorization_reference_value) BETWEEN 1 AND 256
    AND authorization_reference_value !~ '[[:cntrl:]]'
  ),
  CONSTRAINT support_grants_validity CHECK (
    authorized_at <= issued_at
    AND issued_at <= valid_from
    AND valid_from < expires_at
    AND expires_at - valid_from <= interval '4 hours'
  ),
  CONSTRAINT support_grants_revocation_state CHECK (
    (revoked_at IS NULL AND revoked_by IS NULL)
    OR (
      revoked_at IS NOT NULL
      AND revoked_by IS NOT NULL
      AND revoked_at >= issued_at
      AND identity.is_counter_id(revoked_by, 'operator')
    )
  )
);

CREATE TABLE identity.support_grant_permissions (
  support_grant_id text NOT NULL
    REFERENCES identity.support_grants (support_grant_id) ON DELETE RESTRICT,
  permission_key text NOT NULL
    REFERENCES identity.permissions (permission_key) ON DELETE RESTRICT,
  PRIMARY KEY (support_grant_id, permission_key),
  CONSTRAINT support_grant_permissions_read_only CHECK (permission_key IN (
    'identity.scope.read',
    'identity.actor.read',
    'identity.role.read',
    'identity.agent_key.read',
    'identity.service_identity.read'
  ))
);

CREATE TABLE identity.support_grant_events (
  event_id bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  support_grant_id text REFERENCES identity.support_grants (support_grant_id) ON DELETE RESTRICT,
  environment platform.counter_environment NOT NULL,
  target_scope_kind text NOT NULL,
  target_scope_id text NOT NULL,
  operator_id text NOT NULL,
  action text NOT NULL,
  correlation_id text NOT NULL,
  occurred_at timestamptz NOT NULL DEFAULT clock_timestamp(),
  CONSTRAINT support_grant_events_scope_kind CHECK (
    target_scope_kind IN ('merchant', 'wallet')
  ),
  CONSTRAINT support_grant_events_scope_id CHECK (
    (target_scope_kind = 'merchant' AND identity.is_counter_id(target_scope_id, 'merchant'))
    OR (target_scope_kind = 'wallet' AND identity.is_counter_id(target_scope_id, 'wallet'))
  ),
  CONSTRAINT support_grant_events_operator_id CHECK (
    identity.is_counter_id(operator_id, 'operator')
  ),
  CONSTRAINT support_grant_events_action CHECK (
    action IN ('issued', 'used', 'denied', 'revoked')
  ),
  CONSTRAINT support_grant_events_grant_required CHECK (
    action = 'denied' OR support_grant_id IS NOT NULL
  ),
  CONSTRAINT support_grant_events_correlation_id CHECK (
    identity.is_counter_id(correlation_id, 'correlation')
  )
);

CREATE FUNCTION identity.current_actor_has_authority(
  row_environment platform.counter_environment,
  row_scope_kind text,
  row_scope_id text
)
RETURNS boolean
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = pg_catalog, pg_temp
SET row_security = off
AS $$
  SELECT EXISTS (
    SELECT 1
    FROM identity.actors actor_record
    JOIN identity.actor_role_assignments assignment
      ON assignment.environment = actor_record.environment
      AND assignment.actor_kind = actor_record.actor_kind
      AND assignment.actor_id = actor_record.actor_id
      AND assignment.owner_scope_kind = actor_record.owner_scope_kind
      AND assignment.owner_scope_id = actor_record.owner_scope_id
      AND assignment.revoked_at IS NULL
    JOIN identity.roles assigned_role
      ON assigned_role.role_key = assignment.role_key
      AND assigned_role.actor_kind = actor_record.actor_kind
      AND assigned_role.scope_kind IN (actor_record.owner_scope_kind, 'any')
    JOIN identity.role_permissions role_permission
      ON role_permission.role_key = assigned_role.role_key
      AND role_permission.permission_key = current_setting('counter.permission', true)
    WHERE actor_record.environment = row_environment
      AND actor_record.actor_kind = current_setting('counter.actor_kind', true)
      AND actor_record.actor_id = current_setting('counter.actor_id', true)
      AND actor_record.status = 'active'
      AND identity.assurance_claim_permits(
        current_setting('counter.permission', true)
      )
      AND (
        (
          actor_record.actor_kind = 'operator'
          AND actor_record.owner_scope_kind = 'platform'
          AND actor_record.owner_scope_id = 'platform'
          AND assigned_role.role_key = 'platform.operator'
        )
        OR (
          actor_record.actor_kind <> 'operator'
          AND actor_record.owner_scope_kind = row_scope_kind
          AND actor_record.owner_scope_id = row_scope_id
        )
      )
      AND (
        actor_record.actor_kind <> 'service'
        OR EXISTS (
          SELECT 1
          FROM identity.service_identities service_identity
          WHERE service_identity.environment = actor_record.environment
            AND service_identity.actor_kind = actor_record.actor_kind
            AND service_identity.service_id = actor_record.actor_id
            AND service_identity.owner_scope_kind = actor_record.owner_scope_kind
            AND service_identity.owner_scope_id = actor_record.owner_scope_id
            AND service_identity.status = 'active'
        )
      )
  )
$$;

CREATE FUNCTION identity.operator_platform_claim(
  row_environment platform.counter_environment,
  required_permission text
)
RETURNS boolean
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = pg_catalog, pg_temp
SET row_security = off
AS $$
  SELECT
    identity.scope_claim_matches(row_environment, 'platform', 'platform')
    AND current_setting('counter.actor_kind', true) = 'operator'
    AND current_setting('counter.permission', true) = required_permission
    AND identity.current_actor_has_authority(row_environment, 'platform', 'platform')
$$;

CREATE FUNCTION identity.operator_scope_bootstrap_claim(
  row_environment platform.counter_environment,
  row_scope_kind text,
  row_scope_id text
)
RETURNS boolean
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = pg_catalog, pg_temp
SET row_security = off
AS $$
  SELECT
    row_scope_kind IN ('merchant', 'wallet')
    AND identity.scope_claim_matches(row_environment, row_scope_kind, row_scope_id)
    AND current_setting('counter.actor_kind', true) = 'operator'
    AND current_setting('counter.permission', true) = 'identity.scope.manage'
    AND identity.current_actor_has_authority(
      row_environment,
      row_scope_kind,
      row_scope_id
    )
$$;

CREATE FUNCTION identity.access_scope_claim_matches(
  row_environment platform.counter_environment,
  row_scope_kind text,
  row_scope_id text
)
RETURNS boolean
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = pg_catalog, pg_temp
SET row_security = off
AS $$
  SELECT
    identity.scope_claim_matches(row_environment, row_scope_kind, row_scope_id)
    AND identity.current_actor_has_authority(row_environment, row_scope_kind, row_scope_id)
    AND (
      current_setting('counter.actor_kind', true) <> 'operator'
      OR row_scope_kind = 'platform'
      OR EXISTS (
        SELECT 1
        FROM identity.support_grants grant_record
        JOIN identity.support_grant_permissions grant_permission
          ON grant_permission.support_grant_id = grant_record.support_grant_id
        WHERE grant_record.support_grant_id = NULLIF(
          current_setting('counter.support_grant_id', true), ''
        )
          AND grant_record.environment = row_environment
          AND grant_record.target_scope_kind = row_scope_kind
          AND grant_record.target_scope_id = row_scope_id
          AND grant_record.operator_id = current_setting('counter.actor_id', true)
          AND grant_permission.permission_key = current_setting('counter.permission', true)
          AND grant_record.valid_from <= CURRENT_TIMESTAMP
          AND grant_record.expires_at > CURRENT_TIMESTAMP
          AND grant_record.revoked_at IS NULL
      )
    )
$$;

CREATE FUNCTION identity.enforce_actor_role_assignment()
RETURNS trigger
LANGUAGE plpgsql
SET search_path = pg_catalog, pg_temp
AS $$
BEGIN
  IF NOT EXISTS (
    SELECT 1
    FROM identity.roles assigned_role
    WHERE assigned_role.role_key = NEW.role_key
      AND assigned_role.actor_kind = NEW.actor_kind
      AND assigned_role.scope_kind IN (NEW.owner_scope_kind, 'any')
  ) THEN
    RAISE EXCEPTION 'assigned role is incompatible with actor kind or owner scope'
      USING ERRCODE = 'check_violation';
  END IF;

  IF TG_OP = 'INSERT'
    AND pg_catalog.row_security_active(
      'identity.actor_role_assignments'::pg_catalog.regclass
    )
    AND (
      NEW.assigned_by_kind IS DISTINCT FROM NULLIF(
        current_setting('counter.actor_kind', true), ''
      )
      OR NEW.assigned_by_id IS DISTINCT FROM NULLIF(
        current_setting('counter.actor_id', true), ''
      )
    )
  THEN
    RAISE EXCEPTION 'role assignment attribution must match current actor claims'
      USING ERRCODE = 'check_violation';
  END IF;

  RETURN NEW;
END
$$;

CREATE FUNCTION identity.enforce_support_grant_revocation()
RETURNS trigger
LANGUAGE plpgsql
SET search_path = pg_catalog, pg_temp
AS $$
BEGIN
  IF TG_OP = 'INSERT' THEN
    IF pg_catalog.row_security_active('identity.support_grants'::pg_catalog.regclass)
      AND (NEW.revoked_at IS NOT NULL OR NEW.revoked_by IS NOT NULL)
    THEN
      RAISE EXCEPTION 'support grant must be issued unrevoked under runtime RLS'
        USING ERRCODE = 'check_violation';
    END IF;
    RETURN NEW;
  END IF;

  IF OLD.revoked_at IS NULL
    AND OLD.revoked_by IS NULL
    AND (NEW.revoked_at IS NOT NULL OR NEW.revoked_by IS NOT NULL)
    AND pg_catalog.row_security_active('identity.support_grants'::pg_catalog.regclass)
    AND (
      current_setting('counter.actor_kind', true) IS DISTINCT FROM 'operator'
      OR NEW.revoked_by IS DISTINCT FROM NULLIF(
        current_setting('counter.actor_id', true), ''
      )
    )
  THEN
    RAISE EXCEPTION 'support grant revocation attribution must match current operator claims'
      USING ERRCODE = 'check_violation';
  END IF;

  IF (OLD.revoked_at IS NOT NULL OR OLD.revoked_by IS NOT NULL)
    AND (
      NEW.revoked_at IS DISTINCT FROM OLD.revoked_at
      OR NEW.revoked_by IS DISTINCT FROM OLD.revoked_by
    )
  THEN
    RAISE EXCEPTION 'support grant revocation cannot be cleared or rewritten'
      USING ERRCODE = 'check_violation';
  END IF;

  RETURN NEW;
END
$$;

CREATE FUNCTION identity.require_support_grant_permission()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = pg_catalog, pg_temp
SET row_security = off
AS $$
BEGIN
  IF NOT EXISTS (
    SELECT 1
    FROM identity.support_grant_permissions grant_permission
    WHERE grant_permission.support_grant_id = NEW.support_grant_id
  ) THEN
    RAISE EXCEPTION 'support grant requires at least one permission'
      USING ERRCODE = 'check_violation';
  END IF;
  RETURN NEW;
END
$$;

INSERT INTO identity.permissions (permission_key)
VALUES
  ('identity.scope.read'),
  ('identity.scope.manage'),
  ('identity.actor.read'),
  ('identity.actor.manage'),
  ('identity.role.read'),
  ('identity.role.assign'),
  ('identity.agent_key.read'),
  ('identity.agent_key.manage'),
  ('identity.service_identity.read'),
  ('identity.service_identity.manage'),
  ('identity.support_grant.read'),
  ('identity.support_grant.issue'),
  ('identity.support_grant.revoke'),
  ('identity.support_grant.use');

INSERT INTO identity.roles (role_key, actor_kind, scope_kind)
VALUES
  ('merchant.owner', 'merchant_user', 'merchant'),
  ('merchant.admin', 'merchant_user', 'merchant'),
  ('merchant.integration', 'merchant_user', 'merchant'),
  ('merchant.operations', 'merchant_user', 'merchant'),
  ('merchant.auditor', 'merchant_user', 'merchant'),
  ('merchant.read_only', 'merchant_user', 'merchant'),
  ('wallet.owner', 'wallet_user', 'wallet'),
  ('platform.operator', 'operator', 'platform'),
  ('service.identity', 'service', 'any');

INSERT INTO identity.role_permissions (role_key, permission_key)
SELECT role_key, permission_key
FROM (
  VALUES
    ('merchant.owner', 'identity.scope.read'),
    ('merchant.owner', 'identity.scope.manage'),
    ('merchant.owner', 'identity.actor.read'),
    ('merchant.owner', 'identity.actor.manage'),
    ('merchant.owner', 'identity.role.read'),
    ('merchant.owner', 'identity.role.assign'),
    ('merchant.owner', 'identity.agent_key.read'),
    ('merchant.owner', 'identity.agent_key.manage'),
    ('merchant.owner', 'identity.service_identity.read'),
    ('merchant.owner', 'identity.service_identity.manage'),
    ('merchant.admin', 'identity.scope.read'),
    ('merchant.admin', 'identity.scope.manage'),
    ('merchant.admin', 'identity.actor.read'),
    ('merchant.admin', 'identity.actor.manage'),
    ('merchant.admin', 'identity.role.read'),
    ('merchant.admin', 'identity.role.assign'),
    ('merchant.admin', 'identity.agent_key.read'),
    ('merchant.admin', 'identity.agent_key.manage'),
    ('merchant.admin', 'identity.service_identity.read'),
    ('merchant.admin', 'identity.service_identity.manage'),
    ('merchant.integration', 'identity.scope.read'),
    ('merchant.integration', 'identity.actor.read'),
    ('merchant.integration', 'identity.agent_key.read'),
    ('merchant.integration', 'identity.agent_key.manage'),
    ('merchant.integration', 'identity.service_identity.read'),
    ('merchant.integration', 'identity.service_identity.manage'),
    ('merchant.operations', 'identity.scope.read'),
    ('merchant.operations', 'identity.actor.read'),
    ('merchant.operations', 'identity.role.read'),
    ('merchant.operations', 'identity.agent_key.read'),
    ('merchant.operations', 'identity.service_identity.read'),
    ('merchant.auditor', 'identity.scope.read'),
    ('merchant.auditor', 'identity.actor.read'),
    ('merchant.auditor', 'identity.role.read'),
    ('merchant.auditor', 'identity.agent_key.read'),
    ('merchant.auditor', 'identity.service_identity.read'),
    ('merchant.read_only', 'identity.scope.read'),
    ('merchant.read_only', 'identity.actor.read'),
    ('merchant.read_only', 'identity.role.read'),
    ('merchant.read_only', 'identity.agent_key.read'),
    ('merchant.read_only', 'identity.service_identity.read'),
    ('wallet.owner', 'identity.scope.read'),
    ('wallet.owner', 'identity.scope.manage'),
    ('wallet.owner', 'identity.actor.read'),
    ('wallet.owner', 'identity.actor.manage'),
    ('wallet.owner', 'identity.role.read'),
    ('wallet.owner', 'identity.role.assign'),
    ('wallet.owner', 'identity.agent_key.read'),
    ('wallet.owner', 'identity.agent_key.manage'),
    ('wallet.owner', 'identity.service_identity.read'),
    ('wallet.owner', 'identity.service_identity.manage'),
    ('platform.operator', 'identity.scope.read'),
    ('platform.operator', 'identity.scope.manage'),
    ('platform.operator', 'identity.actor.read'),
    ('platform.operator', 'identity.role.read'),
    ('platform.operator', 'identity.agent_key.read'),
    ('platform.operator', 'identity.service_identity.read'),
    ('platform.operator', 'identity.support_grant.read'),
    ('platform.operator', 'identity.support_grant.issue'),
    ('platform.operator', 'identity.support_grant.revoke'),
    ('platform.operator', 'identity.support_grant.use'),
    ('service.identity', 'identity.scope.read'),
    ('service.identity', 'identity.actor.read'),
    ('service.identity', 'identity.role.read'),
    ('service.identity', 'identity.agent_key.read'),
    ('service.identity', 'identity.service_identity.read')
) AS catalog(role_key, permission_key);

CREATE TRIGGER scope_registry_immutable
BEFORE UPDATE ON identity.scope_registry
FOR EACH ROW EXECUTE FUNCTION identity.reject_column_changes(
  'environment', 'scope_kind', 'scope_id', 'created_at'
);

CREATE TRIGGER merchant_scopes_immutable
BEFORE UPDATE ON merchant.scopes
FOR EACH ROW EXECUTE FUNCTION identity.reject_column_changes(
  'environment', 'scope_kind', 'merchant_id', 'created_at'
);

CREATE TRIGGER wallet_scopes_immutable
BEFORE UPDATE ON wallet.scopes
FOR EACH ROW EXECUTE FUNCTION identity.reject_column_changes(
  'environment', 'scope_kind', 'wallet_id', 'created_at'
);

CREATE TRIGGER actors_immutable_ownership
BEFORE UPDATE ON identity.actors
FOR EACH ROW EXECUTE FUNCTION identity.reject_column_changes(
  'environment', 'actor_kind', 'actor_id', 'owner_scope_kind', 'owner_scope_id', 'created_at'
);

CREATE TRIGGER actors_require_registered_owner_scope
BEFORE INSERT OR UPDATE ON identity.actors
FOR EACH ROW EXECUTE FUNCTION identity.require_registered_owner_scope();

CREATE TRIGGER actor_role_assignments_enforce
BEFORE INSERT OR UPDATE ON identity.actor_role_assignments
FOR EACH ROW EXECUTE FUNCTION identity.enforce_actor_role_assignment();

CREATE TRIGGER actor_role_assignments_immutable
BEFORE UPDATE ON identity.actor_role_assignments
FOR EACH ROW EXECUTE FUNCTION identity.reject_column_changes(
  'assignment_id', 'environment', 'actor_kind', 'actor_id', 'owner_scope_kind',
  'owner_scope_id', 'role_key', 'assigned_by_kind', 'assigned_by_id', 'assigned_at'
);

CREATE TRIGGER agent_public_keys_immutable
BEFORE UPDATE ON identity.agent_public_keys
FOR EACH ROW EXECUTE FUNCTION identity.reject_column_changes(
  'environment', 'owner_scope_kind', 'owner_scope_id', 'key_id', 'actor_kind', 'agent_id',
  'algorithm', 'public_key_base64url', 'created_at', 'not_before', 'expires_at'
);

CREATE TRIGGER service_identities_immutable_ownership
BEFORE UPDATE ON identity.service_identities
FOR EACH ROW EXECUTE FUNCTION identity.reject_column_changes(
  'environment', 'owner_scope_kind', 'owner_scope_id', 'actor_kind', 'service_id',
  'binding_source', 'binding_value', 'created_at'
);

CREATE TRIGGER service_identities_require_registered_owner_scope
BEFORE INSERT OR UPDATE ON identity.service_identities
FOR EACH ROW EXECUTE FUNCTION identity.require_registered_owner_scope();

CREATE TRIGGER support_grants_immutable
BEFORE UPDATE ON identity.support_grants
FOR EACH ROW EXECUTE FUNCTION identity.reject_column_changes(
  'support_grant_id', 'environment', 'target_scope_kind', 'target_scope_id',
  'operator_id', 'reason', 'authorization_kind', 'authorized_by', 'authorized_at',
  'authorization_reference_source', 'authorization_reference_value', 'issued_at',
  'valid_from', 'expires_at'
);

CREATE TRIGGER support_grants_one_way_revocation
BEFORE INSERT OR UPDATE ON identity.support_grants
FOR EACH ROW EXECUTE FUNCTION identity.enforce_support_grant_revocation();

CREATE CONSTRAINT TRIGGER support_grants_require_permission
AFTER INSERT ON identity.support_grants
DEFERRABLE INITIALLY DEFERRED
FOR EACH ROW EXECUTE FUNCTION identity.require_support_grant_permission();

CREATE TRIGGER support_grant_events_append_only_update
BEFORE UPDATE ON identity.support_grant_events
FOR EACH ROW EXECUTE FUNCTION identity.reject_event_mutation();

CREATE TRIGGER support_grant_events_append_only_delete
BEFORE DELETE ON identity.support_grant_events
FOR EACH ROW EXECUTE FUNCTION identity.reject_event_mutation();

ALTER TABLE identity.scope_registry ENABLE ROW LEVEL SECURITY;
ALTER TABLE identity.scope_registry FORCE ROW LEVEL SECURITY;
ALTER TABLE merchant.scopes ENABLE ROW LEVEL SECURITY;
ALTER TABLE merchant.scopes FORCE ROW LEVEL SECURITY;
ALTER TABLE wallet.scopes ENABLE ROW LEVEL SECURITY;
ALTER TABLE wallet.scopes FORCE ROW LEVEL SECURITY;
ALTER TABLE identity.actors ENABLE ROW LEVEL SECURITY;
ALTER TABLE identity.actors FORCE ROW LEVEL SECURITY;
ALTER TABLE identity.actor_role_assignments ENABLE ROW LEVEL SECURITY;
ALTER TABLE identity.actor_role_assignments FORCE ROW LEVEL SECURITY;
ALTER TABLE identity.agent_public_keys ENABLE ROW LEVEL SECURITY;
ALTER TABLE identity.agent_public_keys FORCE ROW LEVEL SECURITY;
ALTER TABLE identity.service_identities ENABLE ROW LEVEL SECURITY;
ALTER TABLE identity.service_identities FORCE ROW LEVEL SECURITY;
ALTER TABLE identity.support_grants ENABLE ROW LEVEL SECURITY;
ALTER TABLE identity.support_grants FORCE ROW LEVEL SECURITY;
ALTER TABLE identity.support_grant_permissions ENABLE ROW LEVEL SECURITY;
ALTER TABLE identity.support_grant_permissions FORCE ROW LEVEL SECURITY;
ALTER TABLE identity.support_grant_events ENABLE ROW LEVEL SECURITY;
ALTER TABLE identity.support_grant_events FORCE ROW LEVEL SECURITY;

CREATE POLICY scope_registry_select ON identity.scope_registry
FOR SELECT USING (
  identity.access_scope_claim_matches(environment, scope_kind, scope_id)
  AND identity.permission_claim_in(ARRAY['identity.scope.read', 'identity.scope.manage'])
);
CREATE POLICY scope_registry_insert ON identity.scope_registry
FOR INSERT WITH CHECK (
  (
    identity.access_scope_claim_matches(environment, scope_kind, scope_id)
    AND identity.permission_claim_in(ARRAY['identity.scope.manage'])
  )
  OR identity.operator_scope_bootstrap_claim(environment, scope_kind, scope_id)
);

CREATE POLICY merchant_scopes_select ON merchant.scopes
FOR SELECT USING (
  identity.access_scope_claim_matches(environment, 'merchant', merchant_id)
  AND identity.permission_claim_in(ARRAY['identity.scope.read', 'identity.scope.manage'])
);
CREATE POLICY merchant_scopes_insert ON merchant.scopes
FOR INSERT WITH CHECK (
  (
    identity.access_scope_claim_matches(environment, 'merchant', merchant_id)
    AND identity.permission_claim_in(ARRAY['identity.scope.manage'])
  )
  OR identity.operator_scope_bootstrap_claim(environment, 'merchant', merchant_id)
);

CREATE POLICY wallet_scopes_select ON wallet.scopes
FOR SELECT USING (
  identity.access_scope_claim_matches(environment, 'wallet', wallet_id)
  AND identity.permission_claim_in(ARRAY['identity.scope.read', 'identity.scope.manage'])
);
CREATE POLICY wallet_scopes_insert ON wallet.scopes
FOR INSERT WITH CHECK (
  (
    identity.access_scope_claim_matches(environment, 'wallet', wallet_id)
    AND identity.permission_claim_in(ARRAY['identity.scope.manage'])
  )
  OR identity.operator_scope_bootstrap_claim(environment, 'wallet', wallet_id)
);

CREATE POLICY actors_select ON identity.actors
FOR SELECT USING (
  identity.access_scope_claim_matches(environment, owner_scope_kind, owner_scope_id)
  AND identity.permission_claim_in(ARRAY['identity.actor.read', 'identity.actor.manage'])
);
CREATE POLICY actors_insert ON identity.actors
FOR INSERT WITH CHECK (
  identity.access_scope_claim_matches(environment, owner_scope_kind, owner_scope_id)
  AND identity.permission_claim_in(ARRAY['identity.actor.manage'])
);
CREATE POLICY actors_update ON identity.actors
FOR UPDATE USING (
  identity.access_scope_claim_matches(environment, owner_scope_kind, owner_scope_id)
  AND identity.permission_claim_in(ARRAY['identity.actor.manage'])
) WITH CHECK (
  identity.access_scope_claim_matches(environment, owner_scope_kind, owner_scope_id)
  AND identity.permission_claim_in(ARRAY['identity.actor.manage'])
);

CREATE POLICY actor_roles_select ON identity.actor_role_assignments
FOR SELECT USING (
  identity.access_scope_claim_matches(environment, owner_scope_kind, owner_scope_id)
  AND identity.permission_claim_in(ARRAY['identity.role.read', 'identity.role.assign'])
);
CREATE POLICY actor_roles_insert ON identity.actor_role_assignments
FOR INSERT WITH CHECK (
  identity.access_scope_claim_matches(environment, owner_scope_kind, owner_scope_id)
  AND identity.permission_claim_in(ARRAY['identity.role.assign'])
);
CREATE POLICY actor_roles_update ON identity.actor_role_assignments
FOR UPDATE USING (
  identity.access_scope_claim_matches(environment, owner_scope_kind, owner_scope_id)
  AND identity.permission_claim_in(ARRAY['identity.role.assign'])
) WITH CHECK (
  identity.access_scope_claim_matches(environment, owner_scope_kind, owner_scope_id)
  AND identity.permission_claim_in(ARRAY['identity.role.assign'])
);

CREATE POLICY agent_keys_select ON identity.agent_public_keys
FOR SELECT USING (
  identity.access_scope_claim_matches(environment, owner_scope_kind, owner_scope_id)
  AND identity.permission_claim_in(ARRAY['identity.agent_key.read', 'identity.agent_key.manage'])
);
CREATE POLICY agent_keys_insert ON identity.agent_public_keys
FOR INSERT WITH CHECK (
  identity.access_scope_claim_matches(environment, owner_scope_kind, owner_scope_id)
  AND identity.permission_claim_in(ARRAY['identity.agent_key.manage'])
);
CREATE POLICY agent_keys_update ON identity.agent_public_keys
FOR UPDATE USING (
  identity.access_scope_claim_matches(environment, owner_scope_kind, owner_scope_id)
  AND identity.permission_claim_in(ARRAY['identity.agent_key.manage'])
) WITH CHECK (
  identity.access_scope_claim_matches(environment, owner_scope_kind, owner_scope_id)
  AND identity.permission_claim_in(ARRAY['identity.agent_key.manage'])
);

CREATE POLICY service_identities_select ON identity.service_identities
FOR SELECT USING (
  identity.access_scope_claim_matches(environment, owner_scope_kind, owner_scope_id)
  AND identity.permission_claim_in(
    ARRAY['identity.service_identity.read', 'identity.service_identity.manage']
  )
);
CREATE POLICY service_identities_insert ON identity.service_identities
FOR INSERT WITH CHECK (
  identity.access_scope_claim_matches(environment, owner_scope_kind, owner_scope_id)
  AND identity.permission_claim_in(ARRAY['identity.service_identity.manage'])
);
CREATE POLICY service_identities_update ON identity.service_identities
FOR UPDATE USING (
  identity.access_scope_claim_matches(environment, owner_scope_kind, owner_scope_id)
  AND identity.permission_claim_in(ARRAY['identity.service_identity.manage'])
) WITH CHECK (
  identity.access_scope_claim_matches(environment, owner_scope_kind, owner_scope_id)
  AND identity.permission_claim_in(ARRAY['identity.service_identity.manage'])
);

CREATE POLICY support_grants_select ON identity.support_grants
FOR SELECT USING (
  (
    identity.operator_platform_claim(environment, 'identity.support_grant.read')
    OR identity.operator_platform_claim(environment, 'identity.support_grant.issue')
    OR identity.operator_platform_claim(environment, 'identity.support_grant.revoke')
  )
  AND operator_id = current_setting('counter.actor_id', true)
);
CREATE POLICY support_grants_insert ON identity.support_grants
FOR INSERT WITH CHECK (
  identity.operator_platform_claim(environment, 'identity.support_grant.issue')
  AND operator_id = current_setting('counter.actor_id', true)
);
CREATE POLICY support_grants_update ON identity.support_grants
FOR UPDATE USING (
  identity.operator_platform_claim(environment, 'identity.support_grant.revoke')
  AND operator_id = current_setting('counter.actor_id', true)
) WITH CHECK (
  identity.operator_platform_claim(environment, 'identity.support_grant.revoke')
  AND operator_id = current_setting('counter.actor_id', true)
);

CREATE POLICY support_grant_permissions_select ON identity.support_grant_permissions
FOR SELECT USING (
  EXISTS (
    SELECT 1
    FROM identity.support_grants grant_record
    WHERE grant_record.support_grant_id = support_grant_permissions.support_grant_id
  )
);
CREATE POLICY support_grant_permissions_insert ON identity.support_grant_permissions
FOR INSERT WITH CHECK (
  EXISTS (
    SELECT 1
    FROM identity.support_grants grant_record
    WHERE grant_record.support_grant_id = support_grant_permissions.support_grant_id
  )
  AND current_setting('counter.permission', true) = 'identity.support_grant.issue'
);

CREATE POLICY support_grant_events_select ON identity.support_grant_events
FOR SELECT USING (
  identity.operator_platform_claim(environment, 'identity.support_grant.read')
  AND operator_id = current_setting('counter.actor_id', true)
);
CREATE POLICY support_grant_events_insert ON identity.support_grant_events
FOR INSERT WITH CHECK (
  operator_id = current_setting('counter.actor_id', true)
  AND (
    (
      action = 'issued'
      AND identity.operator_platform_claim(environment, 'identity.support_grant.issue')
    )
    OR (
      action = 'revoked'
      AND identity.operator_platform_claim(environment, 'identity.support_grant.revoke')
    )
    OR (
      action IN ('used', 'denied')
      AND identity.access_scope_claim_matches(environment, target_scope_kind, target_scope_id)
      AND current_setting('counter.support_grant_id', true) = support_grant_id
    )
  )
);

REVOKE EXECUTE ON ALL FUNCTIONS IN SCHEMA identity FROM PUBLIC;
