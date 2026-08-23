# Counter — Product Requirements Document

**Status:** Canonical product specification
**Version:** 1.0
**Date:** 22 August 2026
**Project name:** Counter
**Tagline:** The front door that lets AI buyers transact with any Indian merchant — and proves every transaction was correct.
**Target:** Razorpay AI Buildathon 2026, Track 01 (AI Growth & Agentic Commerce)
**Companion documents:** [PLAN.md](./PLAN.md) · [AGENT-DELEGATION-RESEARCH.md](./AGENT-DELEGATION-RESEARCH.md)

> The name carries both halves of the product deliberately: a counter is where a transaction
> happens, and a counter is what reconciles.

---

## 1. What we are building

Counter makes any Indian merchant transactable by an AI buyer, and makes every agent transaction
provably correct.

It has four layers, each with one job:

| Layer | Job | Why it exists |
|---|---|---|
| **Builder** | Adoption | Turns a plain store into an ACP-conformant agent endpoint in under ten minutes |
| **Handler** | Capability | The machine-native front door plus the merchant system of record |
| **Reconciliation** | Trust | Diffs what the agent believes against the merchant ledger against Razorpay's real state |
| **Buyer MCP + chaos suite** | Proof | A real MCP client in Claude, driven through 100 transactions under injected failure |

The demo spine: onboard a store in under ten minutes → buy from it inside Claude → drive 100
transactions through deliberate chaos → land on one number, **zero discrepancies**.

---

## 2. Thesis

**The protocol landed. Adoption is zero. The blocker is implementation cost, not specification.**

The Agentic Commerce Protocol is an open Apache-2.0 standard from Stripe, OpenAI, and Meta covering
product feeds, agentic checkout sessions, and delegated payment, with the merchant remaining
merchant of record. It is published, versioned, and implementable today.

Yet in India essentially no merchant can be transacted with by an AI buyer. Three reasons:

1. **Implementation cost.** Conforming to ACP means building a structured product feed, a capability
   manifest, checkout session endpoints, webhook handling, and payment state reconciliation. That is
   weeks of engineering for brands that typically run on Shopify plus spreadsheets with zero to
   three engineers.
2. **Rails mismatch.** ACP's reference implementations are card-centric. India runs on UPI, and
   Shopify Payments does not operate here, so Indian merchants sit behind third-party gateways.
3. **Checkout is unsolved even upstream.** In March 2026 OpenAI conceded the first version of
   Instant Checkout lacked the flexibility they were aiming for, and refocused on discovery —
   browsing, comparison, budget filtering — then redirecting to the merchant's own site to check
   out. The company that co-authored the protocol retreated from agentic checkout to agentic
   browsing.

So the gap is not another protocol. It is a **generatable implementation on Indian rails, with
transaction integrity built in.**

### 2.1 Why the integrity half matters more than the front door

The front door is table stakes; someone will build it. The differentiator is what the research
established: **authority for agents is largely solved, competence is not.**

Production agents fail 70–95% of real tasks depending on complexity. Of 547 characterised
real-world failures, 326 (59.6%) were high or critical severity, commonly unauthorised state
changes or **false claims of completion**.

That last failure mode defeats every authority control ever shipped. When an agent reports success
it never achieved, the authority *was* used correctly, the limits *were* respected, and the audit
log faithfully records a transaction the user never wanted. Cloudflare Wallets does not catch it.
AP2 mandates do not catch it. Verifiable Intent will notarise it.

Counter catches it, because it holds three independent views of the same transaction and diffs
them.

### 2.2 The positioning line

> Agents fight CAPTCHAs because merchants have no front door for them. Counter is not a better
> lockpick. It is the door — and a ledger that proves what walked through it.

---

## 3. Competitive position

Full evidence in [AGENT-DELEGATION-RESEARCH.md](./AGENT-DELEGATION-RESEARCH.md). Summary of what
exists and what Counter does not attempt:

