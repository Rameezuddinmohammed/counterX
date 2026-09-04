# Counter Compatibility and Conformance Policy

**Document version:** 3.1  
**Status:** Canonical compatibility contract  
**Implementation status:** Planned; no adapter is Verified or Released by this document  
**Related:** `PRD.md`, `PLAN.md`, `TRUST-PROTOCOL.md`, `PILOT.md`

## 1. Purpose

Counter intends to interoperate across agent interfaces, commerce protocols, authority/trust protocols, payment negotiation/execution, and merchant systems without overstating compatibility. This policy defines role separation, mapping rules, capability status, and evidence required for every claim.

## 2. Canonical source

The **Counter canonical domain model** and **Counter Trust Protocol** are the semantic source. The Native API and MCP are projections; external standards and providers are independently versioned adapters.

Counter Trust Protocol is Counter-owned. It is not an industry-standard claim and does not imply conformance to ACP, AP2, NPCI UAP, x402, MCP, Razorpay, or any other profile.

An adapter may translate into canonical commands but may not bypass identity/authority verification, bilateral policy, consent, idempotency, state machines, provider truth, audit, reconciliation, or verification.

## 3. Status and classification

Implementation status is one of: `Planned`, `In Progress`, `Verified`, `Released`, `Degraded`, `Suspended`, `Deferred`.

Conformance classification is separate:

- **Conformant:** inside the selected specification without incompatible extensions;
- **Compatible subset:** intentionally limited subset permitted by the specification;
- **Extension:** negotiated, namespaced behavior outside the base profile;
- **Substitution:** alternate/test dependency explicitly identified;
- **Deviation:** conflicts with a normative requirement;
- **Unsupported:** not exposed for that profile.

A planned target cannot be called conformant in product or marketing language.

## 4. Adapter role taxonomy

| Role | Profiles/examples | Meaning |
|---|---|---|
| Counter canonical trust | Counter Trust Protocol | Native identity, mandate, intent, evidence, receipt contract |
| Counter API projection | Native API | Counter-owned commerce and wallet API |
| Tool transport | MCP | Agent tools/resources over canonical commands |
| Commerce/checkout | ACP | Merchant catalog/session/checkout/event mapping |
| Authority/trust | AP2; future UAP aspects | Mandate, verifiable intent, registration/authorization mapping |
| Payment negotiation | future x402 | Request/payment requirement/proof exchange |
| Payment execution | Razorpay and future providers | Provider instruction, state, webhook, refund |
| Merchant backend | Shopify, generic REST, future connectors | Source reads and typed merchant actions |

Compatibility in one row never implies compatibility in another. An ACP checkout with Razorpay is not automatically AP2, UAP, or x402 compatible. MCP access is not spending authority. A provider payment is not protocol conformance.

## 5. Adapter declaration

Every adapter release declares:

- role and inbound/outbound direction;
- canonical source URL/document and exact version/digest;
- environment and eligible cohort;
- supported subset and operations;
- extensions, substitutions, deviations, and unsupported behavior;
- identity, authority, assurance, and revocation behavior;
- lossy mappings and downgrade behavior;
- state/error/idempotency mappings;
- payment/settlement/refund assumptions where relevant;
- evidence bundle, owner, verification date, and revalidation policy.

Required semantics that cannot be represented cause refusal or explicit escalation. They are never silently dropped.

## 6. Profile policies

### 6.1 Counter Native API

A Counter-owned versioned projection of the canonical model. Compatibility is measured against published Counter OpenAPI/JSON Schema contracts. It makes no third-party conformance claim.

### 6.2 MCP

A tool/transport projection using a pinned MCP SDK/protocol profile. Tools declare schemas, side effects, idempotency, approval behavior, and errors.

MCP transport or authorization does not prove:

- principal spending authority;
- merchant acceptance;
- payment-method/provider compatibility;
- payment completion or settlement;
- order or fulfillment truth.

The MCP model cannot retrieve agent private keys/payment secrets, alter buyer policy, widen limits, add merchants, modify approval thresholds, or assert settlement.

### 6.3 ACP

ACP is a candidate merchant commerce/checkout adapter. Counter may claim only the exact strict subset verified against an archived version.

- strict clients receive only valid fields, states, methods, and enums;
- unknown Razorpay/UPI enum values are not inserted into closed standard fields;
- provider support, AP2 authority, Counter receipts, and Counter extensions are separate capabilities;
- feed schema validity is distinct from commercial usability/freshness;
- ChatGPT Instant Checkout participation or approval is not implied;
- pilot support is Deferred unless `PILOT.md` is amended with evidence.

ACP reference: https://developers.openai.com/commerce/specs/checkout

### 6.4 AP2

AP2 is a candidate trust/mandate adapter and a design input for Counter's normalized authority. An AP2-shaped object or internal mapping is not AP2 conformance.

