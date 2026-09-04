# Counter Agent Commerce Platform

**Document version:** 3.2  
**Document status:** Canonical product definition  
**Product status:** The core buyer loop — fund a spending balance, sign a bounded mandate, an agent transacts against it, over-limit purchases are declined before any effect — is built and verified against live infrastructure (real Razorpay checkout, real Shopify store, real Auth0 identity). See `HANDOFF.md` and `README.md` for current verified state. Broader platform scope (full merchant self-serve, additional rails) remains in progress.  
**Target release:** Invite-only India retail pilot using test payments  
**Audience:** Product, engineering, security, legal, payments, operations, partners, and merchant success

## 1. Product definition

Counter is an India-first, two-sided, protocol-neutral agent-commerce platform.

- **Counter Merchant** lets a merchant connect existing systems and activate a machine-facing commercial representative that agents can discover and transact with.
- **Counter Agent Wallet** lets a person register an agent, fund a real spending balance through a regulated payment provider, define bounded purchasing authority against that balance, review activity, revoke authority, and retain evidence.
- **Counter Trust Protocol** is Counter's versioned canonical contract between both products for identity, principal-agent binding, mandates, intents, quotes, policy decisions, evidence, events, and signed receipts.

Counter connects external agent interfaces, commerce protocols, trust protocols, payment rails, and merchant backends through independently versioned adapters. Merchants integrate once and may become reachable through multiple supported agent ecosystems. Buyer agents integrate once and may transact with compatible merchants under user-set limits.

Counter is not merely a format converter. It is the control and reliability plane that preserves meaning across adapters, intersects buyer and merchant policy, orchestrates effects, verifies outcomes, and remediates inconsistencies.

Distributed commerce can fail. Counter's measurable promise is **no silent consequential failure**: every material action is attributable, bounded, idempotent, auditable, and either confirmed against an authoritative source or explicitly represented as pending, blocked, declined, failed, or indeterminate.

## 2. Problem

Agents cannot reliably complete end-to-end purchases because:

- merchant information is fragmented across storefront, inventory, order, fulfillment, and payment systems;
- protocols address different layers and are not interchangeable;
- an authenticated agent is not necessarily authorized to spend;
- user intent and merchant policy must both survive translation;
- payment, order, and fulfillment systems can disagree;
- retries can create duplicate charges or orders;
- most merchants cannot build, certify, and operate every connector and protocol independently.

A standard checkout message does not onboard a merchant, normalize inventory, prove buyer authority, execute an Indian payment, reconcile an order, or repair a partial failure. Counter supplies that missing operational layer.

## 3. Vision and positioning

**Vision:** Any legitimate merchant can become safely transactable by authorized AI agents without rebuilding its commerce stack, and any compatible agent can transact under a spending limit the user sets and funds directly — enforced before every purchase, never after.

**Merchant promise:** Integrate once. Counter exposes only verified capabilities through supported agent interfaces while the merchant remains seller, merchant of record, payment-account owner, and system-of-record owner.

**Buyer promise:** Configure authority once. Compatible agents can discover merchants and complete allowed transactions while Counter enforces policy, preserves evidence, and never lets a model widen limits or claim an unverified outcome.

**Strategic position:** Counter is the protocol-neutral interoperability, policy, orchestration, verification, and remediation layer for agent commerce—analogous to a Connect-style enablement platform, not a new payment rail or global identity standard.

## 4. Goals

1. Activate a fixed-price retail merchant through a guided, evidence-backed path.
2. Give users a bounded-spending agent identity, policy, mandate, approval, revocation, and receipt product.
3. Maintain one canonical commerce model and one shared trust contract with adapters at every boundary.
4. Support any AI agent capable of the declared Native API or MCP contract; MCP is optional, not the canonical domain model.
5. Enforce bounded autonomy: an agent may act only within signed current authority, buyer policy, merchant policy, provider constraints, and platform safety rules.
6. Fund every spending balance through a regulated payment provider (Razorpay), and account for every debit against it precisely.
7. Prevent duplicate effects and represent uncertainty explicitly.
8. Verify buyer intent, merchant state, provider state, and fulfillment evidence independently.
9. Automate only typed, policy-authorized compensation; otherwise create an owned human task.
10. Publish precise, evidence-backed capability and compatibility status.
11. Begin in India and preserve adapter boundaries for later regions, rails, protocols, and verticals.