| Capability | Owned by | Counter's stance |
|---|---|---|
| Agent cryptographic identity | Web Bot Auth (RFC 9421), Cloudflare edge validation | **Consume it.** Verify signatures; do not reinvent |
| Agent payment mandates | AP2 (Google → FIDO, 60+ partners) | **Align with it.** Mandate-shaped authority records |
| Agent wallets and spend caps | Cloudflare Wallets, Stripe Link, UPI Reserve Pay | **Do not compete.** Buyer MCP is a reference client, not a wallet product |
| Checkout protocol | ACP (Stripe/OpenAI/Meta) | **Implement it.** This is the interface we conform to |
| Indian agent payment rails | Razorpay + NPCI (UPI Reserve Pay, live pilot) | **Build on Razorpay test-mode APIs** |
| Agent registration for UPI | NPCI Unified Agent Protocol | **In development, not shipped.** Align with published direction only; claim no integration |
| Agent email inboxes | AgentMail, Cloudflare Email Service | Out of scope for v1 |
| Tamper-evident action logs | Verifiable Intent (Google + Mastercard → FIDO) | Compatible record shape; not a competing standard |
| **Outcome verification / false-completion detection** | **Nobody found** | **This is Counter's contribution** |

Two honest caveats. The last row is a negative finding — thorough search, not proof of absence. And
this space moves in weeks: Cloudflare shipped Wallets on 4 August 2026, mid-analysis. Re-validate
immediately before submission.

---

## 4. Architecture

```text
Claude Desktop / any MCP client
        │
        ▼
┌───────────────────────────┐
│  Buyer MCP server         │  identity keypair · delegation policy
│  (reference client)       │  spend caps · agent-side ledger
└───────────┬───────────────┘
            │  ACP over HTTPS, Web Bot Auth signed
            ▼
┌───────────────────────────────────────────────────────────┐
│  Counter Handler (per-merchant tenant)                     │
│  ├─ /.well-known/agent-commerce   capability manifest      │
│  ├─ /feed                          ACP product feed        │
│  ├─ /checkout_sessions             create · update · complete│
│  ├─ /cancel  /refund  /status                              │
│  ├─ Agent verification + principal declaration             │
│  ├─ Policy gate (bounds, caps, review thresholds)          │
│  └─ Merchant ledger (append-only)                          │
└───────────┬───────────────────────────────┬───────────────┘
            │                               │
            ▼                               ▼
   Razorpay test-mode API           Reconciliation engine
   orders · capture · refund        agent belief vs merchant
   webhooks (idempotent)            ledger vs Razorpay state
            │                               │
            └───────────────┬───────────────┘
                            ▼
                   Drift report · zero-discrepancy proof

        ┌──────────────────────────────────┐
        │  Builder (onboarding wizard)      │
        │  questionnaire · catalog ingest    │
        │  domain + Razorpay verification    │
        │  → provisions a Handler tenant     │
        │  → conformance report              │
        └──────────────────────────────────┘
```

---

## 5. Layer 1 — Builder

**Job:** collapse ACP conformance from weeks of engineering to one sitting.

### 5.1 Questionnaire

| Field | Purpose |
|---|---|
| Business name, domain, category | Identity and manifest |
| Catalog source: Shopify URL, CSV upload, feed URL, or sitemap | Ingestion input |
| Currency, tax treatment, shipping model | Cart pricing correctness |
| Cancellation and return window | Drives cancel and refund semantics |
| Fulfilment SLA | Sets agent expectations in the manifest |
| Razorpay test key ID and secret | Payment execution |
| Max unattended order value | Policy bound |
| Allowed payment methods | Policy bound |
| Human-review threshold | Policy gate |
| Blocked SKUs or categories | Policy bound |
| Dispute escalation contact | Consumer and agent recourse |

### 5.2 Ownership verification — two independent proofs

Both are required before a tenant goes live. Fake merchants are a recognised agentic-commerce
problem; Mastercard launched Merchant Trust Services in 2026 specifically to surface scam sellers
before disputes cascade.

1. **Domain control** — DNS TXT record containing a Counter-issued challenge token. Fallback: a
   file at a well-known path on the merchant's origin.
2. **Payment account control** — a live call against the supplied Razorpay test key that must
   succeed, proving the applicant controls the account funds will settle into.

An unverified tenant may generate a feed and preview its manifest but cannot accept checkout
sessions.

### 5.3 Catalog ingestion

This is where the substantive AI work sits, and it should be visibly hard rather than hidden.

Input is messy: inconsistent titles, missing attributes, prices as strings with symbols, ambiguous
stock states, variants encoded in product names, categories absent or free-text.

Output must be an ACP-conformant product feed with correct field names, data types, and
constraints — validated against the specification, pass or fail.

The transformation performs category inference, attribute and variant extraction, price and
currency normalisation, availability resolution, and required-field completion, with a confidence
value on every inferred field. Low-confidence inferences are surfaced for merchant confirmation
rather than silently accepted.

### 5.4 Conformance report

The builder terminates in an honest readiness assessment, not a success screen:

