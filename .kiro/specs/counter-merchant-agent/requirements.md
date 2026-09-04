# Requirements Document

> **RETIRED — historical planning artifact.** Written during early feature planning, before implementation. `CLAUDE.md`'s own source-of-truth hierarchy already marks `.kiro/specs/**/tasks.md` as stale for completion status; this applies to this whole spec bundle. For current, verified state, see `HANDOFF.md` and `README.md`.


**Feature:** Counter Merchant
**Spec:** `counter-merchant-agent`  
**Version:** 3.1  
**Status:** Canonical merchant-side requirements  
**Implementation status:** Planned  
**Sources:** `PRD.md`, `TRUST-PROTOCOL.md`, `CONFORMANCE.md`, `PILOT.md`

## Introduction

### Scope

Counter Merchant activates a merchant-facing agent over existing commerce and payment systems. This specification covers merchant tenancy, activation, connectors, Commerce Graph, capabilities, policy, transaction execution, payment-provider integration, orders, evidence, reconciliation, operations, and protocol adapters.

Agent Wallet requirements are defined separately. Shared envelopes and trust invariants are defined in `TRUST-PROTOCOL.md`. The operative first release is limited by `PILOT.md`; general architecture does not make Deferred capabilities release requirements.

`SHALL`/`SHALL NOT` are mandatory. `SHOULD` requires an approved decision record when not followed.

## Glossary

- **Merchant tenant:** isolated merchant organization/environment boundary.
- **Merchant agent:** machine-facing commercial representative powered by released Counter capabilities.
- **Capability Manifest:** signed declaration of operations actually available for one merchant environment.
- **Commerce Graph:** Counter's normalized merchant commerce model with provenance/freshness.
- **Consequential action:** operation that may change merchant, payment, inventory, order, fulfillment, refund, or customer state.
- **Authority:** verified bounded permission from a principal to a registered agent.
- **Trust Envelope:** signed Counter Trust Protocol carrier.
- **Indeterminate:** possible external effect awaiting authoritative evidence.
- **Released:** Verified and enabled for a named cohort with an owner.

## Requirements

## 3. Merchant tenancy and access

1. The system SHALL represent merchant organization, tenant, and sandbox/production-like environment separately.
2. It SHALL isolate tenant/environment data at authorization, query, cache, queue, object, search, log, analytics, and support boundaries.
3. It SHALL support merchant owner/admin, integration, operations, auditor, read-only, and scoped Counter support roles.
4. Privileged roles SHALL use MFA and step-up for credentials, activation, policy widening, suspension reversal, and offboarding.
5. Support access SHALL be purpose-limited, time-bound, approved or incident-authorized, and fully audited.
6. Merchant users SHALL NOT browse a Wallet's unrelated activity, policy, mandates, keys, payment references, or transactions.
7. Sandbox identities and idempotency scopes SHALL NOT authorize or collide with production effects.
8. Cross-tenant references SHALL be handled as nonexistent.

## 4. Merchant lifecycle and pilot enrollment

Merchant states are `DRAFT`, `CONNECTING`, `MAPPING`, `VERIFYING`, `SANDBOX_READY`, `ACTIVATION_REVIEW`, `ACTIVE`, `ACTIVE_DEGRADED`, `SUSPENDED`, `OFFBOARDING`, `CLOSED`.

1. Every transition SHALL be validated server-side and record actor, reason, state, time, and evidence.
2. `ACTIVE_DEGRADED` SHALL identify explicit operational limitations, not readiness or release status.
3. The pilot SHALL permit only operator-invited, allowlisted merchants and approved Shopify stores.
4. Activation SHALL verify administrator/domain control, Shopify source identity/permissions, and merchant-owned Razorpay test account/environment.
5. Readiness findings SHALL be Blocking, Accepted Limitation, Advisory, or Expiring and carry evidence, owner, remediation, and reevaluation time.
6. Production-like activation SHALL be impossible with a Blocking finding.
7. The merchant SHALL acknowledge every Accepted Limitation.
8. Activation SHALL publish only capabilities both Released for that tenant and enabled in `PILOT.md`.
9. Merchant suspension SHALL immediately block future consequential actions without deleting history or preventing safe reconciliation.

## 5. Connector contract

