# Requirements Document

> **RETIRED — historical planning artifact.** Written during early feature planning, before implementation. `CLAUDE.md`'s own source-of-truth hierarchy already marks `.kiro/specs/**/tasks.md` as stale for completion status; this applies to this whole spec bundle. For current, verified state, see `HANDOFF.md` and `README.md`.


**Feature:** Counter Agent Wallet
**Spec:** `counter-agent-wallet`  
**Version:** 3.1  
**Status:** Canonical buyer-side requirements  
**Implementation status:** Planned  
**Sources:** `PRD.md`, `TRUST-PROTOCOL.md`, `CONFORMANCE.md`, `PILOT.md`

## Introduction

### Scope

Counter Agent Wallet is a non-custodial identity, policy, consent, authorization-reference, activity, and evidence product for buyer agents. It lets a human principal register an agent, constrain autonomous commerce, bind intent to merchant quotes, approve when required, revoke authority, and independently verify outcomes.

“Wallet” does not mean a stored-value account. It SHALL NOT hold, pool, receive, transmit, settle, or display a Counter-controlled money balance. Payment instruments, authentication secrets, and funds remain with approved regulated/provider systems.

Merchant-side requirements are separate. Shared envelope, identity, mandate, receipt, and cryptographic requirements are defined in `TRUST-PROTOCOL.md`. The operative release profile is `PILOT.md`.

`SHALL`/`SHALL NOT` are mandatory. `SHOULD` requires an approved decision record when not followed.

## Glossary

- **Principal:** human who owns the Wallet and grants/revokes authority.
- **Wallet account:** isolated Counter buyer account containing policy, references, activity, and evidence.
- **Registered agent:** software identity bound to a public signing key and principal.
- **Agent URI:** stable identifier distinct from a payment address.
- **Mandate:** signed, bounded, revocable authority granted by the principal.
- **Bound intent:** signed instruction for a specific merchant/quote/operation under a mandate.
- **Payment authorization reference:** opaque provider/test reference, never a raw credential.
- **Claim ledger:** Wallet record of what an agent says it attempted or observed; not authoritative payment/order truth.
- **Consequential action:** operation that may cause merchant/payment/order/fulfillment effects.

## Requirements

## 3. Wallet lifecycle and isolation

Wallet states are `INVITED`, `ENROLLED`, `VERIFIED`, `ACTIVE`, `SUSPENDED`, `RECOVERY_LOCKED`, `OFFBOARDING`, and `CLOSED`.

1. The system SHALL validate every transition server-side and record actor, reason, prior/new state, time, and evidence.
2. The pilot SHALL allow only invited Wallet accounts and approved users.
3. A Wallet SHALL remain a separate authorization/data domain from merchant tenants and other Wallets.
4. No Wallet identity SHALL read, infer, mutate, replay, export, or influence another Wallet's policy, agent, transaction, receipt, identifier, cache, queue, object, log, analytics, or support data.
5. A merchant SHALL receive only principal/order/delivery data required for a specific authorized transaction.
6. A suspended, recovery-locked, offboarding, or closed Wallet SHALL create no new consequential authority or effects.
7. Suspension/closure SHALL NOT erase evidence needed for committed transactions, disputes, security, law, or retention obligations.
8. Sandbox/test Wallet identity SHALL NOT authorize production/live effects.

## 4. Principal enrollment, authentication, and recovery

1. Enrollment SHALL verify the invited principal through the approved pilot authentication method.
2. The principal SHALL accept the non-custodial definition, data sharing, test-payment limitation, policy semantics, recovery behavior, and residual limitations.
3. Privileged actions SHALL require recent authentication and step-up where risk requires.
4. Privileged actions include agent registration/key change, policy widening, allowlist change, approval-threshold increase, payment-reference change, recovery, export, and closure.
5. Recovery SHALL use a separate, rate-limited, audited process and SHALL NOT disclose an existing private key or payment credential.
6. Recovery initiation SHALL freeze new consequential actions until the configured challenge/cooling-off requirements complete.
7. Recovery SHALL rotate/revoke affected keys and mandates and notify the principal through an independent channel.
8. Support SHALL NOT bypass principal policy, retrieve private keys, or impersonate an agent to spend.
9. Authentication, recovery, and support events SHALL be append-only and visible to the principal.