Before a claim, Counter must pin the authoritative version and pass applicable tests for signature, issuer, subject, audience, principal-agent binding, mandate lifecycle, replay, expiry, revocation, payment association, and independent interoperability. Counter-specific policy and receipts remain Counter extensions unless the selected profile defines their representation.

AP2 references: https://ap2-protocol.org/ and https://fidoalliance.org/building-the-trust-layer-for-agentic-payments-with-ap2-and-verifiable-intent/

### 6.5 Future NPCI UAP

NPCI UAP is watch-list/future only. No canonical public implementable specification was verified when v3.1 was written.

Counter claims no NPCI integration, UAP conformance, UPI agent registration, production access, Reserve Pay availability, cross-merchant authorization, or NPCI approval until all of the following exist:

1. authoritative implementable specification/profile;
2. participation and certification path;
3. regulated/provider relationship and account eligibility;
4. test environment and fixtures;
5. legal/security/payment approval;
6. release evidence.

UAP must not be confused with similarly named but unrelated commerce specifications. Media descriptions are not implementation contracts.

Verified related pilot context: https://razorpay.com/blog/agentic-payments-and-npci/  
Provider Reserve Pay documentation requiring validation: https://razorpay.com/docs/payments/recurring-payments/upi-reserve-pay/?preferred-country=IN

### 6.6 x402

x402 is a candidate payment-negotiation adapter for later API/digital commerce. It is not a stored-value wallet or settlement provider.

Returning HTTP 402 or accepting an x402-shaped request does not prove payment completion, interoperability, compliant custody, India regulatory suitability, or refund support. The adapter requires a pinned profile, approved rail/facilitator, settlement-finality mapping, remediation model, and evidence.

**Status (2026-09-04): actively building, no longer parked.** Counter has retired its prepaid custodial balance experiment and selected direct buyer-to-merchant crypto settlement as the payment direction it is building toward. That changes intent, not evidence. None of the five requirements in the paragraph above is met: no profile is pinned, no rail or facilitator is approved, no settlement-finality mapping or remediation model exists, no adapter has been written, and the chain itself is an open decision. Design work is not an implementation and grants no conformance, compatibility, or runtime-availability claim.

x402 remains Deferred for the private retail pilot, which stays on Razorpay Standard Checkout test mode and the Counter test provider. A crypto settlement adapter occupies the payment-execution role in §4, distinct from x402's payment-negotiation role; if the two converge, the x402 profile must still be pinned and evidenced on its own under §11.

Reference: https://docs.cdp.coinbase.com/x402/core-concepts/how-it-works

### 6.7 Counter test provider, Razorpay, and payment providers

`CounterTestPaymentProvider` is a deterministic Counter-owned substitution used to exercise unattended bounded orchestration. It is test-only, has no external settlement, SHALL be rejected by live environments, and does not establish any provider, rail, or protocol compatibility.

External provider adapters execute/query operations under the merchant's provider account. Provider compatibility is independent of all agent/commerce/trust protocols.

The adapter declaration includes API/webhook versions, merchant ownership, environment, methods, currencies, authorization/capture/refund behavior, idempotency, timeout resolution, and sandbox/production differences.

The v3.1 external-provider path targets Razorpay Standard Checkout test mode only. It is human-present at the hosted checkout step. A generic hosted test checkout does not establish unattended autonomy, UPI, Reserve Pay, live agentic payment, ACP, AP2, UAP, or x402 compatibility.

### 6.8 Shopify and connectors

A connector is compatible with the Counter Connector Contract only for declared resources/actions that pass its certification suite. Read certification does not imply write certification. Shopify is the pilot merchant connector; generic REST is a reference connector. Other connectors are Deferred.

## 7. Role capability matrix

| Capability | Native | MCP | ACP | AP2 | UAP | x402 | Razorpay |
|---|---|---|---|---|---|---|---|
| Tool transport | Native HTTP | Target | No | No | Unknown | No | No |
| Merchant discovery/commerce | Target | Projection | Candidate | No | Unknown | Resource-specific | No |
| User mandate/intent | Counter Trust | Carries reference | Not implied | Candidate | Unknown | Not sufficient | No |
| Agent registration | Counter registry | Uses registry | Not implied | Profile-dependent | Expected/unknown | No | No |
| Payment negotiation | Canonical | Tool result | Profile-dependent | Coordinates authority | Unknown | Candidate | Provider instruction |
| Payment execution/truth | Provider adapter | Reports evidence | Not implied | Not a PSP | Expected/unknown | Rail/facilitator-specific | Test target |
| Receipt/evidence | Counter Trust | Retrieval | Extension/link | Profile-dependent | Unknown | Application-level | Provider evidence only |
| Pilot status | Planned | Planned | Deferred | Design-aligned/Deferred | Watch-only | Deferred | Planned test mode |

