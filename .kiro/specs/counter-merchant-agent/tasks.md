# Implementation Plan

**Feature:** Counter Merchant  
**Version:** 3.1  
**Status:** Planned task sequence  
**Requirements:** `.kiro/specs/counter-merchant-agent/requirements.md`  
**Design:** `.kiro/specs/counter-merchant-agent/design.md`  
**Depends on:** `.kiro/specs/counter-platform-foundation/tasks.md`

## Overview

> Foundation packages are dependencies, not duplicated tasks. Razorpay Standard Checkout is a human-present test path; autonomous test payment uses the Counter test provider until an approved delegated rail exists.

## Task Dependency Graph

Foundation prerequisites are cited per task. Merchant tasks execute in numeric order by default: Gate A and scaffolding precede connector/runtime work; tasks 14–19 compose and operate the payment/order paths; task 20 supplies the independent reference corpus; task 21 certifies the candidate.

## Notes

- Shopify and Razorpay completion requires the external Gate A access and decisions named in task 1.
- `CounterTestPaymentProvider` and Razorpay Standard Checkout remain separate test-only paths.
- A checked task includes its implementation, negative tests, and linked evidence.

## Tasks

- [ ] 1. Complete Merchant Gate A integration decisions
  - Create the Shopify development store/app and record shop identity without committing credentials.
  - Pin the stable Shopify Admin API version, OAuth/install method, least scopes, webhook topics, and API cost/rate behavior.
  - Prove the draft-order, finalization/external-payment recording, query, cancellation, and full-refund test sequence manually against the store.
  - Obtain Razorpay test credentials, configure capture/webhook behavior, and record the exact Standard Checkout test profile.
  - Freeze typed verification methods for merchant administrator authority, merchant-controlled domain or reviewed development-store limitation, Shopify shop identity, and exact Razorpay test-account ownership; document evidence, expiry, revalidation, and manual-review fallback.
  - Decide the pilot tax/shipping calculation source and mark unsupported behavior explicitly.
  - Archive permitted schemas/fixtures and cite official sources in the adapter manifest.
  - _Requirements: activation, connectors, payment, conformance; Foundation tasks 1–3_

- [ ] 2. Scaffold Merchant packages and application slices
  - Add commerce-graph, merchant-application, merchant-policy, Shopify connector, reference connector, Razorpay test adapter, and merchant-contract packages.
  - Register merchant routes/jobs through foundation application boundaries.
  - Enforce dependency rules preventing direct Wallet/private foundation persistence access.
  - Add package-level test harnesses and safe configuration placeholders.
  - _Requirements: tenancy, connector contract, security; Foundation tasks 2–5, 14_

- [ ] 3. Implement merchant tenancy, lifecycle, invitation, and ownership verification
  - Add merchant organization/environment, allowlist invitation, roles, lifecycle transitions, and immutable activation snapshot.
  - Implement typed `MerchantOwnershipVerification` records and the Gate A-selected administrator/domain, Shopify shop, and Razorpay test-account proof flows, including formally reviewed manual evidence where no provider API can prove ownership.
  - Bind verification method, subject/target, verifier, evidence digest/reference, observation/expiry, result, and revalidation to activation without storing secret-bearing screenshots.
  - Add suspension, kill switch, reactivation review, and offboarding foundations.
  - Test UI/API bypass, cross-tenant references, wrong/expired/revoked domain/shop/provider account, mismatched legal subject, environment isolation, and transition races.
  - _Requirements: sections 3–4, 15–17; Foundation tasks 5, 14–16_

- [ ] 4. Implement the connector SDK contract and certification harness
  - Define manifests, resource/read/action ports, source observations, freshness, errors, health, and capability-level status.
  - Add contract fixtures for pagination, rate limiting, retries, stale data, timeout-before/after-effect, events, idempotency, and query resolution.
  - Ensure arbitrary SQL/model mutation is impossible through the contract.
  - _Requirements: sections 5–6, 16; Foundation tasks 6, 9–10_

- [ ] 5. Build the generic REST reference merchant
  - Implement synthetic apparel catalog, variants, price/inventory, quote, draft/order, cancel, and full-refund simulation.
  - Add deterministic event stream and fault controls for delay, duplicate/reorder, malformed data, stale source, conflict, and ambiguous write.
  - Certify it as a reference implementation while keeping it absent from pilot discovery.
  - _Requirements: sections 5–6, 8, 10, 12–13_

- [ ] 6. Implement Commerce Graph persistence and mapping
  - Add pilot merchant/product/variant/price/inventory/source/mapping/freshness schemas and repositories.
  - Implement deterministic transforms, raw-versus-normalized preview, mapping version publication/rollback, source priority, tombstones, and conflict handling.
  - Add provenance completeness, integer money, variant identity, stale data, and out-of-order observation tests.
  - _Requirements: section 6; Foundation tasks 3–5, 9_

