# ADR-0007: Keep agent signing local with OS-protected storage

- **Status:** Accepted
- **Date:** 2025-02-15
- **Requirements:** 3, 10, 15

## Decision

The foundation owns a `SecureKeyStore` port and conformance harness. Counter Agent Wallet alone owns production platform adapters and packaging. The first target is Windows protected credential/key facilities, then macOS Keychain and Linux Secret Service. Local keys are used through the local MCP signer process and do not cross into hosted services, models, telemetry, or payment integrations.

An adapter may claim protected/non-exportable assurance only when it can demonstrate that behavior. If the selected platform mechanism cannot do so, registration at that assurance fails and the limitation is exposed.

## Consequences

Local development can use an encrypted development key implementation, while production Wallet packaging requires platform-specific evidence. The local signer has a hard denylist for key, policy, and payment-secret mutation tools.
