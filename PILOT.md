# Counter Private Pilot Profile

**Profile version:** 1.0  
**Document version:** 3.1  
**Status:** Canonical first-release scope  
**Payment environment:** Test mode only  
**Expansion:** Requires a versioned manifest change and gate approval

## 1. Purpose

Prove Counter's core product outcome through one narrow commerce path with two separately declared test-payment modes:

1. **Autonomous test mode:** an invited user's registered agent discovers an invited Shopify merchant, receives an authoritative quote, acts under signed bounded authority, completes a deterministic `CounterTestPaymentProvider` payment, creates/observes the test order, and receives an independently verifiable receipt.
2. **Provider certification mode:** the same bounded transaction reaches Razorpay Standard Checkout test mode, pauses for an explicit human payment action, then autonomously verifies provider evidence, finalizes/observes the Shopify order, reconciles, and issues a receipt.

Duplicate, denied, revoked, stale, and ambiguous outcomes must be safely contained and reconciled in both modes. The first mode proves Counter's bounded autonomous orchestration but not external-provider compatibility; the second proves the Razorpay integration lifecycle but not unattended payment authority.

This pilot validates architecture and operations. It does not validate live money, regulatory approval for unattended UPI, general availability, or universal protocol support.

## 2. Fixed profile

### Geography and currency

- Counter-hosted pilot environment for India;
- merchant legal/settlement country: India;
- delivery country: India;
- currency: INR only;
- geography decisions use verified merchant/delivery metadata, not IP/TLD alone.

### Cohort

- Stage 1: one Counter-operated or named design-partner Shopify development/test store;
- expansion ceiling before Profile 1.1: up to three manually reviewed merchants using the identical connector/capability profile;
- up to 50 invited test users/Wallets;
- one or more registered test agents per Wallet, subject to Wallet policy;
- no public merchant or buyer signup.

All cohort identities and environments are allowlisted server-side. Product/operations may choose fewer participants without changing the profile.

### Vertical and goods

- fixed-price physical retail, initially apparel/accessories;
- non-regulated, non-restricted, non-age-gated products;
- simple variants such as size/color;
- integer quantities;
- no weighed goods, alcohol, tobacco, medicines, financial products, gift-card cash equivalents, weapons, subscriptions, marketplaces, multi-seller carts, travel, or digital entitlements;
- test orders SHALL be visibly tagged and SHALL NOT trigger real shipment unless a separately approved manual test procedure exists.

### Merchant integration

- Shopify is the sole pilot transaction connector;
- generic REST is a local/reference connector for abstraction and contract evidence only;
- merchant catalog, product/variant, price, inventory/availability, order, fulfillment status, cancellation, and full-refund test behavior are included only where verified against the selected Shopify development profile;
- reservation is not required; if unsupported, quote/manifest SHALL disclose availability is advisory until order commit.

### Agent surfaces

- Counter Native API is the canonical pilot API projection;
- MCP is the first AI adapter and exposes only the approved tool subset;
- a deterministic reference buyer harness is required for independent end-to-end evidence;
- ACP transaction support is Deferred;
- AP2 adapter/conformance is Deferred, though CTP semantics are AP2-aware;
- NPCI UAP is watch-only;
- x402 is Deferred.

### Trust and autonomy

- Counter Trust Protocol 0.1 design profile;
- `CounterTestAgentRegistry` and `CounterTestAuthorization`;
- local/user-controlled Ed25519 agent key;
- signed bounded mandate and purchase intent;
- deterministic buyer and merchant policy intersection;
- prompt-triggered and approved time-triggered autonomous **test** transactions may run within mandate bounds only through `CounterTestPaymentProvider`;
- approval is required when policy/mandate threshold or material-change rule requires it;
- no test mechanism SHALL be accepted by a live payment adapter.

### Payment

- deterministic `CounterTestPaymentProvider` for unattended bounded test execution, with no external rail or settlement;
- Razorpay Standard Checkout test mode under the approved merchant test account for external-provider lifecycle certification;
- Razorpay returns `PAYMENT_ACTION_REQUIRED` and requires explicit human browser action; Counter SHALL NOT automate OTP, PIN, bank approval, or payment details;
- hosted/provider-native Razorpay test handoff selected during Gate A;
- only test methods proven in that account/environment are discoverable;
- payment order/instruction, callback verification, verified webhook, authoritative query, decline/failure, duplicate/reordered event, and full-refund test lifecycle;
- every payment result identifies the exact provider mode and environment;
- no live charge, settlement, Reserve Pay, delegated UPI, cross-merchant payment mandate, Counter balance, top-up, custody, or raw credential storage;
- “UPI,” “Reserve Pay,” “NPCI-approved,” and “agentic UPI” SHALL NOT appear as available unless Profile 1.0 is superseded after separate evidence/approval.

