# ADR-0006: Isolate signing keys behind signer ports

- **Status:** Accepted
- **Date:** 2025-02-15
- **Requirements:** 3, 10, 15

## Decision

Hosted services use a dedicated signer port; application and telemetry layers receive artifact data and key references, never private key bytes. Production Counter keys use narrowly scoped signing infrastructure with encrypted material protected by AWS KMS and Secrets Manager unless a directly compatible managed signing primitive is evidenced. Rotation, revocation, key status, and `kid` resolution are explicit records.

Private agent keys remain outside hosted CTP services. Raw payment credentials and private keys are prohibited from persistence, events, logs, traces, fixtures, and support tooling. Cryptographic comparison uses approved constant-time mechanisms where applicable.

## Consequences

Key operations are auditable and replaceable, with a small trusted implementation boundary. Deployment must provision least-privilege access and key-rotation procedures.
