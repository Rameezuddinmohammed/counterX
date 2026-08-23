# Requirements Document

**Feature:** Counter Platform Foundation  
**Spec:** `counter-platform-foundation`  
**Version:** 3.1  
**Status:** Canonical shared-platform requirements  
**Implementation status:** In Progress; foundation tasks 1–3 have repository implementation, while tasks 4–20 remain Planned  
**Sources:** `PRD.md`, `TRUST-PROTOCOL.md`, `PILOT.md`, `CONFORMANCE.md`

## Introduction

### Scope

The Counter Platform Foundation supplies the shared trust, tenancy, policy, transaction, payment, evidence, and operational primitives used by Counter Merchant and Counter Agent Wallet. It contains no merchant-specific connector behavior or Wallet user experience. Those products depend on these contracts and SHALL NOT fork their semantics.

The first implementation is a strict TypeScript monorepo using Node.js/Fastify, Next.js, PostgreSQL-backed durable workflows/outbox, OpenTelemetry, Docker Compose locally, and an AWS Mumbai deployment target. Exact dependency versions are selected and pinned during scaffolding.

### Goals

- one canonical domain and Counter Trust Protocol implementation;
- separate merchant, Wallet, agent, operator, and environment authorization domains;
- deterministic bilateral policy and exact intent binding;
- at-most-once business effects over at-least-once delivery;
- explicit uncertainty and authoritative resolution;
- non-custodial provider abstractions;
- tamper-evident evidence and audience-scoped receipts;
- portable local/CI deployment and production-like AWS path.

## Glossary

- **CTP:** Counter Trust Protocol.
- **Canonical command:** protocol-neutral typed operation accepted by the shared runtime.
- **Authority context:** verified principal/Wallet/agent mandate and revocation information.
- **Tenant scope:** merchant or Wallet ownership boundary plus environment.
- **Durable workflow:** persisted state machine whose retries survive process failure.
- **Outbox/inbox:** transactional records used for reliable external/event delivery and deduplication.
- **Authoritative evidence:** observation from the declared system of truth for a field or state.
- **Indeterminate:** external effect may have occurred and requires authoritative resolution.

## Requirements

### Requirement 1: Monorepo and module boundaries

**User Story:** As an engineer, I need enforceable boundaries so both products share semantics without becoming an unsafe monolith.

#### Acceptance Criteria

1. THE workspace SHALL use strict TypeScript and one pinned package-manager lockfile.
2. THE workspace SHALL separate deployable applications from domain, CTP, policy, data, workflow, adapter, evidence, observability, and configuration packages.
3. DOMAIN packages SHALL NOT depend on Fastify, Next.js, Shopify, Razorpay, MCP, AWS, or database drivers.
4. ADAPTER packages SHALL depend inward on canonical interfaces; domain packages SHALL NOT import adapters.
5. MODULE-boundary and circular-dependency checks SHALL run in CI.
6. EXACT runtime/dependency versions SHALL be pinned before the first implementation capability is Verified.

### Requirement 2: Identity and tenancy isolation

**User Story:** As a merchant or Wallet owner, I need my identities and data isolated from every unrelated party.

#### Acceptance Criteria

1. THE system SHALL model merchant tenant, Wallet account, registered agent, operator, service, and environment as distinct principals/scopes.
2. EVERY persisted tenant-owned record SHALL carry an immutable owning scope and environment.
3. AUTHORIZATION SHALL be enforced before repository access and SHOULD be reinforced with PostgreSQL row-level security for tenant-owned tables.
4. THE system SHALL isolate database, cache if introduced, queue/job, object, search if introduced, logs, analytics, and support access.
5. CROSS-scope identifiers SHALL not reveal whether an unauthorized resource exists.
6. SANDBOX/pilot/production identities, keys, records, and idempotency scopes SHALL be non-interchangeable.
7. SUPPORT access SHALL be scoped, expiring, reasoned, approved or incident-authorized, and audited.

### Requirement 3: Counter Trust Protocol implementation

**User Story:** As either Counter product, I need one verified trust implementation so authority has identical meaning everywhere.

#### Acceptance Criteria

1. THE system SHALL implement versioned schemas for the CTP envelope and every object required by `TRUST-PROTOCOL.md`.
2. SIGNING and verification SHALL use a pinned canonicalization/digest/Ed25519 profile with cross-implementation fixtures.
3. VERIFICATION SHALL check schema, type/version, signature/key, issuer, subject, audience, environment, validity, nonce/replay, payload digest, and revocation.
4. UNKNOWN critical versions/extensions SHALL fail closed.
5. ORIGINAL external trust artifacts and mapping metadata SHALL be retained as evidence when permitted.
6. PRIVATE agent keys and raw payment credentials SHALL NOT enter hosted CTP services or telemetry.
7. THE implementation SHALL expose `AgentRegistry` and `AuthorityVerifier` interfaces with test implementations for the pilot.

### Requirement 4: Deterministic bilateral policy

**User Story:** As a principal and merchant, I need every action constrained by both sides without a model or adapter widening either side.

#### Acceptance Criteria

