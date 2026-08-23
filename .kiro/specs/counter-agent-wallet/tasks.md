# Implementation Plan

**Feature:** Counter Agent Wallet  
**Version:** 3.1  
**Status:** Planned task sequence  
**Requirements:** `.kiro/specs/counter-agent-wallet/requirements.md`  
**Design:** `.kiro/specs/counter-agent-wallet/design.md`  
**Depends on:** `.kiro/specs/counter-platform-foundation/tasks.md` and Merchant runtime contracts

## Overview

> The hosted Wallet never holds money or the agent private key. MCP is a local adapter. Razorpay Standard Checkout remains human-present; only the Counter test provider can demonstrate unattended pilot payment execution.

## Task Dependency Graph

Foundation and Merchant contract prerequisites are cited per task. Wallet tasks execute in numeric order by default: Gate A/scaffolding precede identity and policy; those precede clients/tools and end-to-end flows; task 20 certifies parity against Merchant task 20 and the complete Wallet candidate.

## Notes

- The foundation owns the `SecureKeyStore` port and harness; Wallet owns production OS adapters and packaging.
- Hosted services never receive the agent private key, and no Wallet surface models a stored balance.
- A checked task includes implementation plus every stated negative, parity, and evidence check.

## Tasks

- [ ] 1. Complete Wallet Gate A decisions
  - Pin the official MCP protocol/TypeScript SDK and stdio profile; record supported first AI host(s).
  - Select the pilot human identity provider, invitation/session, and step-up method.
  - Select/prototype Windows secure storage and record assurance/portability limitations.
  - Freeze principal-consent attestation semantics and future stronger-signature migration.
  - Decide local packaging/update signing, browser/loopback handoff, diagnostics, uninstall, and key-removal behavior.
  - Archive permitted MCP fixtures/docs and add exact profile metadata.
  - _Requirements: identity, MCP, security; Foundation tasks 1–3, 17_

- [ ] 2. Scaffold Wallet hosted and local packages
  - Add wallet-domain, wallet-application, wallet-contracts, wallet-client, local-signer, MCP adapter, and receipt-verifier packages.
  - Contribute Wallet routes to the control plane and create Wallet Console/local MCP app shells.
  - Enforce no imports from merchant provider/connector implementation packages and no hosted private-key interface.
  - Add safe configuration placeholders and package test harnesses.
  - _Requirements: sections 3–13; Foundation task 2_

- [ ] 3. Implement Wallet account, invitation, and isolation
  - Add Wallet/principal/invite/lifecycle schemas, scoped repositories/RLS, roles, and server-side state transitions.
  - Integrate selected human auth boundary with pilot invite allowlist and independent principal reference.
  - Implement suspension/recovery-lock/offboarding/closure gates before mutations.
  - Test Wallet↔Wallet, Merchant↔Wallet, operator/support, guessed-ID, and environment isolation.
  - _Requirements: sections 3–4, 12–14; Foundation tasks 5, 14, 16_

- [ ] 4. Implement human step-up and principal consent attestation
  - Require recent step-up for policy widening, agent/key/payment-reference changes, mandate consent, approvals, recovery, export, and closure.
  - Generate a separate CTP `counter.principal-consent-attestation.v1` artifact with exact digest, auth method/assurance/time, audience, expiry, nonce, and revocation; later mandates reference its digest rather than merging with it.
  - Render consent text/version and immutable audit evidence.
  - Test session downgrade, stale step-up, replay, wrong digest/audience, self-bypass, concurrent changes, and assurance non-inflation: service-witnessed consent must fail any rule requiring direct principal/WebAuthn/external proof.
  - _Requirements: sections 4, 6–7, 12–13; Foundation tasks 6–8, 14_

- [ ] 5. Implement the Windows `SecureKeyStore` adapter and local signer core
  - Consume the foundation-owned `SecureKeyStore` port and conformance harness; implement the Gate A-selected Windows production adapter without redefining the contract.
  - Generate an Ed25519 agent key, expose its public descriptor, sign canonical CTP bytes, store a scoped device credential, and revoke local material.
  - Keep OS-specific behavior behind Wallet-owned adapters and prevent private-key export through APIs, MCP, logs, errors, crash reports, and diagnostics.
  - Pass the foundation harness plus Wallet tests for lock/unlock, corrupt/missing storage, concurrency, process restart, key rotation/revocation, assurance limitations, and prohibited extraction.
  - _Requirements: section 5, 13–14; Foundation tasks 6, 17_