```text
340 products ingested
328 agent-purchasable today
 12 missing required ACP fields  → listed with the specific field
  3 ambiguous availability state → listed with the raw source value
  7 low-confidence category inference → awaiting your confirmation

An AI buyer can browse and purchase 328 of your SKUs right now.
Here is exactly what is blocking the remaining 12.
```

This is a hard product requirement, not a nicety. Never manufacture confidence the data does not
support.

### 5.5 What gets provisioned

- `/.well-known/agent-commerce` manifest: capabilities, endpoint URLs, policy summary, fulfilment
  SLA, verified-domain proof, supported payment methods
- ACP-conformant product feed, served and refreshable
- Live checkout session endpoints scoped to the tenant
- Webhook subscription registered on the merchant's Razorpay account
- Merchant signing keypair for response signing
- DNS records or an embed snippet to attach the merchant's own domain

---

## 6. Layer 2 — Handler

Two roles in one service: the front door, and the system of record.

### 6.1 Front door

| Endpoint | Behaviour |
|---|---|
| `GET /.well-known/agent-commerce` | Capability and policy discovery |
| `GET /feed` | ACP product feed, cacheable, ETag support |
| `POST /checkout_sessions` | Create session — quote. Returns full cart state |
| `POST /checkout_sessions/:id` | Update session — reprice, adjust items, address |
| `POST /checkout_sessions/:id/complete` | Confirm — authorise and capture |
| `POST /checkout_sessions/:id/cancel` | Release hold |
| `POST /orders/:id/refund` | Refund a captured payment |
| `GET /orders/:id` | Authoritative status |

Every mutating endpoint requires an `Idempotency-Key`. Every response carries the full cart or
order state, per the ACP checkout specification, so an agent never has to infer state from a
partial response.

### 6.2 Agent verification and principal declaration

Each inbound request must present:

- a **Web Bot Auth signature** (RFC 9421 HTTP Message Signatures, Ed25519) resolvable against a
  published JWKS directory, establishing *which agent* is calling;
- a **principal declaration** naming the human or organisation on whose authority the agent acts,
  in an AP2-mandate-compatible shape, establishing *who authorised it*.

Unsigned requests are refused. Signed requests with an unresolvable or unverified principal may
browse the feed but cannot open a checkout session.

### 6.3 Policy gate

Evaluated before any money action, deterministically, never by a model:

- order value against the merchant's unattended maximum
- payment method against the allowed set
- SKU and category against the blocked set
- cumulative spend for this principal within the rolling window
- review threshold — above it, the session parks in `requires_human` rather than completing
- authority validity — expired or revoked mandates fail closed

Every decision writes a record with the rule that fired, the inputs it saw, and the version of the
policy that was in force.

### 6.4 Merchant ledger

Append-only. For every interaction: agent identity, principal, session, intent, policy decision,
Razorpay object IDs, state transitions, webhook receipts, and terminal outcome. This is one of the
three inputs to reconciliation and the source of the audit trail.

---

## 7. Layer 3 — Reconciliation engine

**The differentiator.** Everything else is a well-executed implementation of a published spec; this
is the part nobody ships.

### 7.1 Three independent views

| View | Source | What it represents |
|---|---|---|
| **Claimed** | Buyer MCP agent-side ledger | What the agent believes happened |
| **Recorded** | Handler merchant ledger | What the merchant observed |
| **Settled** | Razorpay API state | What actually happened on the rails |

### 7.2 Drift classes detected

| Drift | Meaning |
|---|---|
| `claimed_success_not_settled` | **False completion.** Agent reports a purchase Razorpay never captured |
| `settled_not_claimed` | Silent success — agent believes it failed; money moved |
| `amount_mismatch` | Captured amount differs from confirmed cart total |
| `duplicate_capture` | Same intent captured more than once |
| `orphaned_hold` | Authorised, never captured, never cancelled |
| `phantom_refund` | Refund claimed without a corresponding Razorpay refund |
| `state_regression` | Terminal state moved backwards |
| `unknown_resolved` | Timeout left state indeterminate; reconciliation resolved it |

### 7.3 Unknown-state resolution

The hard case, and the one that matters at a payments company. When a call times out mid-capture,
the merchant does not know whether money moved. Counter must never guess. It polls Razorpay to
establish settled truth, reconciles against the ledger, and issues a compensating action —
capture-completion or refund — with the whole sequence recorded. The agent is told the resolved
truth, not the optimistic assumption.

### 7.4 Output

