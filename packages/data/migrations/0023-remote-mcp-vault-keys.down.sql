-- Drops the remote-MCP Vault key custody index. The Vault Transit keys
-- themselves are NOT touched by this (they live in Vault, not Postgres) —
-- rolling this back makes them unreachable through Counter, it does not
-- destroy them.
DROP INDEX IF EXISTS wallet.vault_keys_tenant;
DROP TABLE IF EXISTS wallet.vault_keys;
