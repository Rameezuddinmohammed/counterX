# Architecture decisions

Architecture Decision Records (ADRs) are immutable decisions for the Counter Platform Foundation. Supersede an ADR with a new record rather than editing a decision to change its outcome. The engineering baseline is machine-readable in [`engineering-baseline.yaml`](../../engineering-baseline.yaml).

| ADR | Decision |
| --- | --- |
| [0001](adr/0001-module-boundaries.md) | Strict TypeScript modular-monolith package boundaries |
| [0002](adr/0002-ctp-canonicalization.md) | RFC 8785 canonical JSON, SHA-256, and Ed25519 for CTP |
| [0003](adr/0003-ids-and-time.md) | Opaque IDs and injectable UTC time |
| [0004](adr/0004-postgresql-workflows.md) | PostgreSQL transactional workflow/outbox/inbox and leased jobs |
| [0005](adr/0005-row-level-security-scope.md) | RLS reinforces explicit scoped repository authorization |
| [0006](adr/0006-signing-key-boundaries.md) | Dedicated signer ports and non-exported private key boundaries |
| [0007](adr/0007-local-secure-key-storage.md) | Local wallet signer owns OS-protected key adapters |
| [0008](adr/0008-identity-provider-boundary.md) | External OIDC provider with application-owned authorization semantics |
| [0009](adr/0009-aws-pilot-target.md) | AWS Mumbai managed-services pilot target through OpenTofu |
