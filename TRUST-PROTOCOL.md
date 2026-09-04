# Counter Trust Protocol

**Protocol version:** 0.1 design baseline  
**Document version:** 3.1  
**Status:** Canonical Counter-owned contract. Core mechanics (signed mandate envelopes, agent-signed purchase intents, independent signature re-verification) are proven live — see `HANDOFF.md`. The full CTP 0.1 invariant suite (§19) is not yet formally verified end to end.  
**Scope:** Counter Merchant ↔ Counter Agent Wallet ↔ shared execution/verification services

## 1. Purpose and status

Counter Trust Protocol (CTP) preserves principal intent, delegated authority, merchant identity, policy decisions, transaction correlation, evidence, and outcomes across Counter's two products and adapters.

CTP is an internal/cross-product canonical contract. It is **not** represented as a global standard, payment rail, identity registry, or conformance to ACP, AP2, NPCI UAP, x402, MCP, Razorpay, or any other external protocol. External artifacts map through separately versioned adapters under `CONFORMANCE.md`; their original signed bytes/claims are preserved as evidence when permitted.

The implementation SHALL publish machine-readable JSON Schemas and deterministic canonicalization/signature fixtures before version 0.1 becomes Verified.

## 2. Design principles

1. Identity, authority, payment authorization, and outcome evidence are distinct.
2. Human principal authority is explicit, bounded, expiring, revocable, and least-privilege.
3. Neither buyer nor merchant policy can widen the other.
4. Material transaction meaning is digest-bound; silent substitution is impossible.
5. Every consequential message is replay-protected and idempotently correlated.
6. Unknown outcomes remain Indeterminate until authoritative evidence resolves them.
7. Raw payment credentials and private agent keys never enter CTP.
8. Protocol adapters preserve source provenance and fail closed on required semantic loss.
9. Receipts are audience-scoped, data-minimized, append-only, and superseding rather than mutable.
10. Cryptographic validity is necessary but not sufficient; current policy, revocation, state, provider, and merchant evidence are also required.

## 3. Actors and identifiers

| Actor/object | Identifier requirement |
|---|---|
| Principal | Pairwise/non-public `principal_id` scoped to Wallet; not a payment address |
| Wallet | Stable `wallet_id` in one environment |
| Registered agent | Stable URI `agent_id` plus active public `kid` |
| Merchant | Counter `merchant_id`, environment, verified domains, legal/settlement country |
| Counter service | Service identity and signing `kid` |
| Payment authorization | Opaque `payment_authorization_ref`; never a raw credential |
| Transaction | Globally unique non-secret `transaction_id` |
| Intent/mandate/receipt | Unique typed ID plus immutable digest |

Identifiers SHALL be unguessable where disclosure could leak activity. Pairwise identifiers SHOULD be used across merchants where business correlation is unnecessary.

Agent identity address and payment authorization address/reference SHALL NOT be conflated.

## 4. Cryptographic profile

The 0.1 baseline targets:

- Ed25519 signatures for principal/agent/Counter envelopes;
- JWKS-compatible public key publication with `kid`, use, algorithm, status, validity, and rotation metadata;
- deterministic JSON canonicalization selected and pinned during Gate 0;
- SHA-256 or stronger approved digest selected/pinned during Gate 0;
- secure random 128-bit-or-greater nonces and IDs;
- TLS for transport;
- managed KMS/HSM-backed Counter service keys;
- local/user-controlled agent private keys.

The exact canonicalization standard/library and schema dialect SHALL be frozen in an architecture decision before code signs production-like artifacts. Algorithm identifiers SHALL be explicit; algorithm downgrade and `none` SHALL be rejected.

Private keys SHALL NOT appear in envelopes, databases, logs, queues, analytics, support tools, fixtures, or model context.

## 5. Common Trust Envelope

Every signed CTP object SHALL use a common envelope with at least:

```json
{
  "ctp_version": "0.1",
  "type": "counter.<object>.v1",
  "id": "<typed-unique-id>",
  "issuer": "<principal|wallet|agent|merchant|counter-service-uri>",
  "subject": "<object subject>",
  "audience": ["<intended recipients>"],
  "environment": "sandbox|pilot|production",
  "issued_at": "<RFC3339 UTC>",
  "not_before": "<RFC3339 UTC>",
  "expires_at": "<RFC3339 UTC>",
  "nonce": "<random replay nonce>",
  "correlation_id": "<workflow correlation>",
  "payload_digest": "<canonical payload digest>",
  "payload": {},
  "evidence_refs": [],
  "signature": {
    "alg": "EdDSA",
    "kid": "<key id>",
    "value": "<encoded signature>"
  }
}
```

Normative rules:

1. Signature SHALL cover all envelope fields except the signature value using the pinned canonicalization.
2. Verifier SHALL validate schema/version/type, signature/key status, issuer, subject, audience, environment, validity, payload digest, nonce/replay, and revocation before use.
3. An envelope valid in one environment SHALL be invalid in another.
4. Unknown critical fields/types/versions SHALL fail closed. Namespaced non-critical extension behavior SHALL be declared.
5. Expired objects remain evidence but SHALL NOT authorize new effects.
6. Raw external credentials/tokens SHALL NOT be embedded as evidence.

## 6. Agent registration

`counter.agent-registration.v1` binds:

- principal and Wallet;
- stable Agent URI;
- public key and `kid`;
- proof of private-key possession;
- agent display/provider metadata as non-authoritative labels;
- allowed interface/profile IDs;
- creation, validity, rotation predecessor, and revocation locator;
- assurance level and registration evidence.

Registration establishes identity, not spending authority. A registered agent without a current mandate can perform only public/read operations permitted by merchant policy.

`AgentRegistry` implementations include `CounterTestAgentRegistry` initially and may later include external registry adapters. An external registry claim SHALL record adapter/version/assurance and SHALL NOT silently become Counter principal consent.

## 7. Buyer Policy

`counter.buyer-policy.v1` is a principal-approved, Wallet-managed versioned object containing:

- allowed Counter merchant IDs and verified domains;
- merchant legal/settlement and delivery countries;
- categories/SKUs;
- currencies;
- per-transaction, rolling-period, aggregate, quantity, and transaction-count limits;
- allowed operations and payment authorization references;
- permitted trigger types and time windows;
- approval threshold and material-change behavior;
- validity, status, predecessor, and policy digest.

Policy is not sent in full to merchants. The Wallet discloses only necessary derived constraints/evidence. Policy widening requires principal step-up and creates a new version; narrowing/revocation blocks future effects after durable acceptance.

### 7.1 Principal consent attestation

For the pilot, `counter.principal-consent-attestation.v1` records that the Counter Wallet service witnessed an authenticated principal approve an exact policy or mandate digest. It contains principal and Wallet IDs, object type/ID/digest, consent text/version, authentication provider/method/assurance/time, step-up evidence reference, audience, validity, nonce, and revocation locator.

The Wallet service signs the attestation as issuer after server-verified step-up. It SHALL NOT be represented as a direct principal cryptographic signature. The normalized authority records this assurance limitation. A later direct principal-signature, WebAuthn, AP2, or other external authority adapter may raise assurance without changing the underlying buyer/merchant policy intersection.

## 8. Mandate / normalized authority

`counter.mandate.v1` SHALL bind:

```text
mandate_id
issuer/principal_id
wallet_id
agent_id + kid
allowed merchant_ids + verified domains
merchant legal/settlement countries
delivery countries
categories/SKUs
currencies
per_transaction_limit
rolling/aggregate limits + periods
quantity/transaction_count limits
allowed operations
approval threshold/rule
allowed trigger types/time windows
payment_authorization_ref
not_before/expires_at
nonce/replay scope
revocation locator/status version
policy version/digest
```

A mandate is accepted only if:

- principal/Wallet/agent/key binding is current;
- requested merchant and operation are in scope;
- geography, item, currency, amount, cumulative limits, trigger, and time are in scope;
- payment reference is eligible;
- approval requirements are met;
- issuer/signature/validity/replay/revocation pass;
- merchant policy, provider constraints, and platform safety independently pass.

An adapter-originated authority SHALL retain the source protocol artifact/digest, verifier implementation/version, field availability, omissions, assurance, and mapping result. Schema resemblance alone is insufficient.

## 9. Purchase intent and quote binding

