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
