# Counter — Build and Submission Plan

**Status:** Active
**Version:** 1.0
**Date:** 22 August 2026
**Deadline:** 5 September 2026 (14 days)
**Track:** 01 — AI Growth & Agentic Commerce
**Companion documents:** [PRD.md](./PRD.md) · [AGENT-DELEGATION-RESEARCH.md](./AGENT-DELEGATION-RESEARCH.md)

---

## 1. What the buildathon is actually evaluating

Decoded from the official brief and application form.

**Track 01 brief:** build an agent that grows revenue for a merchant on Razorpay test-mode APIs, *or
that makes a merchant transactable by an AI buyer end to end.* Counter targets the second clause,
which most entrants will skip in favour of building buyer-side shopping agents.

**Track 01 bar, quoted in substance:** every money action explainable, bounded and gated; show the
audit trail and one failure handled gracefully.

Two readings of that bar matter:

1. It is a **values screen**. Razorpay is RBI-regulated. Unbounded agent money movement is a
   compliance problem, not a bug. They are testing whether gating and logging are reflexes.
2. It is the **discriminator**, because most submissions will fail it. The median build will be an
   agent that spends money with no caps, no audit, and no failure path.

**The trap:** if the bar is the minimum, a project whose entire value proposition *is* the bar has
submitted the baseline. Counter clears the bar as a byproduct and differentiates on reconciliation.

**The form asks 12 things.** Six administrative, six about the build: track, project name, what it
solves, public GitHub URL, 5-minute pitch video (unlisted acceptable), and **"what broke, and how
you got out."** The brief states the resume is taken but not screened on, and that the last field is
read first.

**Therefore the single highest-value output is a real debugging narrative.** A clean build that
never broke is a weaker submission than a messier one with a genuine war story. The 100-transaction
chaos suite is not only a differentiator — it is the mechanism that manufactures three honest war
stories with commits attached.

---

## 2. Strategy

| Goal | Mechanism |
|---|---|
| Clear the bar | Policy gate, append-only ledger, nine handled failure classes — all structural, not bolted on |
| Differentiate | Reconciliation engine and false-completion detection, which nothing shipped does |
| Answer "what broke" | Chaos suite at concurrency will surface real idempotency, ordering, and unknown-state bugs |
| Prove reusability | Onboard two distinct merchants through the same Builder |
| Show AI depth | Catalog normalisation with pass/fail spec validation; drift explanation with citations |
| Avoid a losing comparison | Buyer side positioned as ACP reference client, never as a wallet product |

**Speak their vocabulary.** The brief names ACP, AP2, x402, and NPCI UAP under "why now." Build on
those, never claim to replace them, and be precise that UAP is unshipped.

---

## 3. Scope

**In scope.** Builder with questionnaire, catalog ingestion, dual ownership verification, and
conformance report. Handler with manifest, feed, ACP checkout sessions, agent verification, policy
gate, and append-only ledger. Reconciliation engine with all eight drift classes and unknown-state
resolution. Buyer MCP server working in Claude Desktop. Chaos suite driving 100 transactions across
ten conditions. Console showing queue, decision detail, ledger, and drift report.

**Explicitly out of scope.** Live keys or real money. Multi-language SDK suite. Consumer wallet UI
or account system. Agent email inbox. NPCI UAP integration. Cross-merchant data sharing of any
kind. Public Shopify App Store listing. Predictive or trained models.

**Cut first if time runs short**, in this order: catalog refresh without downtime, drift
explanations in plain language, second merchant onboarding, console polish. **Never cut:**
reconciliation, false-completion detection, the policy gate, or the chaos suite.

---

## 4. Stack

TypeScript end to end. Fastify for the Handler and Builder API. Next.js for the Builder wizard and
console. PostgreSQL with Prisma. BullMQ on Redis for ingestion, webhook processing, reconciliation
runs, and chaos orchestration. Official MCP TypeScript SDK for the buyer server. Razorpay Node SDK
against test mode. Ed25519 via Node `crypto` for Web Bot Auth signing and verification. Zod for
ACP schema validation. Vitest for tests. Pino for structured logs.

Rationale: one language across four components, no context switching, and the MCP SDK plus Razorpay
SDK are both first-class in Node.

---

## 5. Twelve-day build plan

Two buffer days held. Day numbers are working days from 23 August.

**Day 1 — Foundation.** Repo, monorepo layout, PostgreSQL schema for the full data model in PRD §10,
Prisma migrations, tenant isolation at the query boundary, structured logging, Razorpay test account
and keys, health checks. Commit early and often — commit history is read.