“Unknown” means Counter lacks an authoritative implementable contract and must not infer behavior.

## 8. Authority mapping rules

Identity and authority are separate. Every authority adapter classifies canonical fields as required, optional, absent, or unsupported and records assurance impact.

The normalized authority includes principal, wallet, agent key, issuer, merchant IDs/domains, merchant/delivery geography, categories/SKUs, currencies, transaction/rolling limits, operations, approval threshold, payment reference, validity, nonce, revocation, signature/evidence, and assurance.

A mapping must verify authenticity, subject/caller binding, audience, scope, validity, replay, and revocation. A missing field required by buyer policy, merchant policy, selected profile, or requested action causes refusal. Counter does not fabricate signed human intent.

## 9. State, error, and money mapping

Each adapter mapping covers:

- every representable canonical state and accepted external state;
- terminal, pending, retryable, review-required, and indeterminate outcomes;
- errors, HTTP/status mapping, retry guidance, and safe user message;
- lossy mappings and extensions;
- integer-minor-unit amount/currency equivalence;
- idempotency propagation and event deduplication.

Unknown states are retained as evidence and fail safely. They are never coerced to success. Different Released adapters must produce equivalent commercial effects and policy outcomes, allowing only documented representation differences.

## 10. Capability discovery

A signed merchant Capability Manifest declares only Released, currently enabled behavior and includes exact adapter versions, operations, methods, region, vertical pack, authority requirements, limitations, health, and evidence ID.

Planned or Deferred profiles may appear in documentation roadmaps but not runtime discovery as available. Extension capabilities are namespaced, versioned, opt-in, and omitted unless negotiated.

## 11. Conformance evidence

A profile can become Verified only with:

1. authoritative source/schema and digest;
2. adapter build/commit and environment;
3. positive and negative schema/lifecycle fixtures;
4. signature/authority/replay/revocation tests where applicable;
5. strict enum/unknown-field behavior;
6. state, error, money, idempotency, timeout, and race tests;
7. extension negotiation/downgrade tests;
8. proof every command passes canonical policy and verification;
9. security, privacy, performance, and resilience results;
10. independent interoperability for public external-protocol claims;
11. deviations, limitations, substitutions, and unsupported features;
12. reviewer, owner, date, and expiry/revalidation policy.

Released additionally requires enablement for a named cohort, monitoring, documentation, support, and incident runbooks.

## 12. Current compatibility register

| Capability | Status | Target/evidence condition |
|---|---|---|
| Counter Trust Protocol | Planned | Counter v0.x schemas and invariant suite |
| Counter Native API | Planned | Published Counter contract and E2E evidence |
| Counter Agent Wallet | Planned | Wallet requirements and pilot evidence |
| MCP tool adapter | Planned | Pinned MCP profile plus Counter tool contract |
| ACP adapter | Deferred from pilot | Pinned strict subset plus independent client evidence |
| AP2 adapter | Deferred; design-aligned | Pinned trust profile plus independent evidence |
| NPCI UAP adapter | Watch-only/Deferred | Canonical spec, access, approvals, certification evidence |
| x402 / crypto settlement rail | Planned; actively being designed, Deferred from pilot | Chain and profile selection, approved rail/facilitator, settlement-finality and remediation mapping, then §11 evidence |
| Counter test payment provider | Planned test substitution | Deterministic test-only invariant suite; rejected outside test environments; no external compatibility claim |
| Razorpay adapter | Planned test mode | Pinned human-present Standard Checkout test contract; no live/autonomy claim |
| Shopify connector | Planned | Pilot Connector Contract evidence |
| Generic REST connector | Planned reference | Reference fixtures/certification; not pilot merchant support |
| Other connectors/rails | Deferred | Separate manifest and gates |

Nothing is Verified or Released solely because it appears here.

## 13. Drift and revalidation

Before release and periodically thereafter, Counter checks canonical sources and provider versions, compares digests, runs impact analysis and affected suites, preserves prior fixtures, updates limitations, and communicates deprecations. An unreviewed upstream change may suspend a capability; it cannot silently expand compatibility.

## 14. Honest-claims rules

- A target is not an implementation.
- A trust-envelope mapping is not protocol conformance.
- A mandate-shaped object is not AP2 certification.
- HTTP 402 behavior is not x402 interoperability.
- Provider test mode is not a live payment rail.
- Hosted Razorpay checkout is not ACP, AP2, UAP, or x402 compatibility.
- “NPCI UAP-ready,” “Reserve Pay supported,” and “agentic UPI” are prohibited without a defined profile, access, approvals, and evidence.
- Counter Agent Wallet is not a bank/payment account or stored-value balance.
- A local record, redirect, merchant claim, or model output is not payment truth.
- A connector read capability is not write certification.
- Universal architecture is not universal released support.

When evidence is incomplete, Counter states what is known, unknown, unavailable, and required to change that status.