1. Every connector SHALL publish a versioned manifest covering resources/actions, authentication, network, rate limits, freshness, events/polling, sandbox behavior, idempotency, compensation, and data classification.
2. Setup SHALL test connectivity, source identity, permission, schema/capability, sample read, and declared write behavior.
3. Credentials SHALL be opaque references in application data and plaintext SHALL NOT enter logs, analytics, events, or support tools.
4. Connector egress SHALL be allowlisted and protected against SSRF, DNS rebinding, metadata/private endpoints, malicious redirect, and oversized responses.
5. Every write SHALL be a named typed action with schema, authority/policy requirements, preconditions, stable idempotency, timeout semantics, expected effects, and authoritative query/reconciliation path.
6. Counter SHALL NOT offer arbitrary model-generated SQL or mutation.
7. Possible but unknown write outcomes SHALL become Indeterminate and SHALL NOT be blindly retried.
8. A merchant SHALL be able to revoke each connector/action independently.

### Pilot profiles

- Shopify SHALL be the only pilot merchant transaction connector.
- Generic REST SHALL be a reference connector tested through synthetic fixtures, not advertised as a second pilot merchant path.
- WooCommerce, files, databases, ERP, CRM, POS, WMS, and other connectors SHALL be Deferred unless the Pilot Capability Manifest is versioned and reapproved.

## 6. Commerce Graph, mapping, provenance, and freshness

1. Counter SHALL normalize products, variants, category, price, promotion, inventory, quote, order, fulfillment, refund, and source references required by the pilot.
2. Money SHALL use integer minor units with ISO currency; quantities SHALL use decimal-safe values and explicit units.
3. Mappings SHALL be immutable/versioned, previewed against raw source records, validated before publication, and rollback-capable.
4. Deterministic parsing SHALL precede model-assisted suggestions.
5. Every inferred value SHALL record input, method/version, confidence, and confirmation.
6. A model SHALL NOT mint identifiers, alter money, widen policy, issue authority, or assert an outcome.
7. Every canonical field used consequentially SHALL retain source, record/field identity, source version, observed/normalized time, mapping version, and inference confidence if applicable.
8. Source conflicts and stale data SHALL be explicit.
9. Data outside the permitted freshness budget SHALL block or degrade quote/checkout according to policy; it SHALL NOT appear fresh.
10. Sync SHALL handle duplication, reordering, tombstones, replay, backfill, rate limits, and partial failure.

## 7. Merchant capability and policy

1. The merchant SHALL configure allowed operations, products/categories, value/quantity, currencies, destinations, payment methods, discounts, refunds, substitutions, time windows, and human review.
2. Policy SHALL be versioned, deterministic, simulated before activation, rendered in plain language, and rollback-capable.
3. The effective action SHALL be the most restrictive intersection of platform safety, current buyer policy/consent, normalized authority, merchant policy, connector capability/freshness, provider constraints, risk results, and transaction state.
4. Merchant policy SHALL NOT widen buyer authority; buyer authority SHALL NOT widen merchant policy.
5. Evaluation errors SHALL fail closed for consequential actions.
6. Every decision SHALL retain inputs, evidence, policy/mapping versions, rules, outcome, and explanation and SHALL replay deterministically.
7. `REVIEW_REQUIRED` SHALL prevent irreversible merchant writes or test payment completion until current approval.

## 8. Discovery and protocol surfaces

1. Each active merchant environment SHALL expose a signed, versioned Capability Manifest.
2. It SHALL declare exact profiles/versions, endpoints, operations, vertical, methods, currencies, regions, limits, authority requirements, extensions, limitations, health, and evidence ID.
3. Only Released and currently enabled capabilities SHALL be advertised.
4. Suspended/Deferred capabilities SHALL be absent or marked unavailable according to the selected profile.
5. Discovery SHALL NOT expose credentials, internal hosts, private connector details, personal data, or operator diagnostics.
6. Strict external clients SHALL NOT require undocumented Counter fields.
7. Extensions SHALL be namespaced, negotiated, and absent by default.
8. Every external adapter SHALL obey role and evidence rules in `CONFORMANCE.md` and SHALL NOT bypass canonical controls.

## 9. Identity, authority, quote, and consent binding