- [ ] 6. Implement secure device pairing and agent registration
  - Create short-lived one-time pairing request/URL/code with proof-of-possession.
  - Implement principal review/step-up approval, atomic consume, scoped device credential, stable Agent URI, registration certificate, and notifications.
  - Add expiry, cancellation, replay, wrong-Wallet/environment, interception, and duplicate registration tests.
  - Ensure pairing grants no mandate or transaction authority.
  - _Requirements: sections 4–5, 13; Foundation task 7_

- [ ] 7. Implement buyer policy persistence and editor contracts
  - Add immutable policy versions for merchant/domain, India geography, category/SKU, INR amount/rolling/count/quantity, operation, payment reference, trigger/time, approval, and validity.
  - Implement deterministic validation, plain-language rendering, simulation, widening step-up, narrowing/emergency behavior, and version history.
  - Test India metadata semantics, overlapping constraints, boundary values, rollback attempts, and agent/MCP mutation denial.
  - _Requirements: section 6, 14; Foundation task 8_

- [ ] 8. Implement mandate issuance, sync, and revocation
  - Issue signed bounded mandates only from current stepped-up consent and registered agent/public key.
  - Implement local fetch/verify/cache with conservative stale behavior.
  - Add monotonic Wallet/agent/key/mandate/trigger/payment-reference revocation and immediate future-effect enforcement.
  - Test policy widening/narrowing, expiry, wrong key/merchant/payment reference, replay, revocation races, and historical evidence.
  - _Requirements: sections 6–7; Foundation tasks 6–8_

- [ ] 9. Implement opaque test payment references
  - Create Wallet APIs/UI model for `CounterTestAuthorization` references with explicit `test_only` environment and bounds.
  - Require step-up for reference changes and reevaluate/revoke affected mandates.
  - Prohibit balance/top-up/raw credential fields in schemas and surfaces.
  - Test attempts to submit test references to live adapters and no-secret/no-balance invariants.
  - _Requirements: section 8, 14; Foundation task 11_

- [ ] 10. Implement typed Wallet and Merchant runtime clients
  - Generate clients from versioned contracts for capability, search, product, quote, transaction, action, status, and receipt.
  - Verify signed merchant manifest, environment/domain/India metadata, operation health, quote digest/freshness, and server identity.
  - Normalize safe errors and preserve Indeterminate/review/action-required states.
  - Test malicious/malformed responses, downgrade, stale manifest, unknown extension, and network timeout.
  - _Requirements: sections 9–10, 13–14; Merchant tasks 9, 11, 13_

- [ ] 11. Implement local policy precheck and signed proposal/intent
  - Implement conservative local verification of current signed policy/mandate/revocation and merchant quote.
  - Create effect-free purchase proposals and exact CTP purchase intents with stable idempotency/trigger context.
  - Sign only through `SecureKeyStore`; submit through typed runtime client.
  - Test material changes, stale cache, local/hosted disagreement, duplicate/concurrent calls, and model-supplied field substitution.
  - _Requirements: sections 6–7, 10, 14; Foundation tasks 6–10_

- [ ] 12. Implement approval and action inbox
  - Create approval tasks bound to exact intent/quote/transaction version and expiry.
  - Implement Wallet Console step-up approve/deny, notifications, status polling, and stale/material-change invalidation.
  - Add structured `PAYMENT_ACTION_REQUIRED` records and short-lived browser handoff without embedding payment credentials.
  - Test self-approval via MCP, approval replay/expiry, phishing-resistant binding display, and action-link leakage/expiry.
  - _Requirements: sections 4, 7–10, 13_

- [ ] 13. Implement MCP server and read tool profile
  - Build local stdio MCP server with pinned SDK/profile and safe initialization/version metadata.
  - Implement Wallet status, merchant list, search, product, quote, transaction, pending-action, and receipt-verification tools.
  - Generate/validate strict schemas, safe structured errors, timeouts, cancellation, and redacted local diagnostics.
  - Test supported AI host connection plus malformed/adversarial calls and untrusted merchant content.
  - _Requirements: section 9–10, 13–14_

- [ ] 14. Implement consequential MCP tools and hard denylist
  - Add effect-free proposal, exact purchase execution, cancel, and refund-request tools.
  - Require current local/hosted policy, mandate, intent, transaction version, and stable idempotency.
  - Ensure no tool/resource/prompt exists for private key/payment secret export, policy/allowlist/limit/payment-reference mutation, principal approval, recovery, or settlement assertion.
  - Add reflection/listing tests proving forbidden capabilities are absent and runtime tests proving direct calls are denied.
  - _Requirements: section 9, 14_

