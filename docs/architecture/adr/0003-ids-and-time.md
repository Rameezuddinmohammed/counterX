# ADR-0003: Use opaque public IDs and injectable UTC time

- **Status:** Accepted
- **Date:** 2025-02-15
- **Requirements:** 1, 3, 14, 15

## Decision

All public and cross-scope identifiers are generated through an injectable `IdGenerator` and are opaque, non-sequential, non-PII-bearing values. Provider IDs are stored with a provider/source namespace and cannot authorize access by themselves. Domain time comes exclusively from an injectable UTC `Clock`; no business logic reads ambient local time.

The canonical Task 4 identifier profile is `ctr_<kind>_<entropy>`, where `kind` comes from the reviewed `COUNTER_ID_KINDS` object-class vocabulary and `entropy` is the unique unpadded base64url encoding of exactly 16 cryptographically random bytes. Parsers decode and re-encode the entropy to reject alternate spellings. The kind cannot contain a tenant, timestamp, sequence, or personal data, and adding a kind requires a reviewed code change. Test generators may be deterministic, but production generation uses the operating system cryptographic random source.

JSON timestamps are canonical UTC RFC 3339 instants with exactly millisecond precision (`YYYY-MM-DDTHH:mm:ss.sssZ`) and years `0000` through `9999`. Offsets, local-time forms, missing milliseconds, and silent precision normalization are rejected. Tests use deterministic clocks and ID generators.

## Consequences

Identifiers do not disclose tenant activity or existence, while deterministic tests and signing fixtures are reproducible. Repositories and workflow APIs must explicitly receive IDs and time dependencies.