A drift report per run and a live counter in the console. The target and the demo artifact:
**100 transactions attempted, zero unreconciled discrepancies.**

---

## 8. Layer 4 — Buyer MCP and chaos suite

### 8.1 Buyer MCP server

A genuine MCP server installed into Claude Desktop. Not a mock, and not positioned as a consumer
wallet product — it is the reference implementation of ACP's buyer half and the third source of
truth.

Tools: `discover_merchant`, `fetch_catalog`, `create_quote`, `update_quote`, `confirm_purchase`,
`cancel`, `refund`, `check_status`, `list_my_transactions`.

Holds an agent signing keypair, a local delegation policy (spend caps, allowed merchants, blocked
categories, confirmation rules), and its own append-only ledger of what it believes it did.

Deliberately thin surface: policy as a config file plus a read-only view. No consumer web app, no
account system, no wallet dashboard.

### 8.2 Chaos suite

Drives 100 transactions with injected failure. Volume alone proves nothing; the failure matrix is
the point.

| Injected condition | Property proven |
|---|---|
| Duplicate and retry storm on one intent | Idempotency holds |
| Webhooks delivered out of order and twice | Event handling is order-independent |
| Cancel racing confirm | No double-spend, no orphaned hold |
| Refund against a partial capture | Money math is correct |
| **Agent reports success on a failed payment** | False-completion detection fires |
| Timeout mid-capture, state indeterminate | Unknown-state resolution works |
| Order value over the policy bound | Bounds enforce, not advise |
| Authority revoked mid-flow | Policy gate fails closed |
| Two agents racing one inventory unit | Hold semantics are real |
| Payment created without `order_id` | Documented Razorpay footgun defended: such payments cannot be captured and auto-refund |

Razorpay's own retry behaviour supplies several of these natively — webhooks retry on exponential
backoff for 24 hours before being disabled, so duplicate and out-of-order delivery is real
behaviour rather than simulation.

---

## 9. Protocol and rails conformance

### 9.1 ACP mapping

| ACP concept | Counter implementation |
|---|---|
| Product Feed Spec | Generated by the Builder, validated field-by-field, served from `/feed` |
| Agentic Checkout Spec | `create` / `update` / `complete` session endpoints returning full cart state — items, pricing, taxes, fees, shipping, discounts, totals, status |
| Delegated Payment Spec | Payment executed by the merchant's own Razorpay account; **merchant remains merchant of record** |
| Capability negotiation | `/.well-known/agent-commerce` manifest |
| Order lifecycle | Handler order states mapped to Razorpay payment states |

### 9.2 Razorpay test-mode mapping

| Counter semantic | Razorpay primitive | Constraint respected |
|---|---|---|
| Quote | Create order | Payments without `order_id` cannot be captured |
| Hold | Payment in `authorized` state | Auto-refunds if uncaptured for 3 days |
| Confirm | Capture | Capture amount must equal order amount |
| Cancel | Leave uncaptured, or explicit refund | Auto-refund path documented to the agent |
| Refund | Refund API | Valid only on `captured` payments |
| Async truth | Webhooks | Identical payload shape in test and live |

### 9.3 Standards consumed, not rebuilt

Web Bot Auth (RFC 9421) for agent identity. AP2-compatible mandate shape for principal authority.
ACP for the commerce interface. Razorpay APIs for settlement. Where NPCI's Unified Agent Protocol
is concerned, Counter aligns with its published registration direction and claims **no
integration**, because UAP is in development rather than shipped.

---

## 10. Data model

```text
Merchant ─┬─ Verification (domain proof, razorpay proof, status)
          ├─ CatalogSource ── IngestRun ── Product ── ConformanceIssue
          ├─ Manifest (versioned)
          ├─ Policy (versioned bounds and thresholds)
          ├─ SigningKey
          └─ CheckoutSession ─┬─ CartState (versioned snapshots)
                              ├─ PolicyDecision
                              ├─ RazorpayObject (order, payment, refund)
                              ├─ WebhookReceipt (idempotent)
                              └─ Order ── LedgerEntry (append-only)

Agent ─┬─ IdentityKey (JWKS reference)
       ├─ Principal (declared authority, AP2-shaped)
       ├─ DelegationPolicy (caps, allowlists, confirmation rules)
       └─ AgentLedgerEntry (claimed state)

ReconciliationRun ── DriftFinding (class, severity, resolution, compensating action)
```

Every `PolicyDecision` and `LedgerEntry` pins the policy version and manifest version in force, so
any transaction is replayable after the fact.

