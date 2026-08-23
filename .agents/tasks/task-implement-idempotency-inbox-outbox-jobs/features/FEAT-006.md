# FEAT-006: Fix review issues in runtime repositories

## Status: completed

## Description

Address priority issues identified in the code review:

1. PostgresJobRepository.claim needs to also reclaim expired-lease jobs (pre-claim sweep)
2. PostgresIdempotencyStore.fail uses `new Date()` instead of `clock_timestamp()` in SQL
3. PostgresIdempotencyStore.complete needs guard for undefined responseSnapshot

## Acceptance Criteria

- [x] Expired-lease jobs can be reclaimed by the PostgresJobRepository.claim method
- [x] PostgresIdempotencyStore.fail uses clock_timestamp() in SQL for completed_at
- [x] PostgresIdempotencyStore.complete throws a clear error if responseSnapshot is undefined
- [x] All tests pass (542/542)
- [x] TypeScript typechecks pass
- [x] Lint and format pass

## Notes

- Issue 2 from the review (outbox claim semantics diverge) was verified to already be correct.
  The in-memory implementation already claims both `pending` and `failed` events with backoff check.