## 5. Non-goals and regulated-role boundary

Under this product definition Counter is not:

- a bank, PPI issuer, TPAP, payment aggregator, acquirer, issuer, lender, or licensed settlement intermediary;
- the merchant of record, marketplace seller, or replacement for merchant ERP, OMS, CRM, PIM, WMS, tax, shipping, or PSP systems;
- a universal industry standard or a certification authority for third-party protocols;
- a system that stores PAN, CVV, UPI PIN, bank credentials, private payment keys, or equivalent secrets;
- a system that gives a language model access to identity keys, payment tokens, policy mutation, limit widening, merchant allowlist changes, or settlement claims;
- a guarantee that dependencies never fail;
- a public, global, multi-vertical launch in the first release.

Counter Agent Wallet does fund a real, per-user spending balance through a regulated payment provider — see §14 — scoped narrowly to backing that one user's own agent-spending limit. It is not a general-purpose stored-value or payment product: it never pools funds across users, never issues a redeemable or transferable instrument, and never accepts funds for anything other than powering that user's own bounded agent purchases. Scaling this into a general-purpose stored-value product remains a separate product definition, legal program, and regulated-partner decision.

## 6. Product components

### 6.1 Counter Merchant

Counter Merchant contains:

- Merchant Control Plane and invite-only activation;
- Connector Hub and connector certification;
- canonical Commerce Graph with provenance and freshness;
- merchant capability and policy controls;
- merchant-facing Agent Gateway;
- order, fulfillment, refund, and exception operations;
- merchant and operator consoles.

### 6.2 Counter Agent Wallet

“Wallet” means a policy, consent, authorization-reference, activity, and evidence wallet. It does not mean stored money.

Counter Agent Wallet contains:

- buyer account and recovery;
- stable agent URI and agent registration;
- local/user-controlled agent signing keys initially, with rotating public key discovery;
- buyer policies, merchant/domain allowlists, country rules, category/SKU rules, amount and rolling limits, time windows, and approval thresholds;
- signed mandates and bound intents;
- opaque provider payment-authorization references;
- approval/revocation controls;
- independent transaction claim ledger;
- receipt verification, export, and deletion controls;
- an MCP server and Native API for approved agent operations.

The MCP-connected model can request allowed commerce operations. It cannot retrieve private identity keys or payment secrets, mutate policy, widen limits, add merchants, or declare payment/settlement success.

### 6.3 Counter Trust Protocol

Counter Trust Protocol is Counter-owned and versioned. It represents:

- principal, wallet, agent, merchant, and environment identity;
- key discovery and assurance metadata;
- mandates, intents, consent, approval, and revocation;
- quote digests and material-change bindings;
- payment-authorization references, never raw credentials;
- policy inputs and decisions;
- correlation, idempotency, evidence, findings, state, and receipts.

It is the canonical seam between Counter products. It is not marketed as an external standard and does not imply ACP, AP2, NPCI UAP, x402, or other conformance.

### 6.4 Shared execution plane

Shared services include:

- Agent Gateway and capability negotiation;
- Transaction Engine and orthogonal state machines;
- Trust and Policy Engine;
- Payment Orchestrator;
- Verification Engine;
- evidence ledger, reconciliation, remediation, and signed receipts.

## 7. Actors and isolation domains

| Actor/domain | Responsibility |
|---|---|
| Human principal | Creates policy, grants/revokes authority, approves when required |
| Registered buyer agent | Proposes and executes only operations permitted by current authority |
| Wallet account | Holds policy, public identity references, mandates, provider references, activity, and receipts |
| Merchant administrator | Connects systems, proves authority, configures capabilities/policy, activates or suspends |
| Merchant operator | Handles orders, refunds, exceptions, and findings |
| Counter operator | Operates services through approved, scoped, audited tools |
| Payment provider/regulated participant | Holds payment credentials/funds and provides payment truth |
| Merchant systems | Provide catalog, inventory, order, and fulfillment truth |
| External protocol issuer/verifier | Provides protocol-specific identity, mandate, or payment evidence where supported |