## 5. Agent identity and key custody

1. Every registered agent SHALL have a stable, non-secret Agent URI and one or more versioned public key records.
2. Agent identity SHALL be distinct from payment authorization/reference.
3. The initial implementation SHALL use Ed25519 signing with JWKS-compatible public key discovery as defined in `TRUST-PROTOCOL.md`.
4. The agent private key SHALL be generated/stored locally or in a user-controlled secure boundary; Counter application services SHALL NOT receive it.
5. Counter SHALL store public keys, key status, assurance metadata, creation/rotation/revocation time, and proof of principal binding.
6. Registration SHALL prove possession of the corresponding private key and current principal authorization.
7. Rotation SHALL preserve an auditable key chain and prevent the old key from authorizing effects after effective revocation.
8. Compromise response SHALL support immediate agent/key/mandate suspension without deleting history.
9. Agent display names and model/provider metadata SHALL NOT be treated as cryptographic identity.
10. An AI model SHALL NOT be given a tool that exports private signing material.

## 6. Buyer policy

1. Buyer policy SHALL be deterministic, versioned, inspectable, and rendered in plain language.
2. It SHALL support:
   - Counter merchant IDs and verified-domain allowlists;
   - merchant legal/settlement country and delivery-country restrictions;
   - product categories and optional SKU constraints;
   - currency constraints;
   - per-transaction, rolling-period, and aggregate amount limits;
   - quantity and transaction-count limits;
   - permitted operations;
   - valid days/times and expiry;
   - approval threshold and material-change rules;
   - permitted payment authorization references.
3. “India only” SHALL evaluate verified merchant legal/settlement metadata and delivery destination; IP address or domain suffix alone SHALL NOT satisfy it.
4. Policy changes SHALL be immutable by version and SHALL NOT rewrite historical decisions.
5. Policy widening SHALL require principal step-up and SHALL NOT be available through agent/MCP tools.
6. Policy narrowing or emergency suspension SHALL take effect for future actions immediately after durable acceptance.
7. Concurrent actions SHALL reserve/check cumulative limits atomically so individually valid actions cannot exceed aggregate authority.
8. Policy evaluation errors SHALL fail closed.
9. The principal SHALL be able to simulate policy against synthetic/past transactions before activation.

## 7. Mandates, intents, approval, and revocation

1. Mandates and intents SHALL conform to the Counter Trust Protocol schemas and signature rules.
2. A mandate SHALL bind principal, Wallet, registered agent key, merchant IDs/domains, geography, category/SKU, currency, transaction/rolling limits, operations, approval threshold, payment reference, validity, nonce/replay scope, and revocation locator.
3. A bound intent SHALL identify mandate, merchant, operation, items/quantities, quote ID/digest, amount/currency ceiling, delivery constraints, payment reference, expiry, and idempotency key.
4. The Wallet SHALL verify merchant identity/capability and quote signature/digest/freshness before signing or approving an intent.
5. A material change to merchant, items, quantity, currency, total, destination, quote digest, or payment reference SHALL invalidate the intent and require renewed consent/approval.
6. An operation inside a current mandate and below its approval threshold MAY proceed autonomously after deterministic policy evaluation.
7. An operation outside automatic bounds SHALL be refused or enter `REVIEW_REQUIRED`; it SHALL NOT silently reduce assurance.
8. Approval SHALL bind the exact current intent/quote/transaction version, approver, time, expiry, and decision reason.
9. Revocation SHALL be authenticated, durable, replay-protected, auditable, and checked before each consequential effect.
10. Revocation SHALL block future effects but SHALL NOT claim to reverse a committed external effect; reconciliation/compensation SHALL handle it.
11. An agent/model SHALL NOT mint its own mandate, approve itself, alter limits, or suppress revocation.
12. A Counter Wallet service-witnessed principal-consent attestation SHALL preserve its service-witnessed assurance class and SHALL NOT satisfy a rule requiring direct principal, WebAuthn, or external-protocol cryptographic proof.

## 8. Payment authorization boundary

