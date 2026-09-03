-- Phase 3 of the remote-MCP plan: server-side, multi-tenant signing-key
-- custody.
--
-- Until now a buyer's Ed25519 signing key lived in a local, single-owner
-- store (packages/wallet-domain/src/file-key-store.ts — one process, one
-- buyer, one on-disk encrypted key file). The remote MCP transport moves
-- that key server-side: one running service holds signing keys for MANY
-- buyers and must resolve "which buyer's key" per authenticated request.
-- The private key material itself NEVER lands here — it is created inside
-- HashiCorp Vault's Transit engine with exportable=false and can only be
-- USED (sign) through Vault's API, never read back. See
-- packages/wallet-domain/src/vault-key-store.ts.
--
-- wallet.vault_keys is therefore a pure custody INDEX, not a key store: it
-- maps (environment, key_id) -> which tenant owns it, which Vault Transit
-- key name backs it, and whether it is still usable. It holds no secret
-- material of any kind.
--
-- This table IS the tenant-isolation boundary for remote signing. A
-- VaultSecureKeyStore instance is constructed per authenticated buyer and
-- checks every keyId against the tenant_id recorded here before it will
-- sign, describe, or revoke — so a request authenticated as tenant A can
-- never reach tenant B's Vault key, even knowing its exact key_id. A
-- cross-tenant lookup is reported as not-found, never as "forbidden",
-- matching the existence-hiding rule the rest of the system uses for
-- cross-tenant reads.
--
-- Revocation is recorded here and enforced here (status = 'revoked' makes
-- sign() reject), deliberately NOT by mutating or deleting the Vault key:
-- Vault Transit has no clean soft-revoke primitive, and irreversible key
-- deletion is out of scope. The Vault key is left intact and simply
-- becomes unreachable through this index.
--
-- tenant_id is deliberately polymorphic (a wallet id or an agent id,
-- whichever is the stable identity of the authenticated session) with no
-- per-kind CounterId format check and no foreign key — same convention and
-- rationale as wallet.revocations.scope_id (migration 0019) and
-- runtime.kill_switches.scope_id (migration 0008), which store the same
-- kind of "one column, several id kinds depending on scope" data.
--
-- RLS is enabled and forced with NO policies, matching every other
-- direct-SQL-written table in this repo (merchant.webhook_endpoints,
-- migration 0022; merchant.shopify_connections, migration 0013; see 0013's
-- header for the full rationale): written exclusively via parameterized SQL
-- from a role that bypasses RLS, with tenant isolation enforced by the
-- application. No policies means any future non-bypassing role is denied by
-- default until real RBAC policies are added.

CREATE TABLE wallet.vault_keys (
  environment platform.counter_environment NOT NULL,
  tenant_id text NOT NULL,
  key_id text NOT NULL,
  vault_key_name text NOT NULL,
  scope text NOT NULL,
  status text NOT NULL DEFAULT 'active',
  created_at timestamptz NOT NULL DEFAULT clock_timestamp(),
  revoked_at timestamptz,
  PRIMARY KEY (environment, key_id),
  CONSTRAINT vault_keys_key_id_profile CHECK (identity.is_counter_id(key_id, 'key')),
  CONSTRAINT vault_keys_tenant_id_not_empty CHECK (char_length(tenant_id) > 0),
  CONSTRAINT vault_keys_vault_key_name_not_empty CHECK (char_length(vault_key_name) > 0),
  CONSTRAINT vault_keys_scope_not_empty CHECK (char_length(scope) > 0),
  CONSTRAINT vault_keys_status CHECK (status IN ('active', 'revoked')),
  CONSTRAINT vault_keys_revoked_at_matches_status
    CHECK ((status = 'revoked') = (revoked_at IS NOT NULL))
);

-- Supports "list this tenant's keys", which the remote MCP session will
-- need to present a buyer their own registered signing keys. Not required
-- by the SecureKeyStore interface itself, but cheap to add now.
CREATE INDEX vault_keys_tenant
  ON wallet.vault_keys (environment, tenant_id);

ALTER TABLE wallet.vault_keys ENABLE ROW LEVEL SECURITY;
ALTER TABLE wallet.vault_keys FORCE ROW LEVEL SECURITY;
