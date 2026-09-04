# Counter v3.1 Delivery Plan

> **RETIRED — historical.** This was the original delivery sequence, written before most of the platform existed. It's superseded by everything that's actually shipped since (see `HANDOFF.md` for current state and `README.md` for the product as built). Kept as a record of the original plan, not as current guidance.



**Document version:** 3.1  
**Status:** Canonical delivery sequence  
**Current state:** Foundation tasks 1–3 have repository implementation; the shared foundation is In Progress, while merchant, Wallet, adapter, protocol, and provider capabilities remain Planned with no external-provider run evidence  
**Target:** Invite-only India retail pilot with test payments

## 1. Purpose

Deliver one narrow, production-like two-sided slice while preserving an architecture that can later support multiple agent interfaces, commerce protocols, trust models, payment rails, merchant backends, verticals, and regions.

The universal adapter strategy is architectural. The first release is intentionally finite. A milestone completes only with repository and environment evidence; code completion or a successful demo is insufficient.

## 2. Delivery principles

1. Build the Counter Trust Protocol and canonical domain model before external adapters.
2. Build Counter Merchant first with a reference buyer harness, then productize the harness as Counter Agent Wallet.
3. Keep merchant and wallet tenancy, keys, policy, and data isolated.
4. Use adapters for interface, commerce, authority, payment, and merchant systems; never conflate their roles.
5. Establish idempotency, explicit indeterminate states, provider truth, and audit before composing external effects.
6. Keep both pilot payment modes test-only: the deterministic Counter test provider for unattended bounded execution and Razorpay Standard Checkout test mode for human-present provider certification.
7. Do not store funds, raw payment credentials, UPI PINs, or agent private keys.
8. Release only capabilities declared in the Pilot Capability Manifest.
9. Preserve honest status and conformance language.
10. Expand capability-by-capability, never by unsupported “universal” claim.

## 3. Pilot release profile

The first releasable profile is:

- India; INR; fixed-price physical retail/apparel;
- operator-invited merchant and buyer cohort;
- Shopify as the merchant transaction connector;
- generic REST as a reference connector and certification fixture, not a second pilot dependency;
- Counter Native API and a constrained MCP tool profile;
- Counter Trust Protocol v0.x objects and Counter test identity/authorization implementations;
- `CounterTestPaymentProvider` for unattended bounded test execution;
- Razorpay Standard Checkout test adapter for human-present provider lifecycle certification;
- discovery, search, product detail, quote, bounded signed intent, policy decision, test payment, Shopify order, status, cancellation/full-refund test path, reconciliation, and signed receipt;
- minimal Merchant Console, Agent Wallet, and Operations Console.

The exact cohort, caps, methods, and enabled operations are frozen in `PILOT.md` before release.

## 4. Workstreams

| Workstream | Owns |
|---|---|
| Trust and Identity | Trust envelopes, keys, mandates, intent, revocation, receipts |
| Platform | repository, CI, environments, tenancy, storage, queues, audit, observability |
| Counter Merchant | activation, Shopify, REST reference, Commerce Graph, merchant policy/console |
| Transaction Runtime | gateway, quote/checkout, state machines, idempotency, orchestration |
| Payments | non-custodial interfaces, Counter test provider, Razorpay Standard Checkout test adapter, webhooks, reconciliation |
| Counter Agent Wallet | enrollment, agent binding, buyer policy, MCP, approvals, timeline |
| Verification | evidence, claims, findings, signed receipts, remediation |
| Security/Privacy/Legal | threat models, data flows, non-custodial boundary, pilot approvals |
| Operations | support, incident handling, kill switches, recovery, pilot metrics |

## 5. Gate 0 — Executable baseline

### Decisions and deliverables

