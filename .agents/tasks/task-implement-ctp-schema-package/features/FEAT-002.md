# FEAT-002: Implement CTP Schema Package

## Status: in_progress

## Description
Implement the complete Counter Trust Protocol schema package including:
1. TypeScript types/interfaces for all 14 CTP object types and common envelope
2. Deterministic canonicalization (RFC 8785), SHA-256 digest, Ed25519 signing/verification
3. Key records with kid/use/algorithm/status/validity/rotation metadata
4. Issuer/subject/audience/environment/time checks and critical extension behavior
5. Deterministic test fixtures from fixed test keys
6. Comprehensive security tests (malformed envelope, algorithm downgrade, wrong-key, wrong-audience/environment, expiry, altered-payload, nonce, replay)

## Acceptance Criteria
- All 14 CTP object types have TypeScript interfaces
- Common envelope type with all required fields
- Canonicalization produces deterministic bytes via json-canonicalize
- SHA-256 digest computation
- Ed25519 sign/verify via @noble/ed25519
- Key record management (kid, use, algorithm, status, validity, rotation)
- Validation of issuer, subject, audience, environment, time
- Critical extension fail-closed behavior
- Deterministic fixtures from fixed test keys
- Tests pass for all security scenarios
- Package builds and type-checks cleanly