---

## 11. Where AI does real work

Four places, each with a verifiable output rather than a vibe.

| Component | Task | How correctness is checked |
|---|---|---|
| **Catalog normaliser** | Messy product data → ACP-conformant feed with category inference, variant and attribute extraction, availability resolution | Spec validation: pass/fail per field, plus per-field confidence |
| **Manifest composer** | Merchant answers → capability manifest and agent-facing policy language | Schema validation and human review before publish |
| **Drift explainer** | Reconciliation findings → plain-language cause and recommended compensating action | Every claim cites specific ledger and Razorpay records |
| **Buyer agent reasoning** | Natural-language intent → ACP session calls within delegation policy | Policy gate is deterministic; the model cannot widen its own authority |

**Hard constraint throughout: the model proposes, deterministic code executes, and no money action
occurs without passing the policy gate.** No generative output may create a ledger entry, widen a
bound, or assert a payment outcome.

---

## 12. Trust and security model

- Two independent ownership proofs before a tenant transacts: domain control and Razorpay account
  control.
- All inbound agent requests signed; unsigned requests refused.
- Principal declaration required before any checkout session opens.
- Razorpay secrets encrypted at rest, scoped per tenant, never logged.
- Strict tenant isolation at the query and authorisation boundary.
- Policy gate evaluated deterministically, before execution, and fails closed.
- Append-only ledger; corrections are new entries, never mutations.
- Idempotency keys mandatory on all mutating endpoints.
- Webhook signature verification, replay-safe, order-independent.
- Test mode only. No live keys, no real money, stated plainly in the README and the pitch.

---

## 13. Functional requirements

### 13.1 Builder

| ID | Requirement | Priority |
|---|---|---|
| BLD-01 | Complete onboarding questionnaire and persist a merchant tenant | Must |
| BLD-02 | Ingest catalog from Shopify URL, CSV, feed URL, or sitemap | Must |
| BLD-03 | Produce an ACP-conformant product feed, validated field-by-field | Must |
| BLD-04 | Verify domain ownership by DNS TXT, with well-known file fallback | Must |
| BLD-05 | Verify Razorpay account control by live test-mode API call | Must |
| BLD-06 | Block checkout sessions for unverified tenants | Must |
| BLD-07 | Emit a conformance report listing every blocking issue by field | Must |
| BLD-08 | Surface low-confidence inferences for merchant confirmation | Must |
| BLD-09 | Provision manifest, endpoints, webhook subscription, signing key | Must |
| BLD-10 | Support catalog refresh without downtime | Should |

### 13.2 Handler

| ID | Requirement | Priority |
|---|---|---|
| HND-01 | Serve capability manifest and ACP product feed | Must |
| HND-02 | Implement checkout session create, update, complete, cancel | Must |
| HND-03 | Return full cart state on every session response | Must |
| HND-04 | Require and honour `Idempotency-Key` on all mutating endpoints | Must |
| HND-05 | Verify Web Bot Auth signatures; refuse unsigned requests | Must |
| HND-06 | Require a resolvable principal declaration before session creation | Must |
| HND-07 | Evaluate the policy gate deterministically before any money action | Must |
| HND-08 | Park sessions above the review threshold in `requires_human` | Must |
| HND-09 | Execute orders, captures, and refunds on Razorpay test mode | Must |
| HND-10 | Process webhooks idempotently and order-independently | Must |
| HND-11 | Write append-only ledger entries pinning policy and manifest version | Must |
| HND-12 | Enforce tenant isolation at query and authorisation boundaries | Must |

### 13.3 Reconciliation

| ID | Requirement | Priority |
|---|---|---|
| REC-01 | Collect all three views: claimed, recorded, settled | Must |
| REC-02 | Detect all eight drift classes in §7.2 | Must |
| REC-03 | Detect `claimed_success_not_settled` (false completion) specifically | Must |
| REC-04 | Resolve indeterminate state by polling Razorpay, never by assumption | Must |
| REC-05 | Issue and record compensating actions for resolvable drift | Must |
| REC-06 | Report resolved truth to the agent, overriding its optimistic claim | Must |
| REC-07 | Produce a per-run drift report with a discrepancy count | Must |
| REC-08 | Explain each finding in plain language with record citations | Should |

### 13.4 Buyer MCP and chaos