- approve all v3.1 canonical documents;
- initialize Git only with explicit user approval;
- create architecture decision records for tenancy, deployment, eventing, workflow, connector isolation, secrets, key custody, and payment boundaries;
- define Counter Trust Protocol schemas: envelope, identity, mandate, intent, quote binding, decision, evidence, finding, receipt, revocation;
- freeze interfaces: `AuthorityVerifier`, `PaymentAuthorization`, `PaymentProvider`, `AgentRegistry`;
- select runtime stack, repository layout, data store, queue/workflow approach, signing library, and schema tooling;
- obtain Razorpay test credentials and confirm account/method/environment behavior;
- create a Shopify development store and representative apparel catalog;
- pin Shopify, Razorpay, MCP, and cryptographic dependencies/specifications;
- archive ACP/AP2 sources where licensing permits; record NPCI UAP as watch-only and x402 as Deferred;
- define data classification, retention, India data flows, support access, and deletion;
- freeze the Pilot Capability Manifest, cohort, caps, enabled methods, and owners.

### Exit

- no contradiction among canonical documents;
- all pilot capabilities are Planned with an owner and acceptance evidence;
- external source/version is pinned or capability is Deferred;
- test credentials and development store are available;
- legal/security/privacy/payment review approves the test-only non-custodial direction;
- unsupported public claims are absent.

## 6. Phase 1 — Shared trust protocol and secure foundation

### Build

- Counter Trust Protocol schema package and canonical IDs;
- Ed25519 signing/verifying, JWKS-style discovery, rotation, revocation, nonce, expiry, and replay protection;
- `CounterTestAgentRegistry`, `CounterTestAuthorization`, and `AuthorityVerifier` boundary;
- merchant tenant, buyer account/wallet, agent, environment, role, and scoped support models;
- local, CI, sandbox, staging, and production-like configuration separation;
- PostgreSQL, migrations, outbox/inbox, durable jobs/queue, object/evidence storage, KMS/secrets abstractions;
- immutable audit events and signed checkpoints;
- structured logging, redaction, tracing, metrics, health, backups, and restore.

### Required evidence

- merchant-to-merchant, wallet-to-wallet, merchant-to-wallet, operator, and environment isolation;
- signature, issuer/audience, expiry, nonce, replay, key rotation, and revocation tests;
- idempotency under concurrent retries;
- no secrets/private keys/raw payment credentials in data stores or telemetry;
- recovery from process failure around durable intent.

## 7. Phase 2 — Commerce Graph and connectors

### Shopify pilot connector

- OAuth/provider credential reference;
- products, variants, prices, inventory, orders, fulfillment, cancellation, and refund capabilities required by the manifest;
- webhook validation, duplication/reordering, polling/query fallback;
- typed `create_order`, `cancel_order`, and test refund-related actions where supported;
- provenance, freshness, rate limits, idempotency, and version behavior.

### Generic REST reference connector

- versioned manifest;
- read/search/quote and typed action contract;
- synthetic fixtures and local reference server;
- certification harness proving connector abstraction without becoming a pilot launch dependency.

### Exit

- Shopify catalog normalizes with complete pilot provenance;
- stale/outage conditions cannot appear fresh;
- write actions are named, typed, policy-gated, and idempotent;
- the reference connector passes the same applicable contract tests;
- no additional connector is presented as pilot-supported.

## 8. Phase 3 — Counter Merchant activation

### Build

- invite-only merchant organization/environment creation;
- domain, administrator, Shopify store, and Razorpay test-account verification;
- mapping preview and version approval;
- merchant capability and policy setup;
- readiness findings: Blocking, Accepted Limitation, Advisory, Expiring;
- sandbox scenarios for success, denial, stale inventory, duplicate request, delayed webhook, cancellation/refund, and outage;
- capability manifest publication, suspension, kill switch, and offboarding;
- minimal Merchant Console transaction/exception timeline.

### Exit

- only allowlisted merchant/store can activate;
- server-side gates cannot be bypassed through UI/API;
- the manifest advertises only released and healthy pilot capabilities;
- merchant can immediately suspend future consequential actions.

## 9. Phase 4 — Native transaction runtime

### Build

- Native API discovery and capability negotiation;
- search, product detail, current price/availability, immutable quote and digest;
- transaction state vector and legal transitions;
- policy checks, review state, quote expiry/material-change handling;
- optimistic concurrency, request replay protection, stable idempotency;
- durable Shopify order workflow and explicit indeterminate resolution;
- signed status events and safe retry contract.

### Exit