1. THE Policy Engine SHALL evaluate typed, versioned rules deterministically.
2. INPUTS SHALL include platform safety, buyer policy/consent, normalized authority, merchant policy, connector capability/freshness, provider constraints, risk result, and transaction state.
3. THE most restrictive applicable result SHALL win.
4. OUTCOMES SHALL be `ALLOW`, `DENY`, or `REVIEW_REQUIRED` with rule IDs and explanation.
5. CUMULATIVE limits SHALL be checked/reserved atomically under concurrency.
6. POLICY errors and missing required evidence SHALL fail closed.
7. A decision SHALL be invalid after any material input/version/revocation/state change.
8. STORED inputs and versions SHALL replay to the same result.

### Requirement 5: Canonical commands and exact binding

**User Story:** As a transaction participant, I need the executed action to be exactly the action that was authorized.

#### Acceptance Criteria

1. EVERY consequential command SHALL bind merchant/environment, Wallet/agent, mandate, operation, item/quantity, quote digest, amount/currency, destination, payment reference, transaction version, and idempotency key as applicable.
2. MATERIAL changes SHALL require a new command digest and renewed intent/approval according to policy.
3. COMMAND schemas SHALL distinguish required, optional, and prohibited data.
4. ALL money SHALL use integer minor units and ISO currency.
5. ALL canonical commands SHALL validate before durable acceptance.
6. NO adapter or model SHALL mutate a validated command after authorization.

### Requirement 6: Durable transaction state and idempotency

**User Story:** As a buyer and merchant, I need retries and crashes to avoid duplicate commercial effects.

#### Acceptance Criteria

1. THE system SHALL persist orchestration and independent reservation, payment, order, fulfillment, and return state.
2. ONLY declared transitions SHALL be accepted with optimistic version checks.
3. EVERY consequential command SHALL have a stable idempotency scope and request digest.
4. IDENTICAL retries SHALL return the recorded result; conflicting reuse SHALL fail without executing.
5. CONCURRENT duplicates SHALL converge to one workflow execution.
6. DURABLE workflow intent and outbox records SHALL commit before external invocation.
7. DOWNSTREAM idempotency/correlation identifiers SHALL remain stable across retries.
8. POSSIBLE unknown effects SHALL become Indeterminate and SHALL NOT be blindly repeated.
9. AUTHORITATIVE query/event evidence SHALL be required to resolve Indeterminate state.

### Requirement 7: Reliable jobs and events

**User Story:** As an operator, I need asynchronous work to survive failures and remain observable.

#### Acceptance Criteria

1. THE initial job/outbox/inbox implementation SHALL use PostgreSQL transactions and leases/locking without requiring a separate broker.
2. DELIVERY SHALL be treated as at least once; consumers SHALL deduplicate by stable source/event ID.
3. JOBS SHALL declare attempts, backoff, lease, timeout, dead-letter, and ownership behavior.
4. PROCESS crash and lease expiry SHALL recover work without duplicate business effects.
5. OUTBOUND events SHALL be versioned, signed where declared, data-minimized, replayable, and correlated.
6. OPERATORS SHALL inspect and safely retry/dead-letter eligible work through typed commands, not direct database mutation.
7. A later broker/workflow engine MAY replace transport but SHALL preserve canonical idempotency/state semantics.

### Requirement 8: Non-custodial payment interfaces

**User Story:** As Counter, I need provider-neutral payment composition without becoming a holder of funds or credentials.

#### Acceptance Criteria

1. THE system SHALL define independent `PaymentAuthorization` and `PaymentProvider` interfaces.
2. PAYMENT authorization SHALL expose only opaque references and bounded metadata.
3. PROVIDER adapters SHALL declare account/environment, methods/currencies, lifecycle, idempotency, webhook verification, query, timeout, refund, and limitations.
4. COUNTER SHALL NOT hold, pool, receive, transmit, settle, or internally credit buyer/merchant funds.
5. PAN, CVV, UPI PIN, bank credentials, and equivalent raw secrets SHALL NOT enter storage or telemetry.
6. CONFIRMED payment state SHALL require verified provider API/event evidence.
7. TEST authorization SHALL be visibly test-only and impossible to pass to a live adapter.
8. PROVIDER compatibility SHALL not imply protocol compatibility.

### Requirement 9: Evidence, audit, findings, and receipts

**User Story:** As a participant or auditor, I need reconstructable, tamper-evident outcomes.

#### Acceptance Criteria

1. MATERIAL identity, authority, policy, workflow, adapter, provider, approval, finding, remediation, and support actions SHALL append audit/evidence records.
2. EVIDENCE SHALL record source, observation method/time, source ID/version, digest, classification, retention, and canonical claim.
3. AUDIT/evidence corrections SHALL append and reference prior records rather than rewrite them.
4. THE system SHALL detect protected-history tampering and mark affected evidence untrusted.
5. FINDINGS SHALL include type, severity, objects, evidence, owner, permitted remediation, status, and resolution evidence.
6. COMPENSATION SHALL be typed, idempotent, policy-authorized, prerequisite-checked, and bounded.
7. RECEIPTS SHALL be signed, audience-scoped, data-minimized, independently verifiable, and superseding rather than mutable.
8. MERCHANT and Wallet views SHALL commit to the same canonical transaction/state digest without cross-party leakage.

