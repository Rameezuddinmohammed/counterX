# Design Document

> **RETIRED — historical planning artifact.** Written during early feature planning, before implementation. `CLAUDE.md`'s own source-of-truth hierarchy already marks `.kiro/specs/**/tasks.md` as stale for completion status; this applies to this whole spec bundle. For current, verified state, see `HANDOFF.md` and `README.md`.


**Feature:** Counter Platform Foundation  
**Version:** 3.1  
**Status:** Executable design; implementation In Progress with foundation tasks 1–3 complete  
**Requirements:** `.kiro/specs/counter-platform-foundation/requirements.md`

## Overview

The foundation is a modular TypeScript platform shared by Counter Merchant and Counter Agent Wallet. It implements canonical semantics once and exposes them through product-specific applications and external adapters. The first deployment favors a small operational footprint—PostgreSQL-backed workflows and a few deployable processes—while retaining strict package and trust boundaries.

### Approved decisions

| Concern | Decision |
|---|---|
| Language/workspace | Strict TypeScript, pnpm workspaces, one lockfile |
| APIs | Node.js + Fastify, OpenAPI/JSON Schema |
| Web | Next.js merchant and Wallet consoles |
| Persistence | PostgreSQL; migrations owned by data package |
| Async | Transactional outbox/inbox + PostgreSQL leased jobs initially |
| Telemetry | OpenTelemetry-compatible traces/metrics/log correlation |
| Local | Docker Compose; no cloud credentials required |
| Pilot cloud | AWS Mumbai (`ap-south-1`), containerized apps + managed services |
| Wallet signer | Local MCP process; OS-protected key storage behind interface |
| Hosted Wallet | Policy, public keys, mandates/references, ledger, receipts; no private key/funds |
| Payments | Separate authorization/provider ports; Razorpay test adapter later |
| Architecture style | Modular monolith/packages first; split deployables by trust/latency boundary |

Task 1 pinned the package versions, canonical JSON algorithm, crypto library, migration/test tooling, and infrastructure-as-code tool in `engineering-baseline.yaml`, the lockfile, and accepted ADRs. The CTP JSON Schema dialect remains a Gate A selection and must be recorded before task 6 publishes schemas.

## Architecture

```text
Merchant Console       Wallet Console        Local MCP Signer
      │                       │                    │
      └──────────┬────────────┘                    │ signed artifacts
                 ▼                                 ▼
          Control Plane API                 Agent Runtime API
                 │                                 │
                 ├──────── Canonical Commands ─────┤
                 ▼                                 ▼
      ┌────────────────────────────────────────────────────┐
      │ Domain + CTP + Authorization + Bilateral Policy   │
      │ Transaction State + Idempotency + Workflow Ports  │
      └────────────────────────────────────────────────────┘
                 │                   │
           PostgreSQL          Worker processes
       state/outbox/inbox      adapters/reconcile
                 │                   │
                 └──── Evidence / Receipt Signer ──┐
                                                   ▼
                                    Shopify / Razorpay test
```

### Deployable applications

```text
apps/
  control-plane-api/   merchant and Wallet configuration; no runtime bypass
  agent-runtime/       latency-sensitive discovery/quote/transaction commands
  worker/              outbox/jobs, adapters, reconciliation, receipt issuance
  merchant-console/    Next.js Merchant UI
  wallet-console/      Next.js Wallet UI
  operations-console/  separately authorized operator UI over typed control APIs
  local-mcp/           local tool server and signer boundary
  reference-buyer/     deterministic Native client and scenario harness
  reference-services/  local REST merchant/provider fixtures only
```

The pilot may package APIs/workers into fewer containers, but logical boundaries and separate entry points remain. Console server code cannot directly mutate domain tables; it invokes API application services.

### Shared packages