Merchant tenancy and wallet tenancy are separate authorization domains. A merchant cannot browse wallet history, a wallet cannot inspect merchant-private connector data, operators cannot browse either without a scoped support purpose, and sandbox identities cannot authorize production effects.

## 8. Product principles

1. **Canonical core, adapters at boundaries.** The domain model—not any one API—is the semantic source.
2. **Compose protocols; do not conflate them.** Commerce, authority, transport, negotiation, payment execution, and evidence are separate roles.
3. **Fail closed on semantic loss.** An adapter cannot silently weaken authority, invent success, or imply unsupported refund behavior.
4. **Bilateral policy.** The effective action is the most restrictive intersection of platform safety, current buyer policy and consent, delegated authority, merchant policy, connector capability/freshness, provider constraints, risk results, and transaction state.
5. **Neither side widens the other.** Wallet, agent, merchant, adapter, model, and operator cannot exceed another party's bound.
6. **Provider and merchant systems remain authoritative.** Counter's local state is orchestration evidence, not settlement or fulfillment truth.
7. **Models propose; deterministic services decide.** Models do not mint authority, move money, widen policy, or assert external outcomes.
8. **Explicit uncertainty.** Unknown and indeterminate are first-class states.
9. **Evidence accompanies claims.** Every material status identifies source, freshness, and assurance.
10. **Capabilities are evidence-backed.** Universal architecture does not justify universal support claims.

## 9. Protocol-neutral architecture

Counter is agnostic across five independently negotiated dimensions:

| Dimension | Initial/future examples | Counter role |
|---|---|---|
| Agent interface | Native API, MCP | Expose safe canonical commands |
| Commerce protocol | ACP and future profiles | Map merchant discovery/checkout semantics |
| Authority/trust | Counter test authorization, AP2, future NPCI UAP | Normalize and verify bounded authority |
| Payment rail/negotiation | Razorpay/UPI provider paths, future x402 | Execute through eligible provider adapters |
| Merchant backend | Shopify, generic REST, later ERP/POS/WMS | Normalize merchant systems and typed actions |

Every adapter declares role, direction, source/version, subset, extensions, omissions, assurance impact, environment, status, and evidence bundle. Adapters preserve untranslatable signed source artifacts and fail closed when a required semantic cannot be represented.

### 9.1 Protocol strategy

- **Native API:** Counter-owned projection of canonical capabilities and the pilot's primary API.
- **MCP:** first AI tool adapter; transport/tool access does not establish spending authority or payment truth.
- **ACP:** candidate merchant commerce/checkout adapter after the native pilot path stabilizes. ChatGPT program participation is not assumed.
- **AP2:** first-class design influence and candidate trust/mandate adapter. Counter should map rather than replace its verifiable-intent model.
- **Future NPCI UAP:** strategic watch/partner adapter for India agent registration, authorization, and UPI interaction. No implementation or conformance is claimed without a canonical specification, access path, approvals, and evidence.
- **x402:** deferred payment-negotiation adapter for later API, research, and digital-content commerce; not an India retail pilot rail.

## 10. Capability Manifest

Every merchant environment publishes a versioned, signed Capability Manifest containing:

- protocols and versions;
- supported operations and vertical pack;
- currencies, merchant/delivery countries, categories, limits, and methods;
- identity and authority requirements;
- payment, reservation, fulfillment, cancellation, and refund behavior;
- connector freshness and evidence assurance;
- extensions and known semantic limitations;
- environment and capability status.

Only `Released` capabilities are advertised as available. Operational status may additionally be `Degraded` or `Suspended`.

Mandatory lifecycle vocabulary:

- **Planned:** specified, not implemented;
- **In Progress:** implementation exists but release evidence is incomplete;
- **Verified:** passed declared evidence in a named environment;
- **Released:** Verified and enabled for a named cohort with operational ownership;
- **Degraded:** Released but below contract;
- **Suspended:** intentionally unavailable;
- **Deferred:** outside the current release.

