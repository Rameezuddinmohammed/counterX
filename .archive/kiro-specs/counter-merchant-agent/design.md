# Design Document

> **RETIRED — historical planning artifact.** Written during early feature planning, before implementation. `CLAUDE.md`'s own source-of-truth hierarchy already marks `.kiro/specs/**/tasks.md` as stale for completion status; this applies to this whole spec bundle. For current, verified state, see `HANDOFF.md` and `README.md`.


**Feature:** Counter Merchant  
**Version:** 3.1  
**Status:** Proposed pre-Gate-A executable design  
**Requirements:** `.kiro/specs/counter-merchant-agent/requirements.md`  
**Foundation:** `.kiro/specs/counter-platform-foundation/design.md`

## Overview

Counter Merchant turns one allowlisted Shopify development/test store into a safe agent-facing merchant. It imports authoritative commerce data into the Commerce Graph, publishes a signed Capability Manifest, evaluates merchant policy alongside Wallet authority, orchestrates test checkout/order effects, and reconciles Shopify and payment-provider evidence.

The implementation consumes shared foundation packages. It does not create alternate identity, policy, workflow, payment, evidence, or receipt semantics.

## Architecture

```text
Merchant Console ──> Control Plane API
                         │
                  activation/readiness
                         │
Shopify Admin API ─> Shopify Connector ─> Commerce Graph
       │                    │                   │
   webhooks            typed actions           ▼
       └──────────────> Worker <──── Agent Runtime API
                              quote/checkout/status
                                      │
                              PaymentProvider port
                              ├─ Counter test provider (unattended test path)
                              └─ Razorpay test adapter (hosted human-present path)
                                      │
                              Evidence/Reconciliation
                                      │
                                  Signed receipt
```

### Important payment-channel constraint

Razorpay Standard Checkout requires server-side order creation, a browser-hosted checkout, and a direct user action to open the payment UI. Its browser callback is not payment truth; server verification, capture state, webhooks, and provider queries are required. Therefore:

- the **unattended autonomous test scenario** uses `CounterTestAuthorization` plus a deterministic `CounterTestPaymentProvider` and is unmistakably test-only;
- the **Razorpay integration certification scenario** is human-present at the hosted checkout step, then autonomous for verification, Shopify completion, reconciliation, and receipts;
- Counter SHALL NOT automate PIN/OTP/bank approval or describe Standard Checkout as unattended delegated payment;
- a later approved mandate rail may replace the payment-action step through the same ports.

This preserves both core-autonomy testing and honest provider behavior.

Official behavior references to pin at implementation:

- [Shopify `draftOrderCreate`](https://shopify.dev/docs/api/admin-graphql/latest/mutations/draftOrderCreate?language=graphql)
- [Shopify `draftOrderComplete`](https://shopify.dev/docs/api/admin-graphql/2026-04/mutations/draftOrderComplete)
- [Shopify `orderMarkAsPaid`](https://shopify.dev/docs/api/admin-graphql/latest/mutations/orderMarkAsPaid)
- [Razorpay Standard Checkout](https://razorpay.com/docs/developer-tools/integrations/standard-checkout/?preferred-country=IN)
- [Razorpay webhook validation/testing](https://razorpay.com/docs/webhooks/validate-test/?preferred-country=IN)

Exact Shopify API version and payment-recording mutation are Gate A decisions proven against the development store. Content from these sources is summarized rather than reproduced.

## Components and Interfaces

```text
apps/
  merchant-console/
  control-plane-api/        # merchant routes contributed here
  agent-runtime/            # merchant discovery/search/quote/checkout routes
  worker/                   # connector sync/actions/provider/reconciliation jobs
  reference-services/       # generic REST fixture merchant
  reference-buyer/          # independent Native client and versioned scenario harness

packages/
  commerce-graph/
  merchant-application/
  merchant-policy/
  shopify-connector/
  reference-connector/
  razorpay-test-adapter/
  merchant-contracts/
```

Merchant packages depend on foundation domain ports, not Wallet UI/MCP internals.

## Merchant lifecycle and activation

The lifecycle is implemented as a server-side state machine:

```text
DRAFT → CONNECTING → MAPPING → VERIFYING → SANDBOX_READY
      → ACTIVATION_REVIEW → ACTIVE
```

Side states are `ACTIVE_DEGRADED`, `SUSPENDED`, `OFFBOARDING`, and `CLOSED`.

### Activation record

An activation candidate pins:

- merchant/environment and allowlist entry;
- administrator/domain verification evidence;
- Shopify shop identity, API version, scopes, connector build;
- mapping and source-priority versions;
- merchant policy version;
- CTP/Native/MCP profile versions;
- payment adapter/environment/method class;
- scenario evidence bundle;
- Accepted Limitations and acknowledgment;
- Capability Manifest digest.

Activation is one atomic server command. Runtime discovery reads the activated immutable snapshot, not mutable wizard drafts.

### Merchant and provider ownership verification

Activation requires typed `MerchantOwnershipVerification` records rather than possession of working credentials alone. Each record identifies target type/ID, merchant/legal subject, method, verifier actor, source evidence digest/reference, observed/expiry time, result, and revalidation rule.

- Administrator authority is verified through the allowlisted principal and stepped-up merchant-admin flow.
- Domain control uses an approved DNS/HTTP challenge where a merchant-controlled domain exists; a Shopify development-store-only profile may use a documented operator-reviewed limitation bound to the authenticated shop identity.
- Shopify ownership is bound from the provider-authenticated install/OAuth shop identity and approved scopes.
- Razorpay test-account ownership is bound using the strongest account identity evidence exposed by the selected test profile. If the API cannot establish legal ownership, activation requires a formally reviewed manual proof from the authenticated merchant dashboard/account, with reviewer, evidence digest, expiry, and Accepted Limitation. Credential validity alone is insufficient.

Wrong-domain, wrong-shop, wrong-account, expired, revoked, or mismatched-subject evidence is Blocking. Ownership records and their digests are pinned into the activation snapshot without storing dashboard screenshots containing secrets.

### Readiness checks

Checks are typed and repeatable. Blocking pilot checks include Shopify identity/scopes, catalog mapping, freshness, quote arithmetic, typed order action, webhook verification, payment test configuration, policy, idempotency, reconciliation, signing key, and kill switches. An Expiring check automatically reevaluates before expiry.

## Shopify connector

### Authentication and scope

The connector uses a Shopify app/OAuth flow appropriate to the selected development-store setup. Tokens are held only through the foundation secret-reference boundary. Requested Admin API scopes are the least set required for pilot reads, draft/order actions, refunds if selected, and webhooks. Scope expansion forces readiness review.

### Read model

The connector imports:

- shop identity/currency/domain metadata;
- products, variants, options, status, media references;
- prices and compare-at prices where applicable;
- inventory availability required by the pilot;
- order, payment/financial status metadata, fulfillment, cancellation, and refund observations required for reconciliation.

Every field maps with Shopify global ID, source version/update time, observed time, mapping version, and freshness. Unsupported Shopify constructs are marked rather than flattened into misleading pilot products.

### Synchronization

- initial paginated GraphQL backfill;
- incremental webhooks for selected topics;
- periodic reconciliation polling for missed/out-of-order events;
- inbox deduplication by source/topic/event ID;
- cursor/backoff/cost-aware GraphQL request control;
- tombstone/unpublish handling;
- dead-letter with merchant-safe diagnostics.

No webhook mutates canonical state before signature/source verification and durable inbox acceptance.

### Quote

The pilot quote service accepts exact variant IDs/quantities and India destination input, loads current released Commerce Graph data, optionally refreshes authoritative fields within configured budgets, applies merchant pricing/shipping/tax behavior selected in Gate A, and emits `counter.merchant-quote.v1`.

If Shopify cannot supply an authoritative tax/shipping amount in the selected path, the manifest must either define a deterministic merchant-approved pilot rule or mark the operation unsupported. Counter never invents a total.

The quote is immutable and digest-bound. Reservation is `NOT_SUPPORTED` unless separately verified.

### Typed actions

Pilot action candidates:

- `create_draft_order`;
- `complete_draft_order` or the exact selected order-finalization action;
- `query_draft_order` / `query_order`;
- `cancel_order` where state permits;
- `record_external_test_payment` using a selected supported Shopify mutation/profile;
- `create_full_refund` only if the development-store/provider flow proves correct behavior.

Each action has a source query/idempotency correlation strategy. Shopify mutations that lack native idempotency are protected by Counter workflow uniqueness plus search/query by Counter correlation metadata; the exact safe strategy must be proven before release.

## Generic REST reference connector

The reference service implements the same connector contract with deterministic synthetic apparel data and fault controls. It supports reads, quote, draft/order create/query, cancel, and full refund simulation. Test controls inject latency, timeout-before-effect, timeout-after-effect, duplicate/reordered events, stale data, conflict, and malformed response.

It is used to prove connector neutrality and resilience. It is not advertised as a supported pilot merchant connector.

## Data Models

Pilot entities:

```text
MerchantProfile
SourceProduct → Product
SourceVariant → Variant
PriceSnapshot
InventorySnapshot
MerchantQuote
SourceDraftOrder
SourceOrder
SourceFulfillment
SourceRefund
ConnectorObservation
MappingVersion
FreshnessPolicy
```

Canonical product identity is stable within a merchant/environment and maps to one or more immutable source references. Search indexes only Released, merchant-visible products. Private source fields never enter agent projections.

Updates use observed/source version ordering. Older webhooks cannot overwrite newer state. Equal/unknown conflicts create findings or trigger authoritative requery.

## Capability Manifest

The activation service signs a manifest containing:

- merchant and environment IDs;
- verified domains and India legal/settlement/delivery scope;
- apparel vertical/profile;
- exact Native/MCP/CTP/connector/payment versions;
- search/quote/checkout/status/cancel/refund operations actually released;
- INR and profile ceilings;
- quote freshness/expiry and reservation limitation;
- authority/approval requirements;
- test-provider or Razorpay human-action payment mode;
- known limitations, health, evidence bundle, and expiry.

Runtime health can make a released operation temporarily Degraded/Suspended, but cannot add an unactivated operation.

## Merchant policy

Merchant policy compiles UI configuration into shared deterministic constraints:

- released products/categories;
- INR value/quantity/count limits;
- India destination;
- operating windows;
- freshness thresholds;
- permitted payment path;
- cancellation/refund eligibility;
- review threshold;
- allowed agent/assurance classes where configured.

Compilation rejects ambiguous rules. Simulation uses synthetic transactions and displays the intersection with a representative Wallet mandate. Runtime calls only the shared Policy Engine.

## Agent Runtime API

Pilot routes are versioned under `/runtime/v1`:

```text
GET  /merchants/{merchantId}/capabilities
POST /merchants/{merchantId}/products/search
GET  /merchants/{merchantId}/products/{productId}
POST /merchants/{merchantId}/quotes
POST /merchants/{merchantId}/transactions
GET  /transactions/{transactionId}
POST /transactions/{transactionId}/payment-action-result
POST /transactions/{transactionId}/cancel
POST /transactions/{transactionId}/refund
GET  /transactions/{transactionId}/receipt
```

Actual path/schema names are frozen in generated OpenAPI. Ownership comes from authenticated context, never arbitrary body fields. Public reads are explicitly allowlisted. Mutations require current CTP authority, policy, version, and idempotency.

## Checkout orchestration

### Common preparation

1. Verify agent/Wallet authority, merchant capability, quote digest/freshness, approval, revocation, limits, and policies.
2. Atomically create transaction, idempotency ownership, durable workflow, and limit reservation.
3. Create/query a Shopify draft order carrying opaque Counter correlation metadata and the exact quote.
4. Verify the draft total/items match the authorized command before any payment effect.

### Autonomous Counter test-provider path

1. Resolve `CounterTestAuthorization` and execute the deterministic test provider.
2. Confirm provider-test evidence.
3. Revalidate current agent/key/mandate/revocation, policy, quote/draft binding, capability/kill switches, transaction version, and limit accounting immediately before Shopify finalization.
4. Finalize the Shopify test order only on a fresh continuation decision; otherwise record the mismatch and compensate/close the deterministic test effect.
5. Query Shopify and provider-test state, reconcile, and issue receipt.

This path is test-only and cannot route to live/provider credentials.

### Razorpay Standard Checkout certification path

1. Create a Razorpay test Order server-side for the exact immutable INR amount/currency and Counter receipt/correlation.
2. Persist a signed `PaymentActionGrant` bound to transaction/version, mandate, approval, quote/draft digest, amount/currency, payment reference, merchant, and expiry no later than the earliest bound expiry.
3. Return a short-lived hosted checkout action to the Wallet/browser; a human explicitly opens/completes it.
4. Treat browser callback fields only as untrusted input; verify callback correlation/signature where supported and require authoritative provider query or verified event evidence.
5. Before any Shopify finalization/payment-recording effect, execute the continuation gate below.
6. Only a valid continuation may finalize/mark the Shopify order according to the pinned Shopify profile; then query both systems, reconcile, and issue a receipt.

Razorpay webhook verification uses the raw body and configured secret, deduplicates the event ID, and handles out-of-order delivery. Late or conflicting payment evidence creates an Indeterminate state/finding.

### Post-payment continuation gate

A provider-confirmed payment is an observed external effect, not permission to create another effect. Immediately before Shopify finalization, Counter SHALL reacquire and evaluate:

- provider payment ID/order, exact amount/currency, captured/paid state, and authoritative effect time;
- transaction version, idempotency ownership, draft/order identity, and exact quote/draft digest;
- `PaymentActionGrant`, intent, approval, quote, and their effective validity at provider effect time;
- current agent key, mandate, payment-reference, and revocation effective times;
- current buyer/platform/merchant policy, merchant capability health, and all relevant kill switches;
- cumulative-limit reservation/accounting state.

If provider evidence proves the effect occurred inside the unexpired action grant and no later revocation/policy/kill switch blocks a new merchant effect, Counter creates a fresh continuation policy decision and may finalize the order. Processing may occur after the original quote expiry only when authoritative provider effect time was inside the bound grant and the Shopify draft still matches the immutable quote; otherwise the continuation is stale.

If payment is captured but the continuation is expired, revoked, policy-blocked, mismatched, or suspended, Counter SHALL NOT finalize Shopify. It records payment evidence plus an authority/policy mismatch finding, then executes an idempotent policy-authorized test refund when prerequisites are conclusive or assigns a human remediation task. If any prerequisite is unknown, the transaction remains Indeterminate and Counter queries authoritative sources without duplicate effects.

Tests place revocation, policy narrowing, expiry, draft/quote change, payment-reference revocation, merchant suspension, and provider/merchant kill switches before action launch, during hosted checkout, at provider capture, before callback/event processing, and immediately before Shopify finalization.

## Error Handling

### Compensation matrix

| Failure | Default safe action |
|---|---|
| Shopify draft fails before payment | Release amount hold; consume attempt according to policy; no payment |
| Payment declined or hosted action canceled/expired before effect | Close attempt, release amount hold, preserve evidence |
| Payment unknown | Indeterminate; retain hold; query provider; no duplicate payment/order completion |
| Payment captured after grant expiry or after applicable revocation | Block Shopify finalization; finding; policy-authorized idempotent test refund or human task |
| Payment captured but continuation policy/capability/kill switch blocks finalization | Block Shopify finalization; finding; refund when conclusively allowed or human task |
| Payment captured, Shopify finalization fails | Retry/query Shopify; if conclusively impossible, policy-authorized test refund or human task |
| Shopify order exists, payment conclusively failed | Cancel unpaid/test order if permitted or human task |
| Duplicate webhook/callback | Deduplicate; no new effect |
| Amount/order/draft mismatch | Block finalization, critical finding, reconcile/refund decision |
| Refund unknown | Indeterminate; retain accounting hold; query provider and Shopify; never claim refunded |

No generic “refund everything” rule exists.

### Limit reservation and attempt accounting

| Outcome | Amount/rolling reservation | Attempt/count accounting |
|---|---|---|
| Durable execution accepted | Reserve exact maximum amount | Consume one attempt once per idempotent intent |
| Draft fails before payment, provider decline, or action expires with proof of no effect | Release amount reservation | Attempt remains consumed for abuse/rate policy unless policy explicitly defines otherwise |
| Payment pending or Indeterminate | Hold reservation until authoritative resolution | Attempt remains consumed |
| Payment captured/paid | Convert reservation to confirmed spend | Attempt remains consumed |
| Shopify finalization fails while payment remains captured | Keep confirmed spend/hold; do not make capacity available | Attempt remains consumed |
| Refund confirmed | Apply the policy's declared gross-versus-net rolling adjustment idempotently; never before provider confirmation | Attempt remains consumed |
| Refund pending/Indeterminate | Do not release confirmed spend/hold | Attempt remains consumed |

Accounting transitions are event-idempotent and replayable. A policy version explicitly states whether confirmed refunds reduce rolling net spend; silent release is forbidden.

## Razorpay test adapter

The adapter implements the shared `PaymentProvider` subset selected for test mode:

- create immutable provider Order/instruction server-side;
- construct client-safe checkout configuration with public Key ID only;
- verify callback signature server-side;
- verify raw-body webhook signature before parsing effects;
- deduplicate and tolerate event reordering;
- query payment/Order/refund authoritative state;
- initiate/query full refund if approved and supported;
- normalize decline, retryable, terminal, and Indeterminate errors.

The Key Secret and webhook secret remain server-side secret references. No method is advertised merely because Razorpay Checkout can render it; discovery reflects methods proven for the exact test account.

## Merchant Console

Pilot screens:

1. invite and merchant identity;
2. Shopify connection/scopes/health;
3. catalog mapping preview and exclusions;
4. merchant policy editor/simulation;
5. Razorpay test configuration/status;
6. readiness findings and scenario runner;
7. Capability Manifest review/activation;
8. transaction state/evidence timeline;
9. approval/exception/finding inbox;
10. cancellation/refund action with prerequisites;
11. connector/payment health and kill switches;
12. audit, export, suspension, and offboarding.

The UI cannot bypass API state machines. Sensitive provider configuration is write-only/redacted after entry.

## Security and privacy

- OAuth state/redirect validation and least Shopify scopes;
- encrypted secret references and rotation;
- webhook raw-body signature validation before durable acceptance;
- egress restricted to pinned Shopify/Razorpay hosts with SSRF defenses;
- customer/address fields stored only when required for the test order and minimized in agent/merchant/operator views;
- no provider secret, CTP private key, or raw payment credential in browser, logs, jobs, events, analytics, receipts, or support;
- merchant suspension and adapter kill switches evaluated before each effect;
- all manual actions typed, reasoned, scoped, and audited.

## Observability

Metrics/traces cover connector freshness/sync cost, webhook age/dedup, search/quote latency, policy outcomes, draft/order action attempts, payment states, Indeterminate age, reconciliation lag, findings, and receipt issuance. Logs carry safe merchant/environment/transaction/correlation IDs and source error classes, not payload secrets or unnecessary customer data.

## Correctness Properties

### Property 1: Merchant execution invariants

The executable Merchant properties are M1–M14 in the requirements plus the fresh-continuation rule in requirement 10.10: tenant/environment isolation, at-most-one effect, authoritative success, explicit uncertainty, bilateral bounds, provenance, payment truth, audit integrity, model containment, adapter separation, honest capabilities, non-custody, recovery convergence, and no post-effect compounding under stale or unknown authority.

## Testing Strategy

- Shopify GraphQL recorded/synthetic contract fixtures plus development-store integration;
- webhook signature, duplicate, reorder, stale version, missing event, and replay tests;
- Commerce Graph mapping/provenance/freshness and search tests;
- quote arithmetic/digest/expiry/material-change properties;
- activation bypass and manifest honesty tests;
- test-provider autonomous path end to end;
- Razorpay human-present test path for success/decline/pending/callback forgery/webhook/query/refund;
- process termination around every Shopify/provider effect;
- compensation and manual-task behavior;
- cross-tenant/customer-data/no-secret tests;
- independent Native client and receipt verifier.

No development-store or provider fixture proves production/live support.

## Requirement traceability

| Merchant requirement area | Design |
|---|---|
| Tenancy/access/lifecycle | foundation scope, activation snapshot, Merchant Console |
| Connector safety | Shopify/reference connectors and typed actions |
| Graph/provenance/freshness | Commerce Graph and synchronization |
| Policy/capabilities | policy compiler and signed manifest |
| Authority/quote binding | shared CTP/policy plus quote service |
| Transaction/idempotency | shared workflow plus checkout orchestration |
| Non-custodial payment | dual test-provider/Razorpay paths |
| Orders/post-purchase | Shopify draft/order and compensation matrix |
| Evidence/receipts | shared evidence/reconciliation and audience view |
| Security/operations | boundary controls, console, telemetry, tests |

## Gate A decisions

Before adapter code is called complete, record:

1. Shopify app type, exact stable Admin API version, scopes, webhook topics, rate/cost behavior, and development-store limitations;
2. exact Shopify draft/finalization/external-payment recording and cancellation/refund sequence proven against the store;
3. catalog tax/shipping calculation method for the pilot;
4. Razorpay test account, Standard Checkout/capture settings, method class, API/webhook versions, and public webhook endpoint approach;
5. human-present Razorpay limitation reflected in the Capability Manifest and Wallet UX.