1. The Wallet SHALL store only an opaque `PaymentAuthorizationReference` allowed by the selected adapter/provider contract.
2. It SHALL NOT store or display a Counter-controlled balance or accept top-ups.
3. It SHALL NOT store/log PAN, CVV, UPI PIN, bank credentials, provider authentication secrets, or raw payment tokens exposed to an agent/model.
4. Payment references SHALL be bound to Wallet, principal, eligible agent/merchant/operation, environment, and validity as supported.
5. Changing a payment reference SHALL require principal step-up and SHALL invalidate or reevaluate affected mandates.
6. Consequential tools SHALL receive only a scoped one-time instruction/reference required by the payment boundary, never a reusable secret.
7. Payment status SHALL come only from verified provider evidence through Counter Merchant/PaymentProvider.
8. Agent claim, Wallet state, redirect return, screenshot, or merchant assertion SHALL NOT mark payment paid.
9. Refunds SHALL use the merchant/provider route and SHALL NOT credit a Wallet balance.
10. The pilot SHALL support two separate test paths: `CounterTestAuthorization` plus `CounterTestPaymentProvider` for bounded unattended simulation, and Razorpay Standard Checkout test mode for a human-present provider lifecycle.
11. The Counter test provider SHALL be rejected outside test environments and SHALL NOT establish Razorpay or payment-rail compatibility.
12. Razorpay hosted checkout SHALL return `PAYMENT_ACTION_REQUIRED`; MCP SHALL NOT automate OTP, PIN, bank approval, or payment details.
13. Live UPI, Reserve Pay, loaded funds, real-money unattended spending, and cross-merchant payment authority SHALL remain unavailable until separate legal/provider/technical gates pass.

## 9. Agent interfaces and MCP safety

1. Native API and MCP SHALL expose only operations Released in the current capability manifest.
2. Read and consequential operations SHALL be visibly distinct.
3. Consequential operations SHALL require a current signed intent/mandate, policy decision, transaction version, and stable idempotency key.
4. MCP SHALL be a transport/tool adapter; MCP authorization SHALL NOT substitute for principal authority or payment truth.
5. MCP/model tools SHALL NOT:
   - retrieve private keys or payment credentials;
   - alter policy, merchant allowlists, country/category limits, amounts, rolling limits, payment references, or approval thresholds;
   - create/approve a mandate as the principal;
   - bypass review/revocation;
   - access another Wallet;
   - assert provider settlement, merchant order, or fulfillment success.
6. Tool output SHALL represent pending, review-required, declined, failed, and Indeterminate states structurally, never as free-text success.
7. Retries SHALL reuse stable idempotency; the model SHALL NOT be encouraged to retry unknown non-idempotent effects.
8. Time-triggered actions SHALL require a pre-existing mandate that explicitly permits the trigger/window and operation.
9. Agent access SHALL be rate-limited, anomaly-monitored, and immediately revocable.

## 10. Discovery and transaction flow

1. The Wallet SHALL consume signed merchant Capability Manifests and SHALL NOT offer an undiscoverable/unsupported operation.
2. It SHALL verify merchant tenant/environment, verified domain, country, vertical, currency, authority requirements, limitations, and health.
3. Search/product data SHALL display source freshness and material limitations where relevant.
4. A quote SHALL be immutable and include merchant, items, quantities, prices, tax/shipping/fees, total, currency, destination/fulfillment, expiry, freshness, and digest.
5. Before commit, the Wallet SHALL recheck policy, mandate, approval, revocation, quote expiry/material change, transaction version, and payment-reference eligibility.
6. Each command SHALL use a stable Wallet/agent intent ID and idempotency key without leaking unrelated Wallet identifiers to the merchant.
7. A possible unknown effect SHALL be shown as Indeterminate and incompatible actions SHALL be blocked.
8. Final status SHALL distinguish Wallet/agent claim from merchant and provider evidence.

## 11. Claim ledger, evidence, and receipts