- no reported consequential success without authoritative evidence;
- duplicate/concurrent commands produce at most one business effect;
- timeouts after possible effects become indeterminate;
- state convergence, money arithmetic, and policy properties pass.

## 10. Phase 5 — Test payment-provider lifecycles

### Build

- `PaymentProvider` and `PaymentAuthorization` contracts;
- `CounterTestAuthorization` bound to wallet, intent, merchant, quote, amount/currency, and expiry;
- deterministic `CounterTestPaymentProvider` with test-only environment enforcement, success/decline/timeout/query/refund behavior, and signed evidence;
- Razorpay test order/payment instruction creation as supported by selected Standard Checkout flow;
- structured `PAYMENT_ACTION_REQUIRED` plus hosted human-present test handoff;
- callback verification, verified webhook ingestion, and authoritative state query;
- test decline, timeout, duplicates, reordering, cancellation/refund, and reconciliation;
- provider/merchant/idempotency correlation.

### Exit

- unattended bounded scenarios complete only through the Counter test provider and are labelled test-only;
- every Razorpay displayed payment success is backed by Razorpay test evidence;
- Razorpay checkout requires explicit human action and no OTP/PIN/payment detail is automated;
- redirects, agent claims, and local state cannot mark payment paid;
- Counter is never settlement source/destination and stores no raw credentials;
- duplicate/reordered events converge;
- test authorization/provider cannot enter a live environment;
- Reserve Pay, live UPI, UAP, and real-money authority remain undiscoverable.

## 11. Phase 6 — Reference buyer harness and verification

**Owner:** Counter Merchant delivers `apps/reference-buyer` and its versioned scenario corpus as an independent Native client. Counter Agent Wallet later proves behavioral parity against that corpus. The harness may use only published contracts and test identity/authority setup, never internal service or database shortcuts.

### Build

- deterministic buyer harness that creates signed bounded mandates and intents;
- quote verification and exact digest approval;
- local claim ledger;
- collection of wallet, merchant, provider, and order views;
- canonical findings and typed compensation matrix;
- signed audience-scoped receipts and independent verifier;
- cancellation/full-refund test workflow and manual exception fallback.

### Exit

- harness completes the full test lifecycle without internal service shortcuts;
- false agent success/failure claims are detected;
- mismatches remain visible until evidence-backed resolution;
- receipts independently verify and supersede correctly.

## 12. Phase 7 — Counter Agent Wallet and MCP

### Build

- invite-only wallet enrollment and recovery;
- stable agent URI, local signing key setup, public key registration/rotation/revocation;
- policy UI/API for merchant/domain, India geography, category/SKU, amount/rolling limits, time, operation, and approval threshold;
- mandate creation, bound intent, approval/revocation inbox;
- opaque test payment-authorization reference;
- transaction timeline, claim ledger, findings, receipts, export, deletion/closure;
- constrained MCP tools generated from canonical commands.

### MCP restrictions

MCP tools cannot retrieve keys/payment tokens, change buyer policy, widen limits, add merchants, modify approval thresholds, or claim settlement. Consequential tools require a current policy decision and stable idempotency.

### Exit

- the productized Wallet passes every reference-harness scenario;
- local and server-side policy agree or fail closed;
- revocation blocks future effects under races;
- cross-wallet privacy and recovery takeover tests pass;
- autonomous test transactions work only inside a pre-signed bounded mandate and through `CounterTestPaymentProvider`;
- Razorpay transactions surface `PAYMENT_ACTION_REQUIRED` and never claim unattended execution.

## 13. Phase 8 — Two-sided private pilot readiness

### Build/evidence

- complete `PILOT.md` Gates A through D, with Gate D providing the named-cohort release approval rather than widening capability;
- allowlists, caps, kill switches, daily reconciliation, manual exception queue;
- support owners, incident severity, runbooks, status communication, refund/dispute handoff;
- load, dependency failure, queue backlog, backup/restore, replay, key rotation, and offboarding exercises;
- security/privacy review of merchant-wallet data sharing;
- release evidence bundle tied to build, environment, schema, connector, and provider versions.

### Exit

- no unresolved critical/high security or payment finding;
- all pilot success criteria in `PRD.md` have linked evidence;
- product, engineering, security, privacy/legal, payments, and operations sign off;
- limitations are displayed and no GA/live-money/protocol-conformance claim is made.

