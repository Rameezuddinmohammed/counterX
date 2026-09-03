# Counter — production Vault config for remote MCP key custody (Phase 3).
#
# Single-node, file-storage-backed Vault whose Transit secrets engine holds
# every buyer's Ed25519 signing key (see .kiro/specs/counter-agent-wallet/
# design.md, "Remote MCP transport and key custody" for the decision
# rationale). This app has NO public [http_service]/[[services]] block in
# fly.vault.toml — it is reachable only from other Fly apps in this same org
# over the private 6PN network at counter-vault.internal:8200, never from the
# public internet. TLS is intentionally not terminated here: this listens
# over Fly's private network, which is itself WireGuard-encrypted, matching
# how internal service-to-service calls work elsewhere in this deployment.
storage "file" {
  path = "/vault/file"
}

listener "tcp" {
  address     = "0.0.0.0:8200"
  tls_disable = true
}

api_addr = "http://counter-vault.internal:8200"
ui       = false

# Fly Machines containers do not grant CAP_IPC_LOCK, so Vault's default
# mlock (preventing secret-holding memory pages from being swapped to disk)
# cannot be enabled. Accepted for this pilot node: it has no swap configured
# by default on a shared-cpu Fly VM. Documented here, not silently disabled.
disable_mlock = true

# ---------------------------------------------------------------------------
# apps/remote-mcp's credential: a PERIODIC token, not a fixed-TTL one
# ---------------------------------------------------------------------------
# The `remote-mcp-signer` policy/token (created by a one-time setup script,
# not by this config file) is issued as a Vault PERIODIC token:
#   vault token create -policy=remote-mcp-signer -no-default-policy -orphan -period=720h
# A periodic token's expiry is always "period" (30 days here) from its LAST
# renewal, not from creation, with no absolute max-age ceiling as long as
# something renews it inside each window. apps/remote-mcp does that itself
# (src/vault-token-renewal.ts renews every 6 hours) - this is the Vault-
# native way to get a service credential that never has to be manually
# rotated on a calendar, without ever being a literally-permanent secret. A
# fixed long TTL (e.g. 1 or 10 years) was considered and rejected: it is not
# actually rotation, just a bigger number with the same eventual-expiry
# problem deferred rather than solved.
#
# If this token is ever lost, revoked, or the app is down for a full period
# with no renewal, reissue it with the same command against a real root/
# admin token and set the new value as apps/remote-mcp's VAULT_TOKEN secret.
