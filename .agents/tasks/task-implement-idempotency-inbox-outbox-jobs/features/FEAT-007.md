# FEAT-007: Address v3 review issues (third review pass)

## Status: completed

## Description

Address the 3 issues identified in the v3 review (2025-01-15-221700-review.md):

1. In-memory complete retains lease fields - Verify `leaseOwner: null` and `leaseExpiresAt: null` are present
2. Extra bind parameter in expired-lease sweep - Remove `limit` from the parameter array for the sweep UPDATE query
3. Sync JobRepository.claim missing limit param - Verify `ClaimJobsParams` has `readonly limit?: number`

## Resolution

All 3 issues were already resolved in previous commits (73b813c and e81720c):

1. `InMemoryJobRepository.complete()` already explicitly sets `leaseOwner: null, leaseExpiresAt: null`
2. The expired-lease sweep UPDATE in `PostgresJobRepository.claim()` already passes only `[types, asDate(now)]` (two parameters matching `$1` and `$2`)
3. `ClaimJobsParams` already includes `readonly limit?: number` and the in-memory `claim()` destructures it with a default of 1

## Verification

- All 542 workflow tests pass
- All 25 data tests pass
- TypeScript typechecks pass in both packages
- ESLint passes with 0 warnings
- Prettier formatting is clean

## Acceptance Criteria

- [x] In-memory `complete()` nulls `leaseOwner` and `leaseExpiresAt`
- [x] Expired-lease sweep UPDATE passes only 2 parameters
- [x] Sync `ClaimJobsParams` interface has `limit?: number`
- [x] All tests pass
- [x] TypeScript typechecks pass
- [x] Lint and format pass
