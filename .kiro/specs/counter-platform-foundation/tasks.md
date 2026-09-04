# Implementation Plan

> **RETIRED — historical planning artifact.** Written during early feature planning, before implementation. `CLAUDE.md`'s own source-of-truth hierarchy already marks `.kiro/specs/**/tasks.md` as stale for completion status; this applies to this whole spec bundle. For current, verified state, see `HANDOFF.md` and `README.md`.


**Feature:** Counter Platform Foundation  
**Version:** 3.1  
**Status:** Planned task sequence  
**Requirements:** `.kiro/specs/counter-platform-foundation/requirements.md`  
**Design:** `.kiro/specs/counter-platform-foundation/design.md`

## Overview

> Tasks are ordered dependencies. A checked task requires implementation plus the stated validation evidence. Do not mark protocol/provider behavior Verified from fixtures alone.

## Task Dependency Graph

Tasks execute in numeric order by default. Tasks 6–17 consume the scaffold, primitives, and persistence established by tasks 1–5; task 18 integrates the local stack; task 19 follows Gate A and approved AWS access; task 20 certifies all preceding foundation work.

## Notes

- Foundation packages own shared semantics; Merchant and Wallet tasks consume rather than fork them.
- A checked task includes both implementation and every validation item stated by that task.
- External-provider and protocol status remains Planned until its exact evidence gate passes.

## Tasks

- [x] 1. Pin the engineering baseline and create architecture decisions
  - Select and pin Node.js, pnpm, TypeScript, Fastify, Next.js, PostgreSQL, schema, migration, test, lint/format, crypto/canonicalization, OpenTelemetry, Docker, and IaC tooling.
  - Record ADRs for module boundaries, CTP canonicalization, IDs/time, PostgreSQL workflows, RLS scope, signing keys, local secure storage, identity provider boundary, and AWS target.
  - Create a compatibility/dependency manifest and supported development prerequisites.
  - _Requirements: 1, 3, 10, 14, 15_

- [x] 2. Scaffold the strict TypeScript monorepo
  - Create approved `apps/*` and `packages/*` skeletons with shared compiler configuration and one lockfile.
  - Enforce dependency direction, circular-import checks, formatting, lint, typecheck, test, build, and package exports.
  - Add safe `.gitignore`, `.env.example`, configuration validation, and secret-detection hooks/checks.
  - Add CI workflow definitions without requiring cloud credentials.
  - Validate a clean clone/install/build/test path.
  - _Requirements: 1, 10, 15_

- [x] 3. Establish local infrastructure and database lifecycle
  - Add Docker Compose PostgreSQL and optional OpenTelemetry collector.
  - Implement typed configuration and local/test environment separation.
  - Create migration tooling, schema-version table, empty/upgrade/rollback-compatible migration tests, and seed fixtures containing synthetic data only.
  - Implement backup/restore scripts for local validation without embedding credentials.
  - _Requirements: 2, 10, 11, 13, 14, 15_

- [x] 4. Implement canonical primitives
  - Implement IDs, UTC clock, environment, actor/scope, `Money`, decimal quantity, digests, typed results, and canonical errors.
  - Add property tests for arithmetic, serialization, overflow, currency mismatch, time, and ID behavior.
  - Ensure domain packages have no framework/infrastructure imports.
  - _Requirements: 1, 5, 12, 15_

- [ ] 5. Implement identity, tenancy, and scoped persistence
  - Create actor, role, merchant scope, Wallet scope, agent public-key, service identity, and support-grant schemas/repositories.
  - Implement `ActorContext`, deny-by-default authorization, scoped transaction helpers, and PostgreSQL RLS/session scope.
  - Test merchant↔merchant, Wallet↔Wallet, merchant↔Wallet, operator/support, guessed-ID, job, and environment isolation.
  - _Requirements: 2, 10, 11, 15_