1. Identity SHALL be distinct from spending/action authority.
2. Consequential requests SHALL authenticate using the selected profile and verify a current normalized authority through `AuthorityVerifier`.
3. Authority SHALL bind principal, wallet, registered agent key, merchant IDs/domains, geography, categories/SKUs, currency, transaction/rolling limits, operations, approval threshold, payment reference, validity, nonce, revocation, and issuer evidence as required.
4. Signature/issuer, subject/caller, audience, scope, validity, replay, and revocation SHALL be checked.
5. Absence of a required field SHALL refuse execution; Counter SHALL NOT fabricate principal intent.
6. A quote SHALL contain immutable items, quantities, prices, discounts, tax, shipping/fees, total, currency, fulfillment promise, expiry, freshness, and digest.
7. Completion SHALL bind exact merchant, items, quantity, currency, total, destination, quote digest, authority, policy decisions, and transaction version.
8. A material change SHALL require a new quote and renewed intent/approval under policy.
9. Revocation SHALL block future effects but SHALL NOT erase or misrepresent committed effects.

## 10. Transaction safety

1. The Transaction Engine SHALL maintain orthogonal orchestration, reservation, payment, order, fulfillment, and return states.
2. Invalid transitions SHALL be rejected.
3. Every consequential command SHALL require/derive a stable idempotency key scoped by merchant environment, wallet/agent intent, operation, and material digest.
4. Identical retries SHALL return the recorded result; changed payload under the same key SHALL conflict; concurrency SHALL converge to one execution.
5. Durable intent and transactional outbox/inbox SHALL precede external effects.
6. Downstream calls and events SHALL use stable correlation and deduplication IDs.
7. Timeout after a possible effect SHALL set the applicable state to Indeterminate and block incompatible actions.
8. Indeterminate state SHALL resolve only from authoritative query or verified event evidence.
9. No retry path SHALL create more than one corresponding order, payment, cancellation, or refund effect.
10. After any confirmed or possible external effect and before a subsequent consequential effect, the Transaction Engine SHALL make a fresh continuation decision using current authority/revocation, policy, material binding, capability/kill switches, transaction/accounting state, and authoritative prior-effect evidence. A denied or Indeterminate continuation SHALL block the next effect and enter reconciliation, typed compensation, or human remediation without compounding the stale authority.

## 11. Non-custodial payment requirements

1. The merchant SHALL remain seller and merchant of record.
2. Funds SHALL move through the regulated/provider path to the merchant's provider account; Counter SHALL NOT hold, pool, receive, transmit, settle, or credit funds.
3. Counter Merchant SHALL use a versioned `PaymentProvider` interface and Counter Agent Wallet a separate `PaymentAuthorization` reference.
4. Provider adapters SHALL declare account ownership, environment, API/webhook version, methods/currencies, lifecycle, idempotency, query, timeout, and refund behavior.
5. Counter SHALL use hosted, tokenized, or provider-native instructions and SHALL NOT store/log PAN, CVV, UPI PIN, bank credentials, or equivalent secrets.
6. Provider webhooks SHALL be verified and durably/idempotently consumed.
7. Confirmed payment status SHALL require authoritative provider API or verified event evidence.
8. Refund/cancellation prerequisites SHALL use provider/merchant truth and outcomes SHALL be reconciled.
9. The pilot SHALL support two separate test paths: `CounterTestAuthorization` plus `CounterTestPaymentProvider` for bounded unattended simulation, and Razorpay Standard Checkout test mode for a human-present provider lifecycle.
10. The Counter test provider SHALL be rejected outside test environments and SHALL NOT establish Razorpay or rail compatibility.
11. Razorpay hosted checkout SHALL return `PAYMENT_ACTION_REQUIRED`; Counter SHALL NOT automate OTP, PIN, bank approval, or payment details.
12. Live UPI, Reserve Pay, NPCI UAP, loaded balances, and real-money autonomous spending SHALL remain unavailable until separately approved and evidenced.

## 12. Orders and post-purchase behavior

1. A successful pilot transaction SHALL create/reference a Shopify order and correlate intent, quote, authority, decision, payment, order, and fulfillment identifiers.
2. Status SHALL come from authoritative merchant/provider records with source and freshness.
3. Cancellation and full-refund test operations SHALL check current merchant, fulfillment, payment, buyer, and merchant policy before execution.
4. A refund SHALL never be represented as credited to a Counter balance.
5. Pending, confirmed, failed, declined, and Indeterminate outcomes SHALL be distinct.
6. Partial refunds, returns, substitutions, variable quantities, subscriptions, and advanced fulfillment SHALL remain Deferred unless added to a revised manifest.