## 11. Core domain model

Core entities include:

- MerchantOrganization, MerchantTenant, Environment, MerchantUser, Connector, MappingVersion, CapabilityManifest;
- Product, Variant, Category, Price, Promotion, InventoryPosition, Quote, Cart, Reservation;
- BuyerAccount, WalletProfile, RegisteredAgent, KeyReference, BuyerPolicy, Consent, Approval, Revocation;
- Mandate, Authority, Intent, TrustEnvelope, CounterpartyBinding;
- PaymentAuthorizationReference, PaymentInstruction, Authorization, Capture, Refund;
- Transaction, CheckoutSession, Order, Fulfillment, Shipment, Cancellation, Return;
- PolicyDecision, EvidenceRecord, Claim, Finding, Receipt, LedgerEntry, ReconciliationRun.

Money uses integer minor units and ISO currency. Quantities use decimal-safe values and explicit units. Material objects are immutable or versioned. Transaction, trust, and audit records are append-only.

## 12. Identity, authority, and mandate

Agent identity and payment authorization are separate.

- Agent identity uses a stable URI and rotating Ed25519/JWKS-compatible public keys.
- Agent private keys are local or user-controlled in the initial design.
- Payment authorization is an opaque provider reference managed through `PaymentAuthorization` and `PaymentProvider` interfaces.

A mandate binds at minimum:

- issuer, principal, wallet, and registered agent key;
- allowed Counter merchant IDs and verified domains;
- merchant legal/settlement country and permitted delivery countries;
- categories/SKUs, currencies, per-transaction and rolling limits;
- approval threshold and permitted operations;
- payment authorization reference;
- validity, nonce, replay scope, revocation locator, and signature.

“No outside India” uses verified merchant legal/settlement metadata and delivery destination—not IP address or top-level domain alone.

A material change to merchant, item, quantity, currency, final amount, delivery destination, or quote digest requires a new bound intent or renewed approval according to policy.

Revocation blocks future consequential effects. It does not erase evidence or falsely reverse an already committed external effect; such effects must be reconciled or compensated.

## 13. Transaction model

A transaction has an orchestration phase plus independent reservation, payment, order, fulfillment, and return states. A single status cannot truthfully represent all external systems.

### 13.1 Orchestration phases

`DRAFT -> QUOTED -> CHECKOUT_READY/REVIEW_REQUIRED -> COMMITTING -> ACTIVE/CLOSED`

Exceptional phases are `INDETERMINATE`, `DECLINED`, `EXPIRED`, `CANCELED`, and `FAILED_REQUIRES_ACTION`.

### 13.2 External sub-state principles

- reservation may be unsupported, pending, reserved, released, expired, indeterminate, or failed;
- payment may require instruction, authorization, capture, void, refund, or resolution and cannot be `PAID` without provider evidence;
- order may be absent, committing, committed, canceled, closed, indeterminate, or failed;
- fulfillment and return progress independently;
- timeout after a possible external mutation produces an indeterminate state, not blind retry;
- provider/connector-specific transition tables are versioned and tested.

Every consequential operation binds the current mandate/authority, buyer policy, merchant policy, quote digest, payment reference, transaction version, and stable idempotency key.

## 14. Payment model

A buyer funds their agent's spending balance through a real payment (Razorpay checkout, test mode in the pilot), verified by an authoritative provider check — never by trusting a client redirect or a model's claim. From there:

- the funded balance is scoped to that one buyer, backing only their own agent's bounded purchases — never pooled with other buyers' funds, never a general-purpose or transferable instrument;
- every purchase is checked against the buyer's signed mandate and the remaining balance *before* any external effect (the Shopify order, the debit) happens — an over-limit or over-budget purchase is declined before anything is created, not rolled back after;
- the merchant remains seller and merchant of record; funds for the merchant's own side move through the merchant's own connected payment provider;
- Counter stores only minimum opaque references/tokens allowed by provider agreement, and never raw credentials;
- Counter never exposes raw credentials to an agent or model;
- payment success requires verified provider API or signed webhook evidence;
- redirects, model output, wallet state, and merchant claims are not payment truth;
- refunds use the merchant/provider path.

