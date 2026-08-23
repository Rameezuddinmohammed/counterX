# ADR-0004: Start durable workflows on PostgreSQL

- **Status:** Accepted
- **Date:** 2025-02-15
- **Requirements:** 1, 14, 15

## Decision

PostgreSQL 17.4 is the initial durable system for transaction state, idempotency, workflow intent, outbox, inbox, and jobs. Consequential state, idempotency ownership, workflow intent, and outbox events commit in one transaction. Workers claim rows with `FOR UPDATE SKIP LOCKED`, bounded leases, retry backoff, and stable downstream correlation IDs. Delivery is at least once; business effects are protected by idempotency and authoritative reconciliation.

Migrations are owned by the `data` package using `drizzle-kit@0.30.4` and `drizzle-orm@0.39.3`. They are forward-safe and use expand/migrate/contract for destructive changes.

Migration and runtime database authority are separate. The migration owner must own the application schemas and must be `SUPERUSER` or `BYPASSRLS` while installing the fixed-search-path `SECURITY DEFINER` policy helpers used with forced RLS; that credential is never an application runtime credential. A runtime role must be a distinct `LOGIN NOSUPERUSER NOBYPASSRLS NOINHERIT` role, must not be a member of any superuser/BYPASSRLS role, must receive only explicit schema/table/sequence/function grants, and must not own protected relations. `ScopedTransactionManager` checks this posture on the checked-out session before setting transaction-local claims and fails closed otherwise.

## Consequences

The first pilot needs no message broker. A later broker or workflow engine may replace transport only while preserving canonical state and idempotency semantics.