```text
packages/
  domain/              entities, value objects, state transitions, errors
  contracts/           versioned API/event/command schemas
  trust-protocol/      CTP schemas, canonicalization, signing, verification
  authorization/       scope checks, AgentRegistry/AuthorityVerifier ports
  policy/              deterministic rules, cumulative limits, decisions
  workflow/            state machine, idempotency, outbox/inbox, leased jobs
  data/                PostgreSQL repositories, migrations, RLS/session scope
  evidence/            evidence ledger, findings, reconciliation, receipts
  connector-sdk/       merchant connector ports and contract harness
  payment-sdk/         PaymentAuthorization/PaymentProvider ports and harness
  observability/       telemetry, redaction, health, audit helpers
  config/              typed environment configuration and secret references
  testkit/             factories, clocks, IDs, fixtures, invariant harnesses
```

Dependency direction is applications/adapters → application services → domain ports/domain. Infrastructure never leaks into domain types.

## Components and Interfaces

### Identity and scope

`ActorContext` contains actor type/ID, merchant or Wallet scope if applicable, environment, assurance, roles/permissions, support grant, and correlation. Repository calls require an explicit context; no ambient “admin mode” exists.

Tenant-owned primary keys use non-sequential public IDs. Tables include `environment` and ownership columns. PostgreSQL transactions set scoped session claims used by row-level policies. Background jobs carry and re-establish the exact scope.

### Canonical IDs and clocks

- IDs are generated through an injectable `IdGenerator`.
- Time comes from an injectable UTC `Clock` for deterministic tests.
- Public IDs do not encode PII or sequential tenant activity.
- External IDs are stored with provider/source namespace and never used as sole authorization.

### Money and quantities

`Money { amountMinor: bigint, currency: ISO4217 }`; arithmetic validates matching currency and overflow. JSON transports integer minor units as decimal strings if runtime/schema interoperability requires it. Quantities use decimal strings plus unit.

## Counter Trust Protocol

The `trust-protocol` package owns schemas/types for:

- envelope;
- agent registration/key record;
- buyer policy reference;
- principal consent attestation with explicit assurance class;
- mandate/normalized authority;
- merchant quote;
- purchase intent;
- approval and revocation;
- payment authorization reference;
- policy decision;
- canonical transaction-state vector;
- evidence/finding;
- transaction receipt.

### Signing pipeline

```text
schema validate
  → canonicalize unsigned envelope
  → hash payload/canonical bytes
  → sign with selected Ed25519 key
  → serialize immutable artifact
```

Verification reverses the pipeline and additionally checks issuer/subject/audience/environment/time/nonce/revocation/key status. Replay state is persisted transactionally for consequential objects. Public deterministic fixture vectors are generated from fixed test keys and clocks; production keys never appear in fixtures.

Counter service signing uses a dedicated signer port. Locally it uses an encrypted development key. AWS uses a narrowly scoped signing service with encrypted key material protected by KMS/Secrets Manager unless a directly compatible managed signing primitive is selected and evidenced. Agent signing remains local through `SecureKeyStore`.

## Authorization and policy

### Ports

```ts
interface AgentRegistry {
  resolve(agentId: string, environment: Environment): Promise<AgentRecord>;
  isKeyActive(agentId: string, kid: string, at: Instant): Promise<boolean>;
}

interface AuthorityVerifier {
  verify(input: AuthorityInput): Promise<VerifiedAuthority | AuthorityFailure>;
}

interface PaymentAuthorization {
  resolve(reference: string, context: PaymentAuthContext): Promise<ResolvedPaymentAuthorization>;
}

type PaymentOperationResult =
  | { kind: "confirmed"; evidence: ProviderPaymentEvidence }
  | { kind: "action_required"; action: HostedPaymentAction; expiresAt: Instant }
  | { kind: "pending"; reference: ProviderReference }
  | { kind: "declined"; reason: ProviderDecline }
  | { kind: "indeterminate"; reference: ProviderReference; queryAfter: Instant };

interface PaymentProvider {
  capabilities(context: ProviderContext): Promise<ProviderCapabilities>;
  createInstruction(command: CreatePaymentInstruction): Promise<PaymentOperationResult>;
  verifyClientReturn(input: RawClientReturn): Promise<UntrustedOrVerifiedReturn>;
  authorize?(command: AuthorizePayment): Promise<PaymentOperationResult>;
  capture?(command: CapturePayment): Promise<PaymentOperationResult>;
  void?(command: VoidPayment): Promise<PaymentOperationResult>;
  query(reference: ProviderReference): Promise<ProviderPaymentEvidence>;
  refund(command: RefundCommand): Promise<PaymentOperationResult>;
  queryRefund(reference: ProviderRefundReference): Promise<ProviderRefundEvidence>;
  verifyWebhook(input: RawWebhook): Promise<VerifiedProviderEvent>;
}
```