- [ ] 6. Implement Counter Trust Protocol schema package
  - Create versioned JSON Schemas/types for every CTP 0.1 object and common envelope.
  - Implement deterministic canonicalization, digest, Ed25519 signing/verification, key records, issuer/subject/audience/environment/time checks, and critical extension behavior.
  - Publish deterministic fixtures from fixed test keys and verify them through an independent implementation/path.
  - Add malformed, algorithm-downgrade, wrong-key, wrong-audience/environment, expiry, and altered-payload tests.
  - _Requirements: 3, 10, 15_

- [ ] 7. Implement registry, nonce, replay, revocation, and assurance services
  - Define `AgentRegistry` and `AuthorityVerifier` ports.
  - Implement `CounterTestAgentRegistry` and CTP authority verification.
  - Persist nonce/replay consumption and monotonic key/agent/mandate/payment-reference revocation.
  - Preserve assurance class through normalized authority, policy decisions, receipts, APIs, and UI projections.
  - Test proof of possession, rotation, revocation races, replay under concurrency, historical evidence, and assurance non-inflation: a Wallet-service-witnessed attestation must fail a rule requiring direct principal/WebAuthn/external proof.
  - _Requirements: 3, 4, 5, 15_

- [ ] 8. Implement deterministic bilateral policy
  - Define typed platform, buyer, mandate, merchant, connector, provider, risk, and state constraints.
  - Implement intersection reduction and `ALLOW`/`DENY`/`REVIEW_REQUIRED` decisions with rule IDs/explanations.
  - Implement atomic rolling amount/count/quantity limit reservation and release semantics.
  - Add replay, precedence, boundary, missing-evidence, evaluation-error, and high-concurrency property tests.
  - _Requirements: 4, 5, 15_

- [ ] 9. Implement canonical command and transaction state package
  - Define immutable command schemas/material digests and transaction state vector.
  - Implement legal transition functions and optimistic aggregate versions.
  - Bind authority, policy, quote, payment reference, destination, and idempotency context.
  - Add exhaustive legal/illegal transition and material-change tests.
  - _Requirements: 5, 6, 12, 15_

- [ ] 10. Implement idempotency, inbox/outbox, and PostgreSQL jobs
  - Create idempotency, workflow intent, outbox, inbox, job, attempt, and dead-letter tables/repositories.
  - Implement unique ownership, request-digest conflicts, response replay, `SKIP LOCKED` leasing, lease renewal/expiry, backoff, and stable downstream correlation.
  - Test concurrent duplicates, crashes at each durable boundary, event duplication/reordering, worker takeover, and poison jobs.
  - _Requirements: 6, 7, 13, 15_

- [ ] 11. Implement payment abstraction, test authorization, and deterministic test provider
  - Define `PaymentAuthorization` and a capability-declared `PaymentProvider` port covering instruction/action-required, client-return verification, optional authorize/capture/void, authoritative query, refund/query-refund, verified webhook, and typed confirmed/pending/declined/Indeterminate results.
  - Specify that a verified browser return is correlation evidence, never captured/paid truth without authoritative provider evidence.
  - Implement `CounterTestAuthorization` with explicit test-only environment enforcement.
  - Implement `CounterTestPaymentProvider` for deterministic unattended pilot simulation and make live/provider environments reject it.
  - Add the provider contract harness for action-required, success, decline, timeout-before-effect, timeout-after-effect, query resolution, duplicate/reordered event, capture/void capability behavior, and refund/query-refund.
  - Add no-raw-credential schema and telemetry tests.
  - _Requirements: 5, 8, 10, 15_

- [ ] 12. Implement evidence, audit, reconciliation, and findings
  - Create append-only evidence/audit schemas, integrity chain/checkpoints, source normalization, claims, reconciliation functions, and finding lifecycle.
  - Implement typed compensation registry with policy/prerequisite/idempotency requirements.
  - Test tampering, conflicting sources, stale/missing evidence, false claims, failed compensation, and source-specific authority.
  - _Requirements: 9, 11, 13, 15_

- [ ] 13. Implement signed receipts and independent verifier
  - Generate canonical transaction commitments and audience-scoped Merchant/Wallet receipt projections.
  - Sign, publish key references, verify, supersede, and retain immutable receipt history.
  - Build a dependency-light verifier library/CLI path.
  - Test redaction, wrong audience/key/digest, cross-view canonical equivalence, and supersession.
  - _Requirements: 3, 9, 11, 15_