The pilot has two explicitly separate test-payment paths:

1. `CounterTestAuthorization` plus `CounterTestPaymentProvider` provides deterministic, unattended test-only execution under a pre-signed bounded mandate. It never connects to a live rail and cannot prove external-provider compatibility.
2. Razorpay Standard Checkout in test mode certifies real provider order, hosted checkout, callback verification, webhook/query, refund, and reconciliation behavior. Its payment step is human-present and returns `PAYMENT_ACTION_REQUIRED`; Counter does not automate OTP, PIN, bank approval, or payment details.

Live money, UPI Reserve Pay, unattended delegated UPI, and cross-merchant authorization remain unavailable until provider eligibility, behavior, legal roles, and approvals are verified.

## 15. Verification and remediation

Verification compares, where available:

1. principal intent and wallet consent;
2. normalized authority and revocation state;
3. agent claim;
4. quote and merchant policy;
5. merchant order/fulfillment record;
6. provider payment record.

Canonical findings include intent or authority mismatch, price mismatch, duplicate effect, payment/order/fulfillment mismatch, orphaned authorization, refund mismatch, stale evidence, integrity failure, and resolved indeterminate outcome.

Automatic remediation follows a typed compensation matrix. It runs only when the action is idempotent, provider/merchant prerequisites are authoritative, and both buyer and merchant policy permit it. Counter never guesses an indeterminate outcome, spends beyond authority, or uses a generic “refund everything” rule.

A signed receipt records final canonical states, totals, assurance level, policy/authority summaries, evidence references, audit digest, audience, and supersession chain. Merchant and wallet views apply audience-specific data minimization.

## 16. Product surfaces

### Merchant Console

Invite/activation, connectors, mappings, capability/policy configuration, sandbox tests, transaction timeline, approvals, orders, refunds, findings, audit, security, and suspension.

### Agent Wallet

Enrollment, agent registration, public-key management, merchant/country/category allowlists, amount and rolling limits, approval thresholds, payment-reference handoff, approval inbox, transaction timeline, claims, receipts, revocation, recovery, export, and closure.

### Agent interfaces

Native API and an MCP tool subset. Read and consequential tools are clearly separated. MCP cannot mutate wallet policy or obtain secrets.

### Operations Console

Fleet health, scoped diagnostics, incident controls, dead letters, replay, reconciliation, adapter releases, and approved support sessions. No unrestricted cross-tenant or cross-wallet browsing.

## 17. Security, privacy, and reliability

Threat models must cover malicious/compromised agents, malicious merchants, mandate replay, confused deputy, cross-wallet and cross-merchant leakage, quote substitution, payment redirection, recovery takeover, SSRF, secret leakage, and support abuse.

Counter enforces isolation at database, cache, queue, object, search, log, analytics, and support boundaries. Keys and secrets use approved KMS/secrets systems. Privileged actions require MFA/step-up and audit. Data collection and sharing follow purpose limitation, retention, export, correction/deletion where applicable, and India's DPDP requirements where applicable.

Production SLOs are not pilot claims. Pilot service objectives, support coverage, transaction caps, kill switches, reconciliation frequency, and recovery procedures are defined in `PILOT.md`.

## 18. Private pilot contract

The operative v3.1 target is the profile in `PILOT.md`:

- India, INR, invite-only;
- fixed-price physical retail/apparel;
- one Shopify pilot transaction path;
- generic REST reference connector tested separately;
- Native API and constrained MCP;
- Counter Trust Protocol and `CounterTestAuthorization`;
- `CounterTestPaymentProvider` for unattended bounded test execution;
- Razorpay Standard Checkout test mode for human-present provider lifecycle certification;
- signed mandate, bounded intent, provider-backed test outcome, Shopify order state, reconciliation, receipt, and minimal operations tooling.

The pilot may demonstrate autonomous execution under a pre-signed bounded test mandate, including an agent/user prompt or approved time trigger, only through the deterministic Counter test provider. The Razorpay path pauses in `PAYMENT_ACTION_REQUIRED` for explicit human checkout action. Neither path demonstrates live delegated UPI or permission to spend real funds unattended.