Ports return typed results including hosted action, pending, decline, confirmed evidence, and Indeterminate outcomes; they do not throw unclassified provider errors across the application boundary. Unsupported optional lifecycle methods are absent from `ProviderCapabilities` and cannot be invoked. Callback verification authenticates the returned correlation/signature where supported but does not itself establish captured/paid truth; authoritative query or verified provider event remains required. Provider/environment, capture mode, idempotency, query identity, and refund-query behavior are frozen per adapter profile.

Authority verification preserves the declared assurance class. A Counter Wallet service-witnessed principal-consent attestation SHALL NOT satisfy a rule requiring a direct principal/WebAuthn/external-protocol signature. This non-inflation rule survives normalization, policy, receipt, API, and UI projections and is covered by negative tests.

### Policy evaluation

Policy inputs are immutable snapshots. Rules return constraints and outcomes; an intersection reducer selects the most restrictive result. Amount/count rolling limits use a PostgreSQL transaction with a limit-bucket row lock or equivalent serializable strategy. An allowed decision includes a short validity and material-input digest.

The execution service revalidates decision freshness and revocation immediately before writing durable workflow intent. Policy never calls models.

## Transaction and workflow design

### Aggregate

`Transaction` stores orchestration phase plus reservation/payment/order/fulfillment/return sub-state, immutable intent/quote/authority references, current version, and unresolved finding count. Legal transitions live in pure domain functions.

### Command sequence

```text
Authenticate and scope
→ validate canonical command
→ verify agent/authority/revocation
→ load merchant capability + quote
→ atomically evaluate/reserve buyer and merchant bounds
→ create policy decision
→ insert transaction/workflow/idempotency/outbox in one DB transaction
→ worker leases action
→ invoke typed adapter with stable downstream idempotency
→ persist observation/inbox/evidence and state transition
→ query authoritative source if ambiguous
→ reconcile and issue receipt
```

### Idempotency

Key identity includes environment, caller scope, operation, and supplied key. Stored material-request digest prevents key reuse with changed data. A unique constraint owns execution. Responses are replayed from a safe response snapshot. Idempotency retention is capability-configured and not shorter than provider retry/reconciliation windows.

### PostgreSQL jobs

`jobs` rows contain type, payload reference, scope, status, available time, lease owner/expiry, attempt/max, last error class, and correlation. Workers claim using `FOR UPDATE SKIP LOCKED`, renew bounded leases, and apply exponential backoff. Business idempotency—not the lease—prevents duplicate effects.

`outbox_events` commit beside aggregate changes. `inbox_events` have unique source/event IDs. Dispatch is at least once. Dead-letter is a status with owner and typed retry command, not a separate opaque store.

## Data Models

Logical schemas:

- `identity`: actors, roles, support grants, agent public keys;
- `merchant`: tenant references and capability metadata;
- `wallet`: Wallet references, policy/mandate/revocation metadata;
- `runtime`: quotes, transactions, sub-states, idempotency, limit buckets;
- `workflow`: jobs, outbox, inbox, attempts;
- `payment`: opaque authorization/provider references and observations;
- `evidence`: evidence, claims, findings, receipt metadata, audit chain;
- `platform`: schema/version, keys, configuration, release evidence.

