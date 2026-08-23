# ADR-0002: Use RFC 8785 canonical JSON for CTP artifacts

- **Status:** Accepted
- **Date:** 2025-02-15
- **Requirements:** 3, 10, 15

## Decision

CTP unsigned envelopes are schema-validated, serialized with RFC 8785 JSON Canonicalization Scheme behavior using `json-canonicalize@1.1.1`, digested with SHA-256, and signed or verified with `@noble/ed25519@2.2.3`. Key bytes use unpadded RFC 4648 section 5 base64url. The exact pipeline is schema validation → canonical unsigned bytes → SHA-256 payload/canonical digest → Ed25519 signing → immutable serialized artifact.

Unknown critical versions or extensions fail closed. Fixtures use fixed test keys and clocks only; their vectors must be independently verified before CTP objects are marked Verified.

## Consequences

Canonicalization ambiguity cannot silently produce alternate valid signatures. All language integrations must consume published test vectors and may not substitute ordinary JSON serialization.