## 13. Evidence, verification, receipts, and remediation

1. Append-only evidence SHALL cover authentication, authority, consent, policy, state, connector actions, provider actions/events, approvals, findings, remediation, and privileged access.
2. Evidence SHALL include source, time, source ID/version, integrity digest, and retention class and SHALL be tamper-evident.
3. Verification SHALL compare principal/wallet intent, authority, agent claim, quote, merchant record, provider state, and fulfillment where available.
4. Agent/model/local optimistic state SHALL NOT prove payment, order, refund, or fulfillment success.
5. Findings SHALL name severity, objects, evidence, owner, allowed remediation, status, and resolution evidence.
6. Automated compensation SHALL use a typed matrix, explicit merchant and buyer policy, authoritative prerequisites, and idempotency; otherwise it SHALL create a human task.
7. Failed/unconfirmed compensation SHALL remain unresolved.
8. Counter SHALL issue signed, audience-scoped receipts after terminal state and later material correction.
9. Receipts SHALL include canonical states/totals, authority/policy summaries, assurance, evidence times/references, audit digest, key ID, and supersession without secrets or unnecessary personal data.
10. Independent verification against published key material SHALL succeed.

## 14. Merchant and operations surfaces

1. Merchant Console SHALL provide invitation/activation, connector/mapping, capability/policy, sandbox evidence, transaction timeline, approvals, exceptions, findings, test payments/orders, audit, users/keys, suspension, and offboarding.
2. Operations Console SHALL provide fleet health, queues, provider/connector health, incidents, dead letters, replay, reconciliation, adapter releases, and scoped support sessions.
3. Administrative actions SHALL be typed, authorized, validated, reasoned, idempotent where relevant, and audited.
4. Normal support SHALL NOT require direct production database editing or plaintext secret access.
5. Replay/backfill/remediation SHALL support dry run and affected counts.
6. Merchant-visible status SHALL distinguish Counter, Shopify, provider, and merchant configuration failure.

## 15. Security, privacy, reliability, and offboarding

1. Counter SHALL encrypt data in transit/at rest and use approved secrets/KMS systems with rotation.
2. It SHALL minimize/redact personal and restricted data across telemetry, support, analytics, events, and receipts.
3. New connector/payment/protocol/privileged workflows SHALL have an approved threat model before release.
4. The pilot SHALL have named support, alerts, runbooks, transaction caps, kill switches, backup/restore, replay, and incident handling.
5. Merchant offboarding SHALL suspend new transactions before connector/provider revocation, enumerate unresolved effects, export as required, revoke access, retain only required evidence, and remove discovery.
6. Deletion SHALL respect retention, legal hold, dispute, financial, and audit requirements.
7. Counter SHALL NOT claim regulatory certification, production SLO, protocol conformance, or reduced compliance scope without applicable evidence.

## 16. Merchant correctness invariants

Automated evidence SHALL falsifiably cover:

- **M1 Isolation:** no merchant identity influences another merchant or unrelated Wallet.
- **M2 Environment separation:** test credentials/data cannot authorize live effects.
- **M3 At-most-one effect:** retries yield at most one order and payment effect.
- **M4 No unsupported success:** authoritative source confirms every consequential success.
- **M5 Explicit uncertainty:** possible unknown effects remain Indeterminate.
- **M6 Bilateral non-circumvention:** concurrency cannot exceed buyer or merchant bounds.
- **M7 Provenance:** every consequential field has source/time/version.
- **M8 Payment truth:** only provider evidence confirms payment.
- **M9 Audit integrity:** history cannot be silently rewritten.
- **M10 Model containment:** model output cannot directly authorize or execute effects.
- **M11 Adapter role separation:** one compatibility claim never implies another.
- **M12 Capability honesty:** discovery exposes only healthy Released behavior.
- **M13 Non-custody:** no Counter-controlled stored value or raw credential exists.
- **M14 Recovery safety:** crashes/replay converge without lost intent or duplicate effect.

## 17. Private pilot gate

Counter Merchant SHALL NOT be released beyond the named private cohort until every applicable Gate in `PILOT.md` and phase through private-pilot readiness in `PLAN.md` has linked evidence. Pilot release does not imply GA, live money, autonomous real-money authority, or support for Deferred adapters/connectors.