| ID | Requirement | Priority |
|---|---|---|
| BUY-01 | Working MCP server usable from Claude Desktop | Must |
| BUY-02 | Full ACP buyer flow: discover, quote, confirm, cancel, refund, status | Must |
| BUY-03 | Sign all outbound requests and declare the principal | Must |
| BUY-04 | Enforce local delegation policy before calling the merchant | Must |
| BUY-05 | Maintain an independent agent-side ledger of claimed state | Must |
| BUY-06 | Chaos suite driving 100 transactions across all ten conditions in §8.2 | Must |
| BUY-07 | Deterministic seeding so a run is reproducible | Should |

---

## 14. Acceptance criteria

1. A merchant completes onboarding and reaches a verified, transactable tenant in under ten minutes.
2. Generated product feed validates against the ACP Product Feed Spec.
3. Conformance report accurately lists every blocking field issue.
4. An unverified tenant cannot open a checkout session.
5. Claude, via the buyer MCP, completes a purchase end to end against a Counter merchant.
6. A purchase exceeding the policy bound is refused, with the rule that fired named.
7. A session above the review threshold parks in `requires_human` and does not capture.
8. Duplicate intent submission produces exactly one capture.
9. Out-of-order and duplicated webhooks converge to correct terminal state.
10. A simulated false completion is detected and the agent's claim is corrected.
11. An indeterminate mid-capture timeout is resolved against Razorpay, with a compensating action.
12. 100-transaction chaos run completes with **zero unreconciled discrepancies**.
13. Every money action in the run has an audit entry naming policy version, rule, and outcome.
14. Two distinct merchants are onboarded through the same Builder, proving reusability.

---

## 15. What Counter is not

Not a new protocol — it implements ACP. Not a consumer wallet — Cloudflare, Stripe, and NPCI own
that. Not an agent identity standard — it consumes Web Bot Auth. Not a scraper or CAPTCHA bypass —
it exists so bypassing is unnecessary. Not connected to NPCI UAP, which is unshipped. Not live —
Razorpay test mode only. Not a chargeback or fraud-guarantee product.

---

## 16. Risks

| Risk | Response |
|---|---|
| Reconciliation reads as plumbing, not innovation | Lead the demo with false-completion detection; cite the 59.6% critical-failure finding |
| Builder reads as a no-code toy | Keep reconciliation central; make catalog normalisation visibly hard with pass/fail output |
| Scope overrun across four layers | Buyer MCP surface stays thin; no SDK suite; two buffer days held |
| DNS propagation breaks the live demo | Pre-verify one merchant; show the verification flow, cut to verified tenant |
| ACP spec drift before submission | Pin the spec version consumed; re-check immediately before recording |
| Incumbent ships the same thing mid-build | Re-validate §3 before submission; Cloudflare shipped Wallets during research |
| Claiming novelty too strongly | State "no implementation found" rather than "none exists" |

---

## 17. References

- [Agentic Commerce Protocol — Stripe](https://docs.stripe.com/agentic-commerce/acp) · [spec home](https://agenticcommerce.dev)
- [ACP Agentic Checkout Spec](https://developers.openai.com/commerce/specs/checkout)
- [ACP Product Feed Spec](https://developers.openai.com/commerce/specs/spec)
- [ACP key concepts and Delegated Payment Spec](https://developers.openai.com/commerce/guides/key-concepts)
- [Razorpay MCP Server tools reference](https://razorpay.com/docs/mcp-server/tools-reference/)
- [Razorpay refunds API](https://razorpay.com/docs/api/refunds/)
- [Razorpay payment capture API](https://razorpay.com/docs/api/payments/capture/)
- [Razorpay webhook best practices](https://razorpay.com/docs/webhooks/best-practices/)
- [Razorpay webhook validation and testing](https://razorpay.com/docs/webhooks/validate-test/)
- [Web Bot Auth](https://developers.cloudflare.com/bots/reference/bot-verification/web-bot-auth/)
- [AP2 donated to FIDO Alliance](https://blog.google/products-and-platforms/platforms/google-pay/agent-payments-protocol-fido-alliance/)
- [NPCI Unified Agent Protocol in development](https://www.businessworld.in/article/india-eyes-ai-powered-upi-payments-as-npci-develops-protocol-for-agentic-transactions-613952)
- [Agent reliability failure rates](https://www.fiddler.ai/blog/ai-agent-failure-rate) · [failure severity characterisation](https://www.securityscientist.net/blog/ai-agent-reliability/)
- Full competitive and feasibility evidence: [AGENT-DELEGATION-RESEARCH.md](./AGENT-DELEGATION-RESEARCH.md)

External-source content was rephrased for compliance with licensing restrictions.