### Requirement 10: Security and secrets

**User Story:** As a platform operator, I need secure defaults before external systems or money-like effects are connected.

#### Acceptance Criteria

1. SECRETS SHALL use local environment/secret files excluded from Git and managed AWS Secrets Manager/KMS references in deployed environments.
2. THE repository SHALL contain examples/placeholders only, never real credentials.
3. DATA SHALL be encrypted in transit and at rest.
4. PRIVILEGED operations SHALL require MFA/step-up through the selected identity provider and SHALL be audited.
5. INPUTS SHALL be protected against injection, SSRF, unsafe redirects, oversized payloads, and replay according to boundary.
6. DEPENDENCY, source, secret, container, and infrastructure scans SHALL run before pilot release.
7. THREAT models SHALL cover trust, recovery, support, payment, connector, and cross-tenant boundaries.
8. SECURITY-sensitive comparison and verification SHALL use approved constant-time/cryptographic libraries where applicable.

### Requirement 11: Privacy and retention

**User Story:** As a user or merchant, I need Counter to minimize and control personal/commercial information.

#### Acceptance Criteria

1. DATA SHALL be classified by purpose, owner, residency, retention, and deletion rule.
2. CROSS-side data sharing SHALL be minimized to the authorized transaction purpose.
3. LOGS, traces, metrics, events, receipts, analytics, fixtures, and support tools SHALL redact secrets/restricted data.
4. EXPORT, correction where applicable, closure, and deletion/anonymization SHALL be typed and audited.
5. RETENTION SHALL preserve only evidence required for security, dispute, contract, or law after closure.
6. PRODUCTION-like data flows SHALL be documented for applicable Indian DPDP obligations before cohort release.

### Requirement 12: APIs and errors

**User Story:** As an adapter/client engineer, I need stable contracts that do not leak internals or misstate outcomes.

#### Acceptance Criteria

1. CONTROL and runtime APIs SHALL be separate logical boundaries with versioned OpenAPI/JSON Schema contracts.
2. REQUESTS SHALL carry correlation, actor, environment, intent, and idempotency context as applicable.
3. ERRORS SHALL be typed as validation, authentication, authorization, policy denial, conflict, stale, review-required, unavailable, retryable, Indeterminate, or internal.
4. NO error or response SHALL expose secrets, existence of unauthorized resources, or stack traces.
5. `REVIEW_REQUIRED` and Indeterminate SHALL be structured states, not success strings.
6. EXTERNAL adapters SHALL map errors without inventing unsupported standard values.

### Requirement 13: Observability and recovery

**User Story:** As an operator, I need to identify, contain, and recover failures without unsafe data editing.

#### Acceptance Criteria

1. OpenTelemetry-compatible traces, structured logs, metrics, and health/readiness signals SHALL span API, workflow, adapter, and evidence boundaries.
2. TELEMETRY SHALL include correlation and safe scope identifiers but SHALL exclude credentials and unnecessary personal data.
3. ALERTS SHALL cover errors, latency, job/outbox age, dead letters, policy anomalies, Indeterminate age, reconciliation lag, and integrity failure.
4. BACKUP, point-in-time restore, job/event replay, key rotation, and incident procedures SHALL be exercised before pilot release.
5. SERVICE status SHALL distinguish Counter, merchant-system, provider, and configuration failures.
6. NORMAL remediation SHALL use typed commands and SHALL NOT require direct production database edits.

### Requirement 14: Local and AWS deployment

**User Story:** As an engineer, I need reproducible local development and a production-like India deployment path.

#### Acceptance Criteria

1. LOCAL dependencies SHALL start reproducibly with Docker Compose and documented non-secret configuration.
2. APPLICATIONS SHALL run without cloud credentials in local/test mode.
3. THE intended pilot deployment SHALL target AWS `ap-south-1` using managed PostgreSQL, object storage, secrets/KMS, container runtime, load balancing, and telemetry components selected in design.
4. INFRASTRUCTURE SHALL be defined as code before the private cohort release.
5. SANDBOX/pilot/production configuration and data SHALL be isolated.
6. DEPLOYMENTS SHALL support migration checks, health gates, rollback, and immutable build identification.
7. CLOUD-provider details SHALL remain behind platform interfaces where portability has practical value.

### Requirement 15: Verification gates

**User Story:** As a release owner, I need evidence that shared invariants hold before either product depends on them.

#### Acceptance Criteria

1. CI SHALL run formatting, lint, type, unit, property, integration, migration, security, and contract checks appropriate to changed packages.
2. THE CTP cross-implementation fixture suite SHALL pass before trust objects are Verified.
3. ISOLATION, policy-bound, idempotency, state convergence, payment truth, non-custody, no-secret, and receipt invariants SHALL have automated evidence.
4. RELEASE artifacts SHALL identify commit, build, schemas, migrations, dependencies, environment, tests, limitations, rollback, and owner.
5. NO shared capability SHALL become Released solely because a schema or happy-path test passes.
6. PILOT release SHALL satisfy all applicable gates in `PILOT.md`.