Deferred: live money, Counter-held balance, public signup, global rollout, WooCommerce/database/ERP/CRM/POS/WMS connectors, broad ACP/AP2 conformance, NPCI UAP, x402, grocery, travel, subscriptions, digital entitlements, weighed goods, multi-seller commerce, and production GA.

## 19. Pilot success criteria

The pilot succeeds only when evidence shows:

1. invited merchant and wallet enrollment cannot be bypassed;
2. Shopify catalog, quote, order, and status retain provenance/freshness;
3. the agent cannot exceed merchant, country, category, amount, rolling, time, operation, or approval limits;
4. exact quote/intent binding and revocation work under retries and races;
5. duplicate requests create at most one order and one test payment effect;
6. every payment success is backed by evidence from its declared provider mode: deterministic signed Counter test-provider evidence for unattended simulation or authoritative Razorpay test API/verified-event evidence for Standard Checkout;
7. unknown outcomes remain indeterminate until authoritative resolution;
8. merchant, provider, wallet claim, and Counter state reconcile;
9. receipts verify independently and expose only audience-appropriate data;
10. no funds, raw payment credentials, UPI PINs, or agent private keys enter Counter storage or telemetry;
11. kill switches, support, refund/cancellation handling, replay, recovery, and offboarding are exercised;
12. no protocol, payment, regulatory, or production claim exceeds its evidence.

## 20. Success metrics

- invited merchant activation and wallet enrollment completion;
- time to first verified test transaction;
- intent-to-policy-approved and approval-to-order conversion;
- policy denial correctness and revocation latency;
- duplicate-effect and unsupported-success count (target zero);
- indeterminate-state resolution and reconciliation time;
- merchant order/fulfillment success;
- receipt verification success;
- operator interventions and support burden per transaction;
- merchant and buyer repeat usage;
- security/privacy incidents and custody/raw-credential events (target zero).

## 21. Risks

| Risk | Mitigation |
|---|---|
| “Wallet” implies a general-purpose regulated stored-value product | Keep the balance strictly single-user and single-purpose (funds only that user's own agent spending, never pooled or transferable); legal/payment review before any broader stored-value scope |
| Protocol scope explodes | Canonical core, finite manifests, role-specific adapters, narrow pilot |
| Lowest-common-denominator translation weakens authority | Preserve source artifacts and fail closed on semantic loss |
| UAP or provider access is restricted | Partner strategy and adapter boundary; no speculative implementation |
| AP2 overlaps Counter mandates | Align canonical model and implement an adapter; do not invent a rival standard |
| ACP platforms are commercially gated | Implement open contract independently; do not depend on channel admission |
| Agent or recovery compromise | Local keys, rotation, step-up, revocation, limits, anomaly controls |
| Merchant systems disagree | Provenance, source priority, freshness, reconciliation |
| Payment/order outcome is ambiguous | Idempotency, outbox, provider queries, indeterminate states |
| Two-sided cold start | Merchant-first pilot plus first-party reference Agent Wallet |
| Counter drifts into regulated roles | Balance stays single-user, single-purpose, and non-pooled by architecture; contracts and a separate future program gate for any broader stored-value scope |

## 22. Document authority

- `PRD.md` is the umbrella product authority.
- `.kiro/specs/counter-merchant-agent/requirements.md` defines Counter Merchant requirements.
- `.kiro/specs/counter-agent-wallet/requirements.md` defines Counter Agent Wallet requirements.
- `TRUST-PROTOCOL.md` defines shared canonical trust objects and invariants.
- `PILOT.md` defines the exact private pilot profile and gates.
- `CONFORMANCE.md` defines adapter roles and evidence required for compatibility claims.
- `PLAN.md` defines delivery sequence.

At version 3.1, foundation tasks 1–3 have repository implementation and the shared foundation is `In Progress`; merchant, Wallet, protocol, adapter, and provider capabilities remain `Planned` unless their exact evidence gates say otherwise. Documentation alone is not implementation evidence. If code, evidence, or external access conflicts with a document, the affected capability remains Planned/In Progress until the discrepancy and affected tests are resolved.