Sensitive documents are separated from searchable metadata. Object storage holds encrypted large artifacts/exports by opaque key and digest; database rows retain ownership/classification/retention. No raw payment credential or agent private key has a column.

Migrations are forward-safe, reviewed, and tested from empty and previous supported schema. Destructive changes use expand/migrate/contract.

## Evidence, reconciliation, and receipts

Each adapter observation becomes immutable source-labelled evidence. Reconciliation functions compare normalized views without mutating source evidence. Findings have explicit ownership/state. Compensation uses a registry of typed commands and prerequisite predicates.

Receipt generation consumes a stable transaction snapshot plus evidence/audit commitment. Audience projection occurs before signing each view; both views include the same canonical transaction digest. Receipt verification is a dependency-free library/CLI path using published Counter keys.

## Error Handling

### API contracts

- `/control/v1/...`: configuration, enrollment, policy, keys, activation, support grants.
- `/runtime/v1/...`: discovery, quote, intent/checkout, transaction status, receipt.
- `/internal/v1/...`: service-to-service only, mTLS/service identity in deployed environments.
- `/webhooks/v1/{adapter}/...`: raw-body-preserving verified ingress.

Fastify route schemas are generated/imported from `contracts`; runtime validation and response serialization are mandatory. API application services receive `ActorContext` and never trust body-supplied ownership.

Errors use stable codes and safe details. `409` represents version/idempotency conflict, `422` policy/semantic refusal where appropriate, `202` structured pending/Indeterminate processing, and exact mappings are frozen in API contracts. External adapters map according to their profile rather than blindly copying HTTP codes.

## Local signer and secure key storage

`local-mcp` consists of:

- MCP transport adapter;
- local authorization/session UI or browser handoff;
- `SecureKeyStore` port;
- CTP signing client;
- hosted Wallet API client;
- tool policy enforcing a hard denylist for policy/key/payment-secret mutation.

The foundation owns the `SecureKeyStore` port, assurance vocabulary, and conformance harness; Counter Agent Wallet owns platform adapters and packaging. The first Wallet adapter targets Windows protected credential/key facilities selected at Gate A, followed by macOS Keychain/Linux Secret Service before broader release. Naming an OS facility is not evidence of non-exportable Ed25519 operations: if an implementation cannot guarantee the declared protected/non-exportable assurance, registration at that assurance fails and the limitation is shown. The model receives signed artifact IDs, never key bytes.

## Security design

Trust boundaries: public runtime, authenticated control plane, local signer, worker egress, webhook ingress, PostgreSQL, object storage, support plane, external merchant/provider.

Controls include:

- deny-by-default authorization;
- short-lived sessions/service credentials;
- scoped support grants;
- signature/replay verification;
- webhook raw-body signature verification before parsing effects;
- egress allowlists in connector workers;
- strict URL/DNS resolution protections;
- data classification/redaction at source;
- key rotation and revocation;
- content-size/rate limits;
- immutable audit chain/checkpoints;
- dependency/secret/container/IaC scanning.

## Observability and operations

Trace context propagates through HTTP, jobs, outbox, and adapters. Logs are structured with safe IDs. Metrics include API SLI, job age/attempt, outbox lag, policy outcomes, authority failures, transaction/sub-state counts, Indeterminate age, provider/connector errors, reconciliation lag, findings, and receipt signing failures.

`operations-console` is a separately authorized Next.js surface over typed control-plane/operator APIs, even when deployed with another console. It exposes fleet/dependency health, incidents, queues/dead letters, previewed replay/reconciliation, adapter release status, kill switches, and scoped support sessions. It never receives an ambient cross-tenant browser role; every content access requires an expiring support grant, step-up where applicable, purpose, scope, and audit.