`counter.purchase-intent.v1` represents one requested operation and SHALL contain:

- `intent_id`, mandate/policy IDs, Wallet, agent, merchant/environment;
- operation and trigger (`user_prompt`, approved `time_trigger`, or other declared type);
- item/variant IDs, quantities/units, and allowed substitutions if any;
- quote ID, version, digest, issued/expiry time;
- exact currency and maximum/final amount as applicable;
- delivery country/address reference and fulfillment constraints;
- payment authorization reference;
- transaction and client idempotency IDs;
- approval requirement/reference;
- intent expiry and signature.

`counter.merchant-quote.v1` SHALL contain merchant/environment, items/quantities, unit prices, discounts, tax, shipping/fees, total/currency, availability/reservation declaration, destination/fulfillment, source freshness, expiry, and stable digest.

A change to merchant, items, quantities, currency, final total, destination, payment reference, or quote digest is material and SHALL require a new/reapproved intent according to policy. A merchant SHALL NOT substitute a new quote under an old digest.

## 10. Approval and revocation

`counter.approval.v1` binds principal/reviewer, exact intent/transaction/quote digest, approved amount/currency, decision, reason, issued/expiry time, and authentication assurance.

`counter.revocation.v1` identifies object/key/agent/mandate/payment-reference scope, issuer, effective time, reason class, replacement if any, and sequence/version.

Revocation processing SHALL be durable and monotonic. Verifiers SHALL check the latest applicable revocation state immediately before each consequential effect. Revocation blocks future effects; it does not delete history or claim reversal of an effect already committed externally.

## 11. Payment authorization reference

`counter.payment-authorization-reference.v1` contains only:

- opaque adapter/provider reference or test reference;
- issuer/adapter and environment;
- bound Wallet/principal and permitted agent/merchant scopes where supported;
- method class and currency/limits only when provider-authoritative;
- validity/status and evidence reference;
- assurance and restrictions.

It SHALL NOT contain PAN, CVV, UPI PIN, bank credentials, reusable provider authentication secrets, seed phrases, or raw private payment keys.

`CounterTestAuthorization` may simulate bounded authorization in pilot test mode and SHALL be visibly marked `test_only`. It SHALL be rejected by production/live provider adapters.

## 12. Policy decision

`counter.policy-decision.v1` records:

- requested canonical command and material digest;
- platform, buyer-policy, mandate, merchant-policy, connector, provider, risk, and transaction-state inputs/versions;
- cumulative-limit reservations/checks;
- outcome: `ALLOW`, `DENY`, or `REVIEW_REQUIRED`;
- firing rules and user-safe explanation;
- validity window, transaction version, and evidence references.

The effective decision is the most restrictive applicable result. Evaluation SHALL be deterministic and replayable. A decision SHALL NOT be reused after material input, policy, authority, revocation, quote, provider, capability, or transaction-state change.

## 13. Transaction state and evidence

`counter.transaction-state.v1` records the canonical orchestration phase and independent reservation, payment, order, fulfillment, and return states with source, observed time, version, and assurance.

`counter.evidence.v1` records source type/ID, observation method/time, source version, integrity digest, data classification, retention, canonical claim, and original-artifact reference where permitted.

Source authority is field/state specific:

- Wallet/principal evidence: intent, consent, mandate, approval, revocation;
- merchant connector evidence: product, inventory, order, fulfillment, return;
- payment provider evidence: authorization, capture/payment, void, refund;
- Counter evidence: policy evaluation, orchestration, mapping, audit, reconciliation;
- agent evidence: claims only, never independent payment/merchant truth.

Evidence is append-only. Corrections add new evidence and relationships rather than overwrite prior observations.

## 14. Findings and compensation

`counter.finding.v1` contains type, severity, affected objects, conflicting/missing evidence, detected time, owner, permitted compensation, status, and resolution evidence.

Finding types include intent/authority mismatch, quote/total mismatch, duplicate effect, payment/order/fulfillment mismatch, orphaned authorization, refund mismatch, stale/missing evidence, integrity failure, and indeterminate resolution.

Compensation is a typed command, not an open-ended model instruction. It SHALL specify prerequisites, buyer/merchant policy authorization, maximum monetary effect, idempotency, provider/connector action, expected result, query strategy, and fallback human owner. Unknown outcomes stay unresolved.