1. The Wallet SHALL maintain an append-only claim ledger of agent requests/responses, decisions, and observed external claims.
2. A claim SHALL identify its source and SHALL NOT overwrite authoritative merchant/provider evidence.
3. The Wallet SHALL receive audience-scoped findings/status and signed receipts for its transactions.
4. Receipts SHALL include canonical totals/states, authority/policy summary, assurance, evidence references/times, audit digest, signing key, and supersession without merchant secrets or unrelated buyer data.
5. The Wallet SHALL independently verify receipt signature, audience, transaction binding, schema/version, and supersession chain.
6. A receipt with invalid signature/digest, unknown key, wrong audience, or broken chain SHALL be marked untrusted and escalated.
7. Corrections SHALL create a superseding receipt; historical receipts SHALL remain immutable.
8. The principal SHALL be able to export policy, agents, mandates, activity, claims, receipts, and revocations in documented formats subject to access/retention controls.

## 12. Privacy and user control

1. The Wallet SHALL show what transaction data will be shared with a merchant/provider before approval where approval is present.
2. It SHALL share only data necessary for the authorized transaction and applicable legal/safety requirements.
3. Merchant correlation across unrelated Wallet activity SHALL be prevented unless the principal explicitly authorizes a supported purpose.
4. Logs, traces, metrics, analytics, events, support, and receipts SHALL redact secrets and minimize personal data.
5. The product SHALL provide data inventory, purpose, retention, export, correction where applicable, and deletion/closure controls consistent with applicable DPDP obligations.
6. Closure SHALL revoke agents/mandates and block new effects before data deletion/anonymization.
7. Retained evidence after closure SHALL be minimized and governed by legal hold, dispute, security, financial, and audit requirements.
8. A closure receipt SHALL list revoked access, retained categories, deadlines, and unresolved obligations.

## 13. Security and operations

1. Wallet data SHALL be encrypted in transit/at rest using approved managed cryptography.
2. Public-key and payment-reference changes, recovery, policy widening, exports, and closure SHALL produce security events and notifications.
3. Threat models SHALL cover malicious/compromised agent, mandate replay, confused deputy, quote substitution, payment redirection, recovery takeover, cross-wallet leakage, merchant correlation, and support abuse.
4. The system SHALL enforce rate limits, device/session controls, anomaly alerts, and emergency Wallet/agent/mandate/payment-reference kill switches.
5. Administrative operations SHALL be typed, validated, reasoned, scoped, and audited; normal support SHALL NOT edit production databases directly.
6. Backup/restore, event replay, key rotation, revocation propagation, and closure SHALL be exercised before pilot release.
7. Counter SHALL NOT claim custody, bank/PPI status, live payment availability, protocol conformance, or production autonomy without evidence.

## 14. Wallet correctness invariants

Automated evidence SHALL falsifiably cover:

- **W1 Isolation:** no Wallet, merchant, agent, or operator can access unrelated Wallet data.
- **W2 Key custody:** Counter services never possess an agent private key.
- **W3 Non-custody:** no stored balance, pooled funds, or raw payment credential exists.
- **W4 Authority intersection:** no action exceeds any buyer, mandate, merchant, provider, or platform bound.
- **W5 Exact consent:** consequential execution binds the current merchant, quote digest, amount/currency, destination, operation, and payment reference.
- **W6 Atomic cumulative limits:** concurrency cannot exceed rolling/aggregate constraints.
- **W7 Revocation:** accepted revocation blocks every future consequential effect.
- **W8 At-most-one effect:** retries from one intent produce at most one corresponding order/payment effect.
- **W9 Provider truth:** Wallet/agent state cannot independently confirm payment.
- **W10 Explicit uncertainty:** unknown effects remain Indeterminate.
- **W11 Model containment:** model tools cannot access secrets or mutate authority/policy.
- **W12 Evidence integrity:** claims remain source-labelled and receipts verify/supersede immutably.
- **W13 Geography correctness:** India restrictions use verified legal/settlement/delivery data, not IP/TLD alone.
- **W14 Capability honesty:** Wallet offers only healthy Released merchant and protocol operations.

## 15. Private pilot gate

Counter Agent Wallet SHALL NOT be released beyond the named cohort until every applicable gate in `PILOT.md` has linked evidence. The pilot may autonomously execute test transactions inside a pre-signed bounded `CounterTestAuthorization`; it SHALL NOT be represented as live delegated UPI, loaded-wallet spending, AP2/UAP conformance, or production real-money autonomy.