- [ ] 15. Prove autonomous Counter test-provider purchase
  - Execute prompt-triggered below-threshold purchase from MCP through signed intent, Merchant Runtime, Counter test payment, Shopify test order, reconciliation, and verified receipt.
  - Test above-threshold review, policy denial, revocation, amount/rolling limits, non-India, category, quote change, duplicates, timeout/Indeterminate, and false model claims.
  - Ensure every output and receipt identifies test-only status.
  - _Requirements: sections 6–11, 14; Merchant task 14_

- [ ] 16. Implement Razorpay human-action Wallet flow
  - Render structured hosted payment action with exact merchant/items/INR total/expiry and explicit human requirement.
  - Open/display action only through approved user interaction; never automate OTP, PIN, bank approval, or payment details.
  - Poll/subscribe to server-side provider, continuation, Shopify, reconciliation, and refund state; display provider-confirmed payment separately from order confirmation.
  - If late capture meets an expired/revoked/policy-blocked/kill-switched continuation, show Shopify finalization blocked plus the finding and refund-pending/refund-confirmed/human-remediation outcome; never collapse it into purchase success.
  - Test close/cancel, expired link, forged callback, late capture before/after revocation or expiry, continuation denial, provider mismatch, Indeterminate remediation, and refund state.
  - _Requirements: sections 8–11, 14; Merchant tasks 15–16_

- [ ] 17. Implement local time-trigger scheduler
  - Create triggers only through Wallet Console and bind policy/mandate/template/schedule/window/count/value/expiry.
  - Execute locally with occurrence-level idempotency and fresh quote/policy/revocation checks.
  - Stop on stale/material change/review/payment action/unknown state and support emergency revocation.
  - Restrict pilot triggers to Counter test provider; test restart, clock boundary, duplicate tick, offline period, and missed occurrence policy.
  - _Requirements: sections 6–7, 9–10, 14_

- [ ] 18. Implement claim ledger, findings, and receipt verification
  - Store source-labelled model request/proposal/local decision/intent/hosted decision/merchant/provider claims.
  - Consume audience-scoped findings/receipts and verify schema, signature, audience, key, canonical digest, and supersession locally.
  - Mark invalid/untrusted evidence without overwriting history and expose safe diagnostics.
  - Test false success/failure, wrong audience/key, tampering, cross-view equivalence, and superseding refund receipt.
  - _Requirements: section 11, 14; Foundation tasks 12–13_

- [ ] 19. Build Wallet Console pilot screens and disclosure projection
  - Implement invite/enrollment, pairing/agents/devices, policy editor/simulation, payment-reference status, mandate/consent/revocation, approval/action inbox, transactions/claims/findings/receipts, triggers, security/recovery, export, suspension, and closure.
  - Implement the deterministic audience-specific data-disclosure projection before mandate consent, transaction approval, and hosted payment action; bind its digest and invalidate consent/approval if recipients or fields expand.
  - Ensure no balance/top-up UI or secret/key rendering, and show only the minimum fields sent to Counter Merchant, Shopify, the selected test provider, and Counter services with purpose and retention class.
  - Add accessible/responsive views, exact-binding confirmation, stale-version handling, role/step-up checks, disclosure expansion, recipient substitution, and data-minimization tests.
  - _Requirements: sections 3–13_

- [ ] 20. Implement recovery, export, closure, operations, and pilot evidence
  - Build recovery lock, independent verification, device/key/mandate revocation, re-registration, notifications, and no-private-key recovery behavior.
  - Implement scoped export, retention/hold, deletion/anonymization, closure ordering, and closure receipt.
  - Add local/hosted metrics, security anomaly alerts, kill switches, runbooks, packaging/update/uninstall validation, backup/restore, and support tooling.
  - Run all `PILOT.md` Wallet scenarios with the supported MCP host and prove parity against Merchant task 20's versioned `apps/reference-buyer` corpus through public contracts: equivalent normalized decisions, states, canonical transaction digests, findings, and receipts for equivalent inputs.
  - Generate clause-level Wallet requirement → design symbol → task → test/manual-evidence traceability, including depended-on foundation/Merchant clauses and every reference-corpus scenario.
  - Produce the evidence bundle; do not claim loaded wallet, live autonomy, AP2/UAP/x402 conformance, or GA.
  - _Requirements: sections 3–15; Foundation tasks 15–20; Merchant tasks 20–21_