### Default technical limits

These are server-enforced test limits, not representations of provider-approved real-money limits:

- maximum quote/test transaction total: INR 5,000;
- maximum rolling 24-hour test total per Wallet: INR 10,000;
- maximum five consequential test purchase attempts per Wallet per 24 hours;
- mandate validity maximum: 24 hours;
- bound intent validity maximum: 15 minutes and never beyond quote expiry;
- approval validity maximum: 10 minutes;
- all values are configurable downward by Wallet/merchant policy and cannot be increased beyond profile ceilings.

A Profile version change and Gate approval are required to increase ceilings.

## 3. Released operation candidate set

No operation is Released until its evidence passes. Candidate operations are:

1. merchant discovery/capability retrieval;
2. product search/detail;
3. current price and availability;
4. immutable quote with tax/shipping/fees if applicable, expiry, freshness, and digest;
5. agent registration and key status;
6. Wallet policy and mandate creation outside MCP/model access;
7. purchase-intent creation and approval when required;
8. policy evaluation and denial/review/allow result;
9. Counter test-provider payment and authoritative test status for unattended bounded scenarios;
10. Razorpay Standard Checkout test instruction, `PAYMENT_ACTION_REQUIRED`, and authoritative provider status;
11. Shopify test order creation/status;
12. test order cancellation and full refund where current state/provider profile permits;
13. reconciliation, findings, signed receipt, and receipt verification;
14. merchant/Wallet/agent suspension, revocation, and offboarding.

Deferred operations include reservation unless verified, partial refund, return/exchange, substitution, recurring purchase, subscription, multi-item multi-merchant cart, production fulfillment automation, dispute/chargeback automation, and live payment.

## 4. Required end-to-end scenarios

### Happy and bounded paths

1. Prompt-triggered unattended purchase below approval threshold through `CounterTestPaymentProvider`.
2. Time-triggered unattended purchase explicitly permitted by current mandate through `CounterTestPaymentProvider`.
3. Counter test-provider purchase above approval threshold that pauses and succeeds only after exact approval.
4. Search/quote with correct provenance, freshness, and amount arithmetic.
5. Counter test payment → Shopify test order → reconciliation → independently verified receipt.
6. Razorpay Standard Checkout test transaction that returns `PAYMENT_ACTION_REQUIRED`, requires explicit human action, verifies authoritative provider evidence, completes/observes the Shopify test order, and issues a receipt.

### Denial and consent paths

7. Non-allowlisted merchant/domain.
8. non-India merchant metadata or delivery country.
9. disallowed category/SKU, currency, operation, payment reference, or trigger.
10. per-transaction, rolling amount, quantity, and transaction-count limit breach.
11. expired/not-yet-valid/revoked mandate, intent, approval, agent key, or payment reference.
12. merchant/item/quantity/currency/amount/destination/quote-digest material change.
13. approval self-bypass, policy mutation through MCP, and model request for keys/tokens.

### Retry and uncertainty paths

14. identical retry and concurrent duplicate create one effect.
15. conflicting idempotency payload is rejected.
16. process failure before and after durable intent.
17. Shopify, Counter test-provider, or Razorpay timeout before/after possible effect becomes Indeterminate.
18. delayed, duplicate, invalid-signature, and reordered webhooks/events.
19. provider/merchant outage and recovery without unsupported success.

### Verification and operations paths

20. agent falsely claims success/failure.
21. payment/order/amount mismatch creates a finding.
22. full refund succeeds or remains pending/Indeterminate from authoritative evidence.
23. failed compensation remains visible and assigned.
24. Wallet/agent/mandate/merchant/provider kill switch blocks future effects.
25. key rotation, recovery lock, backup/restore, replay, export, and closure.
26. merchant and Wallet receipt views verify against one canonical digest without cross-party leakage.

## 5. Capability Manifest requirements

For each pilot merchant, the signed manifest SHALL declare:

- merchant/environment/verified domains/legal and settlement country;
- Shopify connector and exact supported resource/action versions;
- Native/MCP versions and exact tool/operation set;
- CTP schema and signing key versions;
- currency, delivery country, category, amount/count ceilings;
- quote/availability/reservation behavior and freshness budgets;
- payment modes: deterministic Counter test provider or human-present Razorpay Standard Checkout test mode;
- Razorpay test account/environment and supported test method classes when that mode is enabled;
- order/cancellation/refund/fulfillment behavior;
- authority, approval, revocation, idempotency, and event requirements;
- limitations, status, health, evidence bundle, and expiry/revalidation.