- [ ] 7. Implement Shopify authentication and connector health
  - Implement approved app/OAuth install flow, state/redirect validation, secret references, shop identity/scopes, token rotation/reauthorization behavior, and health checks.
  - Restrict egress and redact all Shopify credentials/payload-sensitive fields.
  - Test revoked/expired token, wrong shop/environment, scope loss/expansion, and SSRF/redirect attacks.
  - _Requirements: sections 3–5, 15; Foundation tasks 5, 10, 14–15_

- [ ] 8. Implement Shopify catalog backfill and incremental sync
  - Add paginated cost-aware GraphQL product/variant/price/inventory reads using the pinned API.
  - Add durable cursors, incremental webhooks, authoritative polling fallback, tombstones/unpublish, retries, and dead letters.
  - Validate webhook signature/source before inbox acceptance; deduplicate and tolerate reorder.
  - Test large representative catalog, throttling, partial failure, missed webhook, stale version, and backfill convergence.
  - _Requirements: sections 5–6, 15–16; Foundation tasks 7, 10, 15_

- [ ] 9. Implement merchant search, product detail, and quote service
  - Index only Released products and expose safe agent projections.
  - Implement variant/quantity resolution, current source checks, pilot tax/shipping rule, immutable quote, expiry, freshness, and CTP digest/signature.
  - Refuse ambiguous/unsupported totals, stale required data, non-INR, non-India, and excluded products.
  - Add arithmetic, digest, material-change, expiry, and concurrent inventory tests.
  - _Requirements: sections 6–10; Foundation tasks 4, 6, 8–9, 14_

- [ ] 10. Implement merchant policy compiler and simulation
  - Build typed policy configuration for product/category, INR, quantity/count, India destination, operating window, freshness, payment path, review, cancellation, and refund.
  - Compile to shared Policy Engine constraints and render deterministic plain-language summaries.
  - Simulate representative Wallet authorities and reject ambiguous/invalid rule sets.
  - Test buyer/merchant intersection and policy rollback/version behavior.
  - _Requirements: section 7; Foundation task 8_

- [ ] 11. Implement readiness engine and Capability Manifest
  - Implement typed checks and Blocking/Accepted Limitation/Advisory/Expiring lifecycle.
  - Bind scenario evidence and all connector/mapping/policy/payment/protocol versions to activation.
  - Generate/sign the pilot Capability Manifest and evaluate runtime health/suspension without adding capabilities.
  - Test expired evidence, limitation acknowledgment, activation races, and discovery/runtime consistency.
  - _Requirements: sections 4, 7–8, 15–17; Foundation tasks 6, 9, 13–15_

- [ ] 12. Implement Shopify typed draft/order actions
  - Implement the Gate A-selected draft create/query/finalize/payment-record/query/cancel/full-refund action subset.
  - Propagate Counter correlation metadata and prove safe query/idempotency behavior for each mutation.
  - Normalize user errors, throttle, timeout-before-effect, timeout-after-effect, and unsupported state.
  - Add development-store contract tests and process-kill recovery tests around each effect.
  - _Requirements: sections 5, 10, 12; Foundation tasks 6, 9–10_

- [ ] 13. Implement native Merchant runtime APIs
  - Add signed capability, search, product, quote, transaction create/status, payment-action-result, cancel, refund, and receipt routes for the exact pilot subset.
  - Apply CTP authority, revocation, bilateral policy, optimistic version, idempotency, and safe errors.
  - Generate OpenAPI and test unauthorized existence leakage, validation, review-required, stale, and Indeterminate responses.
  - _Requirements: sections 7–10, 13; Foundation tasks 6–10, 14_

- [ ] 14. Implement autonomous Counter test-provider checkout
  - Compose signed mandate/intent, policy decision, Shopify draft, deterministic test payment, fresh continuation decision, selected Shopify finalization, query, reconciliation, and receipt.
  - Hard-bind test authorization/provider to non-live environment.
  - Implement the state-by-state amount/rolling reservation and attempt-count accounting table, including decline, expiry, pending/Indeterminate, confirmed payment, failed order finalization, and confirmed/pending refund.
  - Revalidate authority, revocation, policy, quote/draft binding, capability/kill switches, transaction version, and accounting immediately before Shopify finalization.
  - Test success, decline, policy denial/narrowing, revocation at every effect boundary, quote/approval expiry or change, duplicate/concurrent request, provider/order ambiguity, compensation, accounting release/hold, and false agent claim.
  - _Requirements: sections 9–13, 16–17; Foundation tasks 7–13, 18_

- [ ] 15. Implement Razorpay test adapter and hosted action
  - Create provider Orders server-side for exact INR amount/currency/correlation.
  - Generate client-safe Standard Checkout configuration containing public Key ID only.
  - Verify callback signature server-side but require provider query/verified event for confirmed state.
  - Verify raw webhook signatures, deduplicate event IDs, tolerate reorder, query state, and normalize full refund behavior.
  - Test success, decline, pending/late, forged callback, wrong amount/order, duplicate/reordered webhook, timeout, and refund.
  - _Requirements: section 11; Foundation tasks 8, 10–12, 14–15_