Operator actions use APIs/commands with preview, authorization, reason, and audit. Emergency kill switches are configuration records evaluated server-side for platform, merchant, Wallet, agent, mandate, connector, and payment adapter scopes.

## Deployment

### Local/CI

Docker Compose runs PostgreSQL and optional telemetry collector. Apps run as local Node processes or containers. Reference Shopify/payment services are fixtures only and visibly test-scoped. Secrets come from ignored local environment files; `.env.example` contains names and safe defaults.

### AWS pilot target

- container images in ECR;
- ECS Fargate services/tasks for APIs/workers/consoles or equivalent approved container runtime;
- Application Load Balancer and WAF for public boundaries;
- RDS PostgreSQL Multi-AZ configuration appropriate to pilot risk;
- S3 for encrypted evidence/export artifacts;
- Secrets Manager and KMS;
- OpenTelemetry collector exporting to selected AWS/portable backend;
- Route 53/ACM for DNS/TLS;
- private subnets/security groups and controlled worker egress;
- infrastructure as code and immutable build tags.

No AWS access is required for local phases. Region/cost topology is reviewed before deployment.

## Correctness Properties

### Property 1: Shared invariant preservation

**Validates: Requirements 15.3**

The executable foundation properties are scope/environment isolation, assurance non-inflation, bilateral non-circumvention, exact material binding, at-most-one business effect, explicit uncertainty, provider-only payment truth, non-custody, append-only evidence, audience equivalence, and crash/replay convergence. Each property is tied to requirement 15 and must have automated falsification evidence before a dependent capability is Verified.

## Testing Strategy

- pure unit/property tests for value objects, transitions, policy intersections, canonicalization;
- cross-runtime crypto fixtures;
- repository/RLS/migration integration tests against real PostgreSQL;
- concurrent idempotency and rolling-limit tests;
- process-kill/work-lease recovery tests;
- outbox/inbox duplicate/reorder convergence;
- fake adapters for success/decline/timeout/unknown effects;
- no-secret scans over DB/log/job/event/fixture output;
- API contract and unauthorized existence-leak tests;
- audience receipt and independent verifier tests;
- Docker Compose smoke test;
- later Shopify/Razorpay sandbox integration tests owned by product specs.

Tests use deterministic clocks/IDs, synthetic identities, and integer money. No production credential or personal data appears in fixtures.

## Requirement traceability

| Requirement | Design components |
|---|---|
| 1 | workspace/apps/packages and dependency rules |
| 2 | ActorContext, RLS, scoped repositories/jobs |
| 3 | trust-protocol, signer/verifier, test registry |
| 4 | policy engine and atomic limit buckets |
| 5 | contracts, command digest and material binding |
| 6–7 | transaction aggregate, idempotency, jobs/outbox/inbox |
| 8 | payment-sdk ports and non-custodial storage model |
| 9 | evidence ledger, findings, compensation, receipts |
| 10–11 | secrets, threat boundaries, classification/retention |
| 12 | Fastify boundaries, schemas, typed errors |
| 13 | OpenTelemetry, runbooks, typed operator commands |
| 14 | Docker Compose and AWS target topology |
| 15 | CI, invariant suites, release evidence |

## Implementation decision status

Task 1 resolved and recorded:

- exact Node.js, pnpm, TypeScript, application, persistence, and quality-tool versions in `engineering-baseline.yaml` and the lockfile;
- RFC 8785 canonical JSON, SHA-256, Ed25519, and key encoding in ADR-0002;
- OpenTofu, the AWS provider, target region, and target managed services in ADR-0009.

The remaining Gate A engineering selections are implementation details, not product ambiguity:

1. exact CTP JSON Schema dialect;
2. local OS secure-store implementation and evidenced assurance per platform;
3. pilot identity provider for human login/step-up;
4. telemetry backend;
5. exact AWS topology and cost controls before cloud deployment.

Each remaining decision is recorded before its dependent task and cannot weaken the normative documents.