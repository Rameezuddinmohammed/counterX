# FEAT-006: Fix review issues in runtime repositories

## Status: completed

## Description

Address all priority issues identified in the code review (2025-01-15-220300-review.md):

1. Outbox claim divergence: in-memory claim() now returns both pending and failed events past their nextAttemptAt, matching PostgreSQL behavior
2. eventVersion type mismatch: changed from string to number in OutboxEvent and OutboxEventInput interfaces to match the integer DB column
3. Hardcoded job batch size: added limit parameter (default 10) to AsyncJobRepository.claim() and PostgresJobRepository.claim()
4. markFailed race condition: replaced SELECT-then-UPDATE with atomic UPDATE that computes backoff in SQL

## Acceptance Criteria

- [x] In-memory outbox claim returns both pending and failed events (matching Postgres)
- [x] OutboxEvent.eventVersion and OutboxEventInput.eventVersion are type number
- [x] AsyncJobRepository.claim accepts a configurable limit parameter
- [x] PostgresOutboxRepository.markFailed uses a single atomic UPDATE statement
- [x] All 542 workflow tests pass
- [x] All 25 data tests pass
- [x] TypeScript typechecks pass in both packages
- [x] Lint and format pass
