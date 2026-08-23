# FEAT-003: Unit tests for in-memory repository implementations

Status: completed

## Description
Write comprehensive unit tests for all four in-memory repository implementations:
- IdempotencyStore (10 tests)
- OutboxRepository (10 tests)
- InboxRepository (7 tests)
- JobRepository (18 tests)

## Test Files
- packages/workflow/src/idempotency-store.test.ts
- packages/workflow/src/outbox-repository.test.ts
- packages/workflow/src/inbox-repository.test.ts
- packages/workflow/src/job-repository.test.ts

## Scenarios Covered
1. Idempotency: acquire new, replay completed, digest conflict, in-flight, failed re-acquire, complete stores snapshot, scope isolation, concurrent requests
2. Outbox: append creates pending, claim pending events, limit claimed, markDispatched, markFailed with exponential backoff, failed events respect nextAttemptAt, markDeadLetter, error on unknown ids
3. Inbox: receive new, duplicate detection (same source+sourceEventId), different sources with same eventId are distinct, markProcessed, duplicate still detected after processing, correlationId preservation
4. Jobs: enqueue, claim by type, no claim on non-matching type, no claim on future availableAt, no claim on valid lease, expired lease takeover, complete, complete wrong owner rejected, renewLease, renew wrong owner rejected, fail with exponential backoff, poison job (max attempts -> dead_letter), explicit deadLetter, deadLetter wrong owner rejected, backoff increases exponentially, correlationId propagation, completed/dead-lettered jobs not reclaimable
