DROP TABLE identity.support_grant_events;
DROP TABLE identity.support_grant_permissions;
DROP TABLE identity.support_grants;
DROP TABLE identity.agent_public_keys;
DROP TABLE identity.service_identities;
DROP TABLE identity.actor_role_assignments;
DROP TABLE identity.actors;
DROP TABLE merchant.scopes;
DROP TABLE wallet.scopes;
DROP TABLE identity.role_permissions;
DROP TABLE identity.roles;
DROP TABLE identity.permissions;
DROP TABLE identity.scope_registry;

DROP FUNCTION identity.access_scope_claim_matches(
  platform.counter_environment,
  text,
  text
);
DROP FUNCTION identity.operator_scope_bootstrap_claim(
  platform.counter_environment,
  text,
  text
);
DROP FUNCTION identity.operator_platform_claim(platform.counter_environment, text);
DROP FUNCTION identity.current_actor_has_authority(
  platform.counter_environment,
  text,
  text
);
DROP FUNCTION identity.enforce_support_grant_revocation();
DROP FUNCTION identity.enforce_actor_role_assignment();
DROP FUNCTION identity.require_support_grant_permission();
DROP FUNCTION identity.require_registered_owner_scope();
DROP FUNCTION identity.reject_event_mutation();
DROP FUNCTION identity.reject_column_changes();
DROP FUNCTION identity.assurance_claim_permits(text);
DROP FUNCTION identity.permission_claim_in(text[]);
DROP FUNCTION identity.scope_claim_matches(platform.counter_environment, text, text);
DROP FUNCTION identity.is_counter_id(text, text);

DROP SCHEMA wallet;
DROP SCHEMA merchant;
DROP SCHEMA identity;