- [ ] 16. Compose the human-present Razorpay certification workflow
  - Create and verify Shopify draft before payment action.
  - Persist a short-lived `PaymentActionGrant` bound to transaction/version, mandate, approval, quote/draft digest, amount/currency, payment reference, merchant, and earliest expiry.
  - Return structured `PAYMENT_ACTION_REQUIRED` to Wallet/browser and require explicit user checkout action.
  - After provider-confirmed captured test state, run a post-payment continuation gate that reacquires provider effect time, current agent/key/mandate/revocation, intent/approval/quote validity, payment reference, buyer/merchant/platform policy, capability health, kill switches, transaction/draft binding, and limit accounting.
  - Finalize Shopify only on a fresh continuation decision; otherwise block finalization, create an authority/policy mismatch finding, and execute an idempotent policy-authorized test refund or human task when prerequisites are conclusive.
  - Implement every compensation and limit-accounting branch and preserve Indeterminate outcomes.
  - Test expiry, policy narrowing, revocation, payment-reference change, merchant/payment kill switches, and draft/amount change at action launch, provider capture, event processing, and immediately before finalization.
  - Prove no Standard Checkout flow is described as unattended autonomy.
  - _Requirements: sections 9–13, 16–17; Foundation tasks 8–13_

- [ ] 17. Implement reconciliation, findings, and Merchant receipts
  - Normalize Shopify draft/order/fulfillment/refund and test-provider/Razorpay observations.
  - Reconcile Wallet intent/agent claim/quote/merchant/provider views and create typed findings.
  - Implement allowed compensation commands and merchant human tasks.
  - Produce Merchant audience receipt view sharing the canonical transaction digest with Wallet view.
  - _Requirements: section 13; Foundation tasks 12–13_

- [ ] 18. Build the Merchant Console pilot screens
  - Implement invite/lifecycle, Shopify setup/health, mapping preview, policy simulation, Razorpay test status, readiness/scenario runner, manifest activation, transaction timeline, findings/actions, kill switches, audit/export, suspension, and offboarding.
  - Use API-only mutations with step-up/role checks; redact write-only secrets.
  - Add accessibility, responsive, authorization, stale-version, and unsafe-action confirmation tests.
  - _Requirements: sections 3–4, 7–8, 14–15_

- [ ] 19. Add merchant operations, telemetry, and recovery evidence
  - Contribute merchant-scoped typed operator APIs and Operations Console projections for Shopify, Razorpay/test-provider, workflow, reconciliation, findings, queues/dead letters, previewed replay, kill switches, and scoped support; the foundation retains ownership of the console shell and common authorization.
  - Add connector/payment/workflow/reconciliation dashboards, alerts, replay commands, support grants, and runbooks.
  - Exercise token/webhook secret rotation, backup/restore, Shopify outage, Razorpay outage, queue backlog, worker crash, and merchant offboarding.
  - Scan all storage/telemetry/artifacts for credentials, raw payment data, and unnecessary customer data.
  - _Requirements: sections 13–16; Foundation tasks 15–16, 18–19_

- [ ] 20. Build the deterministic reference buyer and scenario corpus
  - Implement `apps/reference-buyer` as an independent Native client using only published CTP/runtime contracts, generated clients, public key discovery, and the independent receipt verifier; prohibit Merchant-internal imports and direct database/service shortcuts.
  - Add deterministic test identity, mandate, intent, and approval setup plus scenario drivers for discovery, quote, autonomous test payment, `PAYMENT_ACTION_REQUIRED`, status, cancellation, full refund, reconciliation, and receipt supersession.
  - Version a reusable corpus with deterministic clocks/IDs, commands, fault schedules, expected normalized decisions/states/invariants, and no provider secrets or brittle external IDs.
  - Cover false agent claims, material changes, policy/limit boundaries, revocation, duplicate/concurrent calls, timeout/Indeterminate, reordered events, process recovery, late capture/continuation denial, and compensation.
  - Publish the corpus and execution contract for Counter Agent Wallet parity.
  - _Requirements: sections 8–13, 16–17; Foundation tasks 6–13, 18_

- [ ] 21. Certify the Merchant pilot candidate
  - Run every applicable `PILOT.md` scenario through `apps/reference-buyer` across the generic reference connector, Shopify autonomous test-provider path, and Shopify/Razorpay human-present path.
  - Verify every terminal result with the independent receipt verifier.
  - Produce connector/payment/profile evidence bundle and signed merchant Capability Manifest.
  - Generate clause-level Merchant requirement → design symbol → task → test/manual-evidence traceability, including every depended-on foundation clause and corpus scenario.
  - Keep ACP/AP2/UAP/x402 and live payment absent from discovery and claims.
  - Do not mark Released until the named cohort and cross-spec Gate D approvals exist.
  - _Requirements: section 17; Foundation task 20_