Only healthy Released behavior is discoverable. Test mode is prominently machine- and human-readable.

## 6. Gate A — Baseline and access

Required before implementation composition:

- all v3.1 documents approved;
- Git decision made by user;
- architecture/runtime decisions recorded;
- Shopify development store/catalog available;
- Razorpay test account/credentials available and allowed test method documented;
- exact Shopify/Razorpay/MCP/crypto/schema versions pinned;
- CTP schemas and four core interfaces frozen for implementation;
- cohort, owners, limits, retention, support, and data flow approved;
- threat models and legal/privacy/payment review find no blocker for a test-only pilot with a single-user, single-purpose spending balance.

## 7. Gate B — No-money and autonomous Counter-test end to end

Required before Razorpay composition:

- invite/allowlist gates cannot be bypassed;
- merchant, Wallet, agent, key, policy, mandate, intent, approval, revocation, and quote binding work end to end;
- bilateral policy and cumulative limits pass concurrency/property tests;
- Shopify reference/no-payment order workflow is idempotent or safely simulated according to adapter profile;
- `CounterTestPaymentProvider` completes prompt/time-triggered bounded scenarios, produces signed deterministic evidence, and is rejected outside test environments;
- explicit Indeterminate state and authoritative resolution work;
- cross-merchant, cross-Wallet, merchant-to-Wallet, operator, environment, cache/queue/object/log/analytics isolation tests pass;
- no private key, funds, balance, or raw credential appears in storage/telemetry/fixtures;
- signed receipts independently verify.

## 8. Gate C — Provider test-mode certification

Required before cohort release:

- exact merchant Razorpay test account/method/environment pinned;
- Standard Checkout is declared human-present and emits `PAYMENT_ACTION_REQUIRED` before provider authorization;
- hosted/provider-native handoff cannot expose raw credentials to Counter/model or automate OTP, PIN, bank approval, or payment details;
- create instruction/order, callback verification, webhook signature, API query, decline, timeout, duplicate/reorder, and full-refund test paths pass;
- visible Razorpay payment success is always backed by authoritative Razorpay test evidence;
- Counter is never settlement source/destination;
- Shopify order and provider test payment reconcile under every required scenario;
- kill switches, daily reconciliation, exception queue, and support runbooks are exercised;
- security/privacy review finds no unresolved critical/high issue.

## 9. Gate D — Private cohort release

Required for status `Released` to the named cohort:

- all required scenarios have linked immutable evidence;
- product, engineering, security, privacy/legal, payments, and operations approve;
- capability manifest and UI disclose test mode and limitations;
- transaction ceilings and allowlists are enforced server-side;
- staffed support/incident ownership and rollback are active;
- backup/restore, key rotation/revocation, recovery, export, closure, and merchant offboarding are exercised;
- no GA, live-money, external protocol, Reserve Pay, UAP, or production-autonomy claim appears.

## 10. Gate E — Expansion decision

After the observation period, expansion requires acceptable thresholds and incident review for:

- zero duplicate payment/order effects;
- zero unsupported payment/order success;
- zero custody/raw-credential/private-key events;
- bounded policy/revocation correctness;
- indeterminate resolution and reconciliation latency;
- Counter test-provider autonomous lifecycle and Shopify/Razorpay human-present lifecycle stability;
- support interventions per transaction;
- security/privacy incidents;
- buyer/merchant repeat usage and qualitative value.

Every incident/accepted limitation must have an owner. Expansion selects one capability at a time and does not automatically release live money, public signup, another merchant connector, vertical, protocol, region, or payment method.

## 11. Pilot operations

- automated reconciliation after material events plus a daily full pilot reconciliation;
- global, merchant, Wallet, agent, mandate, connector, and payment-adapter kill switches;
- bounded retries and dead-letter ownership;
- manual exception queue for all unresolved findings/Indeterminate states;
- named on-call/support owner during declared pilot windows;
- user-safe incident communication distinguishing Counter, `CounterTestPaymentProvider`, Shopify, Razorpay, and configuration failures;
- no direct production database edits as a normal remediation path;
- rollback disables future actions without deleting evidence.

## 12. Evidence bundle

The pilot release bundle SHALL include:

- build/commit identifier (after repository initialization);
- schema and migration versions;
- CTP schema/signature fixture results;
- Shopify connector, Counter test-provider, and Razorpay Standard Checkout test adapter versions/results;
- Native API and MCP contracts/results;
- required scenario and negative/security test results;
- isolation, no-secret/no-custody, resilience, backup/restore, and receipt-verification results;
- capability manifest and cohort/limits configuration digest;
- known limitations, runbooks, rollback, owners, approvals, and revalidation date.

Until this evidence exists, every capability remains Planned or In Progress.