- [ ] 14. Implement control/runtime API foundations
  - Create Fastify application shells, schema-first routes, authentication/actor middleware, scope enforcement, correlation, idempotency, error mapping, health/readiness, and raw webhook ingress.
  - Separate control, runtime, internal, and webhook boundaries.
  - Generate OpenAPI artifacts and contract-test validation/error/no-existence-leak behavior.
  - _Requirements: 2, 5, 10, 12, 13, 15_

- [ ] 15. Implement observability, Operations Console, and safe operations
  - Add OpenTelemetry traces/metrics, structured redacted logs, job/outbox/transaction/policy/evidence metrics, and dependency health.
  - Build the separately authorized `operations-console` shell over typed operator APIs for fleet/dependency health, incidents, queues/dead letters, previewed replay/reconciliation, adapter release status, kill switches, and scoped support sessions.
  - Implement typed operator commands with authorization, step-up where applicable, expiring support grants, reason/purpose/scope, preview, and audit.
  - Define initial alerts and runbooks; test no ambient cross-tenant access and telemetry for secret/PII leakage.
  - _Requirements: 2, 7, 9, 10, 11, 13, 15_

- [ ] 16. Implement privacy, export, retention, and closure primitives
  - Add data classification/retention metadata and cross-side disclosure projections.
  - Implement typed scoped export, deletion/anonymization scheduling, legal/dispute hold, and closure evidence.
  - Test cross-party minimization and retained-evidence rules.
  - _Requirements: 2, 9, 11, 15_

- [ ] 17. Define the local signer security contract and harness
  - Define `SecureKeyStore`, local signing session, device registration, assurance results, and a deterministic in-memory test implementation.
  - Publish a conformance harness covering generation, proof of possession, signing, lock/unlock, rotation, revocation, corrupt/missing storage, recovery lock, prohibited export, and model/tool denial.
  - Make Counter Agent Wallet the sole owner of Windows/macOS/Linux production adapters and packaging.
  - Fail the declared assurance when a selected OS mechanism cannot prove the required protected/non-exportable behavior.
  - _Requirements: 3, 10, 15_

- [ ] 18. Add Docker Compose end-to-end foundation smoke tests
  - Start database/APIs/workers/Operations Console, register synthetic merchant/Wallet/agent, sign/verify authority, evaluate policy, create a durable `CounterTestPaymentProvider` workflow, resolve evidence, and verify receipt.
  - Kill/restart workers at each external-effect boundary and prove convergence/no duplicates.
  - Test operator support-grant scoping and previewed replay without direct database editing.
  - Scan database, jobs, events, logs, traces, and artifacts for prohibited secrets.
  - _Requirements: 2–15_

- [ ] 19. Define, provision, and validate the AWS pilot environment
  - Create IaC modules for network, ECS/container runtime, RDS, S3, Secrets Manager/KMS, load balancer/WAF, DNS/TLS, telemetry, backups, and IAM.
  - Add environment isolation, migration/deployment health gates, rollback, cost assumptions, and `ap-south-1` configuration.
  - Validate/plan IaC statically without user credentials during local phases.
  - After Gate A and user-provided AWS access, provision the named pilot environment through approved credentials, deploy an immutable build, and exercise migration, health gate, rollback, backup/restore, secret rotation, network isolation, and teardown/recovery procedures.
  - Store only evidence and resource references in the repository, never cloud credentials.
  - _Requirements: 10, 13, 14, 15_

- [ ] 20. Produce the shared-foundation evidence bundle
  - Run all invariant, security, migration, recovery, contract, assurance-non-inflation, operator-isolation, and no-secret suites.
  - Generate clause-level requirement → design symbol → task → test/evidence traceability for all shared requirements.
  - Record build/commit, dependencies, schemas, migrations, environment, tests, limitations, owners, and rollback.
  - Keep capabilities Planned/In Progress unless the exact Verified gate is met.
  - Confirm Merchant and Wallet designs consume these packages without semantic forks.
  - _Requirements: 15_
