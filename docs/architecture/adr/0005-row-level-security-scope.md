# ADR-0005: Reinforce tenant isolation with PostgreSQL RLS

- **Status:** Accepted
- **Date:** 2025-02-15
- **Requirements:** 1, 10, 14, 15

## Decision

Application authorization is deny-by-default and occurs before repository access. PostgreSQL row-level security reinforces it for tenant-owned tables. Every tenant-owned row carries immutable owning scope and environment. Repository transactions set scoped session claims from an explicit `ActorContext`; background jobs persist and re-establish that exact scope.

RLS is a defense in depth, not an ambient administrator bypass. Support access requires a scoped, expiring, reasoned, audited grant and does not allow direct production-table mutation.

## Consequences

Repository APIs cannot omit scope/environment. Tests must prove merchant, Wallet, operator/support, job, guessed-ID, and environment isolation.