## 15. Signed receipt

`counter.transaction-receipt.v1` SHALL include:

- receipt/transaction/intent/merchant IDs and audience;
- final or current canonical state vector;
- items and commercial totals in integer minor units;
- mandate/authority and policy-decision summaries/digests;
- payment authorization class (not secret), provider state/evidence time;
- order/fulfillment/refund states and evidence times;
- findings, unresolved limitations, and assurance level;
- evidence Merkle/root or audit digest selected in architecture baseline;
- issued time, Counter signing key, predecessor/superseded receipt.

Merchant and Wallet receipts MAY differ by redacted audience view but SHALL commit to the same canonical transaction/state digest. Corrections issue a new receipt referencing the prior receipt; no receipt is mutated.

## 16. End-to-end verification sequence

Before a consequential commit Counter SHALL:

1. authenticate agent/interface;
2. resolve current AgentRegistry record and key;
3. verify mandate and source adapter evidence;
4. verify merchant identity/capability manifest;
5. verify quote signature/digest/freshness;
6. verify bound purchase intent and approval if required;
7. check revocation;
8. atomically evaluate/reserve cumulative buyer limits;
9. evaluate merchant/provider/platform policy intersection;
10. persist decision, durable workflow intent, correlation, and idempotency;
11. invoke only typed payment/merchant actions;
12. resolve results against authoritative sources;
13. reconcile all views and issue/update receipt.

Failure before step 10 creates no external effect. A timeout after step 11 produces Indeterminate state and authoritative resolution, not blind duplicate execution.

## 17. External protocol adapters

- **MCP** transports canonical operations; its auth is not spending authority.
- **ACP** maps merchant commerce/checkout; it does not imply CTP authority/payment semantics.
- **AP2** may import/export compatible mandate/verifiable-intent artifacts after a pinned adapter is Verified.
- **NPCI UAP** may later supply registration/authority/rail evidence only after canonical access and approval.
- **x402** may later supply payment-negotiation/settlement evidence for approved digital use cases.
- **Razorpay** supplies payment-provider evidence, not global agent authority.

Adapters SHALL preserve original artifact digest/provenance, identify unmapped fields and assurance downgrade, and fail if required semantics are lost.

## 18. Versioning and extension

- `ctp_version` governs envelope compatibility; object `type` versions govern payload schemas.
- Breaking semantic/schema changes require a new object/envelope version and migration path.
- Additive optional fields require declared default/criticality behavior.
- Critical unknown extensions cause rejection.
- Supported versions, deprecation, keys, and schemas are discoverable.
- Historical verification remains possible for retained supported versions/keys.

## 19. Required invariant suite

Before CTP 0.1 can be Verified, automated evidence SHALL prove:

1. signature/canonicalization determinism across independent implementations;
2. issuer, subject, audience, environment, validity, algorithm, key status, nonce, replay, and revocation rejection;
3. principal-Wallet-agent-key binding;
4. exact merchant/quote/amount/currency/destination/payment-reference intent binding;
5. atomic per-transaction/rolling limit enforcement under concurrency;
6. buyer/merchant/provider/platform intersection cannot be widened;
7. material change invalidates prior consent;
8. revocation blocks future effects during races;
9. test authorization cannot enter a live adapter;
10. no private key/raw payment credential exists in any envelope or telemetry;
11. idempotent retry yields at most one effect;
12. possible unknown outcomes remain Indeterminate;
13. payment success requires provider evidence;
14. audience views share one canonical receipt digest without cross-party leakage;
15. supersession preserves immutable receipt history;
16. adapter semantic loss fails closed and never creates transitive conformance claims.

## 20. Pilot limitation

Protocol version 0.1 is a design baseline for test-mode implementation. The pilot uses Counter-owned test registry/authorization plus a deterministic `CounterTestPaymentProvider` for bounded unattended simulation; this provider SHALL be rejected by live adapters and establishes no external-provider compatibility. Razorpay Standard Checkout is a separate human-present test integration. The pilot makes no AP2, NPCI UAP, live UPI, x402, or external certification claim. Status changes only after the evidence in `CONFORMANCE.md` and `PILOT.md` exists.