## 14. Phase 9 — Pilot operation and expansion decision

Operate the named cohort for the observation period. Measure transaction truth, duplicate effects, indeterminate resolution, reconciliation time, operator burden, refunds, retention, and security/privacy incidents. After the observation period, execute `PILOT.md` Gate E before any expansion decision.

Expansion is capability-by-capability. A successful pilot does not automatically release another connector, category, protocol, payment method, autonomous real-money mandate, public signup, or region.

Potential next gates:

1. ACP merchant adapter over stable native commerce semantics;
2. AP2 verifier/export adapter over stable trust semantics;
3. regulated-provider partnership and approved real-money delegated authorization;
4. additional merchant connector or physical-retail cohort;
5. Digital Content/API vertical pack with optional x402 evaluation;
6. future NPCI UAP adapter only after canonical specification and access.

## 15. Protocol adapter order

| Adapter | Pilot status | Build condition |
|---|---|---|
| Native API | Planned pilot dependency | Canonical model frozen |
| MCP | Planned pilot dependency | Native commands and Wallet policy stable |
| ACP | Deferred from pilot transaction path | Native merchant flow stable; exact version pinned |
| AP2 | Design-aligned; adapter Deferred | Trust objects stable; exact profile and tests pinned |
| NPCI UAP | Watch-only | Canonical implementable spec, participation path, approvals, sandbox |
| x402 | Deferred | Approved digital/API use case, compliant rail, settlement/remediation model |

## 16. Test and evidence strategy

No new product feature is complete without its applicable evidence. Required layers include:

- unit tests for schemas, transforms, signatures, policy, state machines, arithmetic;
- property tests for bilateral bounds, idempotency, isolation, convergence, and money conservation;
- connector/provider contract fixtures;
- integration tests against Shopify development and Razorpay test environments;
- end-to-end Merchant → Wallet → Provider → Merchant → Verification flows;
- adversarial authority, replay, quote substitution, redirect, SSRF, injection, and recovery tests;
- resilience tests for timeout, process crash, event duplication/reordering, and dependency outage;
- independent receipt verification;
- no-custody/no-secret scans over DB, logs, queues, traces, analytics, fixtures, and support tools.

Every release bundle records build/commit, migrations, schemas, adapter versions, environment, test results, known limitations, rollback, owners, and capability status changes.

## 17. Scope control

Cannot be cut from the pilot:

- isolation and secret boundaries;
- bilateral deterministic policy and revocation;
- exact mandate/intent/quote binding;
- idempotency and durable external-effect orchestration;
- explicit indeterminate state;
- provider-backed payment truth;
- connector provenance/freshness;
- reconciliation, receipts, audit, recovery, incident response;
- honest compatibility and test-payment language.

May be deferred:

- visual polish beyond accessible operational usability;
- automated compensation where human handling is safe;
- connectors/protocols/payments/categories outside the manifest;
- partial refunds, returns, substitutions, reservations, subscriptions, and advanced fulfillment not required by the pilot.

## 18. Immediate kickoff sequence

Foundation tasks 1–3 are complete. The next sequence is:

1. Establish the first commit/build identifier and keep repository verification green.
2. Complete the remaining Gate A selections and access: CTP JSON Schema dialect, Shopify development store, Razorpay test account, MCP profile, pilot identity provider, local secure-store mechanism, telemetry backend, and AWS topology/cost review.
3. Implement foundation task 4 canonical primitives and property tests.
4. Implement foundation task 5 identity, tenancy, scoped persistence, and RLS evidence.
5. Freeze the Trust Protocol 0.1 schemas and four core interfaces before foundation task 6.
6. Continue the ordered foundation tasks through the no-money trust and transaction slice before provider composition.

## 19. Completion definition

Version 3.1 is complete when the named private cohort can repeatedly execute the declared test-payment purchase lifecycle through independently isolated Counter Merchant and Agent Wallet products; every effect is bounded, attributable, idempotent, provider/merchant-backed, reconciled, and receipted; failures are visible and resolvable; and no claim exceeds the evidence. General availability and live autonomous payments are separate future programs.