**Day 2 — Handler skeleton and Razorpay lifecycle.** Order creation, authorise, capture, refund
against test mode. Prove the state machine by hand, including the documented footguns: payments
without `order_id` cannot be captured, authorised payments auto-refund after three days, capture
amount must equal order amount. Write the ledger primitives.

**Day 3 — Webhooks done properly.** Signature verification, idempotent receipt storage,
order-independent state convergence, replay safety. Razorpay retries on exponential backoff for 24
hours then disables, so duplicate and out-of-order delivery is native behaviour to handle, not
simulate. This day is where the first real bug will appear.

**Day 4 — ACP checkout sessions.** `create`, `update`, `complete`, `cancel`. Full cart state on
every response — items, pricing, taxes, fees, shipping, discounts, totals, status. Mandatory
`Idempotency-Key` handling. Validate request and response shapes against the pinned ACP spec
version with Zod.

**Day 5 — Identity and policy gate.** Web Bot Auth verification (RFC 9421, Ed25519, JWKS
resolution). Principal declaration in AP2-compatible shape. Deterministic policy gate: value bounds,
method allowlist, SKU and category blocks, rolling-window spend, review threshold parking sessions
in `requires_human`, fail-closed on revoked authority. Every decision writes the rule that fired
and the policy version.

**Day 6 — Buyer MCP server.** Working in Claude Desktop. All nine tools. Outbound request signing,
principal declaration, local delegation policy enforced before calling out, independent agent-side
ledger. First genuine end-to-end purchase driven by natural language.

**Day 7 — Reconciliation engine.** Collect claimed, recorded, and settled views. Detect all eight
drift classes. Unknown-state resolution by polling Razorpay, never assuming. Compensating actions
recorded. Agent's optimistic claim overridden by resolved truth. **This is the differentiator; give
it a full day and protect it.**

**Day 8 — Chaos suite.** All ten injected conditions from PRD §8.2, deterministic seeding, 100
transactions at concurrency. Expect to find real bugs here — that is the point. Fix them, and keep
notes on each for the "what broke" answer.

**Day 9 — Builder part one.** Questionnaire, tenant provisioning, DNS TXT domain verification with
well-known fallback, Razorpay account verification by live test call, unverified tenants blocked
from sessions.

**Day 10 — Builder part two: catalog ingestion.** Shopify URL, CSV, feed URL, sitemap. LLM-driven
normalisation to ACP feed: category inference, variant and attribute extraction, price and currency
normalisation, availability resolution, per-field confidence. Field-by-field spec validation.
Conformance report with every blocking issue named.

**Day 11 — Console and second merchant.** Overview with live drift counter, session queue, decision
detail showing rule and policy version, ledger view, drift report. Onboard a second distinct
merchant through the same Builder to prove reusability.

**Day 12 — Hardening and artifacts.** Tests on the decision engine, idempotency, and reconciliation.
Full 100-transaction run recorded with the zero-drift report. README with architecture diagram and
setup path. OpenAPI spec. `NOT_BUILT.md` listing what is deliberately out of scope and why.

**Days 13–14 — Buffer, pitch video, submission.** Record the 5-minute pitch. Rehearse the
architecture walkthrough. Write the "what broke" answer properly. Submit.

---

## 6. Demo script — five minutes

1. **The problem, 40 seconds.** ACP is published and open. No Indian merchant can be transacted with
   by an AI buyer. Agents today fight CAPTCHAs because merchants have no front door. Show the
   OpenAI concession that Instant Checkout lacked flexibility and refocused on browsing — even the
   protocol's author retreated from checkout.
2. **Onboard live, 60 seconds.** Plain store into a verified, agent-transactable merchant. End on
   the conformance report: 328 of 340 SKUs purchasable, twelve blocked, each named.
3. **Buy inside Claude, 60 seconds.** Natural language, real MCP server, real Razorpay test capture.
   Then attempt a purchase over the policy bound and get refused with the rule named.
4. **Break it, 90 seconds.** Inject a false completion — the agent reports success on a payment that
   never settled. Show reconciliation catching it, correcting the agent's claim, and issuing the
   compensating action. **This is the moment the room turns.**
5. **The number, 30 seconds.** 100 transactions, ten failure classes, zero unreconciled
   discrepancies. Audit trail on screen.
6. **Architecture and constraint, 20 seconds.** Model proposes, deterministic code executes, no
   money action bypasses the policy gate.

Weight steps 4 and 5. They are the differentiator and the bar simultaneously.

---

## 7. Panel questions to have answers ready for

- **How is this different from Cloudflare Wallets or Stripe Link?** Those are buyer-side wallets.
  Counter is merchant-side. The buyer MCP is a reference client to exercise the protocol, not a
  wallet product.
- **Why not just use ACP directly?** We do — Counter *is* an ACP implementation. The contribution is
  making it generatable for merchants with no engineering capacity, and adding the integrity layer
  the spec does not define.
- **Does AP2 not already solve authority?** Yes, and we align with its mandate shape. Authority is
  solved; competence is not. Agents fail 70–95% of real tasks and the most severe failures include
  false completion claims. Authority controls cannot catch a correctly authorised transaction the
  user never wanted.
- **Are you integrated with NPCI UAP?** No. UAP is in development. We align with its published
  registration direction and claim nothing more.
- **What stops the LLM causing a bad payment?** The policy gate is deterministic code evaluated
  before execution and fails closed. No generative output can create a ledger entry, widen a bound,
  or assert a payment outcome.
- **Is this live?** Test mode only. No live keys, no real money.
- **What broke?** Have three real answers with commits — most likely candidates are webhook ordering
  convergence, idempotency under the retry storm, and unknown-state resolution after a mid-capture
  timeout.

---

## 8. Submission checklist

- [ ] Public GitHub repo, clean incremental commit history, no secrets committed
- [ ] README: problem, architecture diagram, setup, test-mode disclaimer
- [ ] OpenAPI spec for the Handler
- [ ] `NOT_BUILT.md` with deliberate exclusions and reasons
- [ ] Recorded 100-transaction run with zero-drift report committed as an artifact
- [ ] Tests passing on decision engine, idempotency, reconciliation
- [ ] Two merchants onboarded, both demonstrable
- [ ] 5-minute pitch video, unlisted
- [ ] "What broke, and how you got out" written honestly and specifically
- [ ] §3 competitive claims re-validated within 48 hours of submitting

---

## 9. Risks

| Risk | Severity | Mitigation |
|---|---|---|
| Four layers overrun 12 days | High | Cut order defined in §3; buyer surface stays thin; two buffer days |
| Reconciliation reads as plumbing | Medium | Lead with false completion, cite the 59.6% critical-failure finding |
| Builder reads as a no-code toy | Medium | Keep reconciliation central; make normalisation visibly hard |
| DNS propagation breaks live demo | Low | Pre-verify one merchant, show flow, cut to verified |
| ACP spec drift | Low | Pin spec version; re-check before recording |
| Incumbent ships this mid-build | Medium | Re-validate before submission; Cloudflare shipped Wallets during research |
| Razorpay test mode lacks a needed primitive | Medium | Lifecycle verified on day 2 before anything is built on it |

---

## 10. Immediate next actions

1. Create the Razorpay test account and generate test-mode API keys.
2. Pin the ACP spec version and archive a local copy of the feed and checkout specs.
3. Scaffold the monorepo and the PostgreSQL schema from PRD §10.
4. Prove the Razorpay order → authorise → capture → refund lifecycle by hand before building on it.
5. Start the `WHAT_BROKE.md` log on day 1 and append to it as things break — do not reconstruct it
   from memory on day 13.

---

## 11. References

- [Razorpay AI Buildathon](https://razorpay.com/buildathon) · [format and tracks breakdown](https://velonx.in/blog/razorpay-ai-buildathon-2026-tracks-eligibility-stipend-selection-process)
- [Agentic Commerce Protocol — Stripe](https://docs.stripe.com/agentic-commerce/acp) · [agenticcommerce.dev](https://agenticcommerce.dev)
- [ACP Agentic Checkout Spec](https://developers.openai.com/commerce/specs/checkout) · [Product Feed Spec](https://developers.openai.com/commerce/specs/spec)
- [Razorpay MCP Server](https://razorpay.com/docs/mcp-server/) · [tools reference](https://razorpay.com/docs/mcp-server/tools-reference/)
- [Razorpay capture](https://razorpay.com/docs/api/payments/capture/) · [refunds](https://razorpay.com/docs/api/refunds/) · [webhook best practices](https://razorpay.com/docs/webhooks/best-practices/)
- [Web Bot Auth](https://developers.cloudflare.com/bots/reference/bot-verification/web-bot-auth/)
- [Model Context Protocol authorization spec](https://modelcontextprotocol.io/specification/draft/basic/authorization)
- Competitive and feasibility evidence: [AGENT-DELEGATION-RESEARCH.md](./AGENT-DELEGATION-RESEARCH.md)

External-source content was rephrased for compliance with licensing restrictions.
