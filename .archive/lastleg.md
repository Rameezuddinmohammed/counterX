# Last Leg — Project Context Report

**Written:** 2026-09-04, after a full sweep of the repo: every top-level doc, the four
plan files in `~/.claude/plans`, all 47 PRs, 100 commits of history, the `.kiro` specs,
the `.agents` work tracker, the `.archive` v1.0 docs, and the current working tree.

**What this document is:** an orientation report, not a plan. It answers three questions —
what the project is, what it was being built toward, and where `finalplan.md` actually
stands when checked against the repo rather than read. Section 6 is the part that changes
decisions; the rest is context.

Every claim marked **verified** was checked by running a command this session. Section 7
lists what I did *not* verify, so nothing here gets mistaken for a full audit.

---

## 1. What Counter is

An **India-first, two-sided, protocol-neutral agent-commerce platform**. The one-sentence
version: it is the control plane that lets a person's AI agent buy real things from real
merchants, spending only inside limits the human cryptographically signed, without Counter
ever touching the money.

Three named products (`PRD.md` §1):

- **Counter Merchant** — a merchant connects existing systems (Shopify, Razorpay) and
  gets a machine-facing commercial representative agents can discover and transact with.
- **Counter Agent Wallet** — a person registers an agent, defines bounded purchasing
  authority, attaches non-custodial payment references, reviews activity, revokes, keeps
  evidence. "Wallet" means a *policy and evidence* wallet. `PRD.md` §6.2 is blunt about
  it: *"It does not mean stored money."*
- **Counter Trust Protocol (CTP)** — the versioned canonical contract between them:
  identity, principal-agent binding, mandates, intents, quotes, policy decisions,
  evidence, receipts.

### The measurable promise

`PRD.md` §1 stakes the whole product on one property: **no silent consequential failure.**
Every material action is attributable, bounded, idempotent, auditable, and *either*
confirmed against an authoritative source *or* explicitly represented as pending, blocked,
declined, failed, or indeterminate. `INDETERMINATE` is a first-class state, not an error
branch. This is the thing the architecture is actually shaped around.

### The problem it claims

Agents can't reliably complete purchases because merchant data is fragmented, protocols
address different layers, **an authenticated agent is not necessarily authorized to
spend**, buyer and merchant policy must both survive translation, payment/order/fulfillment
systems disagree, and retries create duplicate charges. `PRD.md` §2 sums up the gap: a
checkout message doesn't onboard a merchant, prove buyer authority, execute an Indian
payment, or repair a partial failure.

### The hard boundary — and it is load-bearing everywhere

`PRD.md` §5 lists what Counter is **not**: not a bank, PPI issuer, TPAP, payment
aggregator, escrow, custodian; not *"a stored-value account, reloadable balance, payment
instrument, or place where users top up money."* §14: Counter *"does not hold, pool,
receive, transmit, or settle"* funds. Refunds *"are never credited to a Counter balance."*

A stored-value product would need a separate legal program and an RBI-authorized partner.
This is not a style preference in the docs — it is repeated in at least twelve places
across `PRD.md`, `PILOT.md`, and `.kiro/specs/counter-agent-wallet/*`. **Remember this for
§6.** It is the single most consequential invariant in the project, and `finalplan.md`
deliberately crosses it.

### The trust protocol, briefly

CTP (`TRUST-PROTOCOL.md`) is a common signed envelope — `ctp_version`, `type`, `issuer`,
`subject`, `audience`, `environment`, validity window, `nonce`, `correlation_id`,
`payload_digest`, `payload`, `evidence_refs`, Ed25519 `signature` — carrying object types
like `counter.mandate.v1`, `counter.purchase-intent.v1`, `counter.merchant-quote.v1`,
`counter.policy-decision.v1`, `counter.evidence.v1`, `counter.revocation.v1`,
`counter.transaction-receipt.v1`.

Rules that matter downstream: an envelope valid in one environment is invalid in another;
unknown critical fields fail closed; algorithm downgrade and `none` are rejected; expired
objects stay evidence but authorize nothing; **private keys and raw payment credentials
never enter CTP.** §16 specifies a 13-step pre-commit verification sequence, and §19 lists
16 invariants that must be automated before CTP 0.1 can be called Verified.

The important design property, and the reason the crypto pivot in §3 wasn't a rewrite:
**a mandate is rail-agnostic.** It binds a ceiling, a merchant allowlist, categories,
currencies, an expiry, and a `payment_authorization_ref` — it never binds a payment
mechanism.

### Honesty machinery

Two things are unusual and worth respecting rather than routing around:

- **Every doc defaults to `Planned`.** `PRD.md`'s own header: *"documentation is not
  implementation evidence."* Status vocabulary is fixed (`Planned` → `In Progress` →
  `Verified` → `Released`, plus `Degraded`/`Suspended`/`Deferred`).
- **`CONFORMANCE.md` is a claims register with an evidence bar.** Verified current state:
  CTP, Native API, Agent Wallet, MCP, Razorpay, Shopify all `Planned`; ACP `Deferred`;
  AP2 `Deferred, design-aligned`; NPCI UAP `Watch-only`; and the crypto slot reads
  *"x402 / crypto settlement rail — Planned; actively being designed, Deferred from
  pilot."* That last line is the Phase 2 doc update landing.

---

## 2. The intended architecture

A pnpm monorepo, TypeScript ESM strict — **12 apps, 26 packages**, pinned to
`pnpm@9.15.4` / Node 22.14.0.

**Shape:** canonical domain core → CTP trust protocol → bilateral policy engine →
orthogonal transaction state machine → adapters at every boundary → evidence /
reconciliation / receipts. Enforced by `dependency-cruiser` (`domain` has zero
framework imports; merchant packages never import wallet packages or vice versa; no
package imports an app).

**Backend services:** `control-plane-api` (merchant/wallet state, routes), `worker`
(the job loop and the only real money path), `agent-runtime` (merchant-facing runtime
API), `remote-mcp` (hosted MCP + OAuth proxy + Vault key custody), `local-mcp` (stdio
MCP for a buyer's own machine).

**Consoles (Next.js):** `merchant-console`, `wallet-console`, `operations-console`,
`onboarding`, `landing`.

**Harnesses:** `reference-buyer` (17-scenario CTP conformance corpus,
`SCENARIO-001..017`), `reference-services` (REST fixture server).

**Data:** Supabase Postgres, schemas `platform` / `identity` / `merchant` / `wallet` /
`runtime`. **Verified: 24 forward+rollback migration pairs, `0001` through `0024`** —
identity/tenancy and RLS, runtime infra, lifecycle steps, kill switches, spend ledger,
quotes, wallet-user onboarding, recurring payments, Shopify connections, refund requests,
merchant onboarding, receipts, catalog sync, wallet revocations/mandates, mandate payment
refs, `0021-wallet-prepaid-balance` (the retired experiment), webhook endpoints, and two
remote-MCP/Vault migrations.

**External:** Shopify Admin GraphQL 2025-07, Razorpay v1 test mode, Auth0, Fly.io
(backends), Vercel (consoles), HashiCorp Vault (Transit signing).

**The transaction model** (`PRD.md` §13): one orchestration phase — `DRAFT → QUOTED →
CHECKOUT_READY/REVIEW_REQUIRED → COMMITTING → ACTIVE/CLOSED`, plus `INDETERMINATE`,
`DECLINED`, `EXPIRED`, `CANCELED`, `FAILED_REQUIRES_ACTION` — *plus five orthogonal
sub-states* (reservation, payment, order, fulfillment, return), each with its own
transition table. The stated reason: *"A single status cannot truthfully represent all
external systems."*

### The money seam

`apps/worker/src/real-lifecycle.ts`'s `authorizeAndCapture` is where money moves. Order,
per `the-mandate-pivot.md`'s verified map:

1. in-process outcome-cache short-circuit
2. **kill-switch gate**
3. **policy gate** — mandate lookup, revocation checks, rolling spend-ledger reservation
4. variant resolution (read-only)
5. durable step-ledger pre-claim
6. **← first irreversible external effect (Shopify draft order)**
7. record that step
8. **the payment leg** — recurring-mandate charge, or Razorpay order + CTP-signed capture
9. order finalize
10. mark-paid
11. authoritative evidence query
12. reconcile and cache

Every gate sits at 2–3, ahead of 6. `CLAUDE.md` makes this a hard invariant: *"Money-affecting
checks run before the external effect, not after."* Any new rail belongs **inside step 8** —
not earlier (breaks the ordering) and not after 9 (the order would exist before funds were
committed).

Idempotency is layered and was proven by execution, not assertion: in-process cache,
durable `runtime.lifecycle_steps` with an atomic pre-claim closing the cross-instance race
on Shopify's `draftOrderCreate` (which has no native idempotency key), and provider-native
`X-Razorpay-Idempotency`. An integration test counts real Shopify API invocations across two
racing workers and asserts exactly one draft. A crash-simulation test kills the process
between draft and finalize and asserts restart resumes from the ledger.

Deliberate detail worth not "fixing" by accident: **indeterminate steps are never written
to the step ledger**, so a later attempt can re-drive them instead of the ledger locking in
an unresolved effect.

---

## 3. How it got here — the chronology

Reconstructed from 47 PRs and the plan lineage. The plans are the honest record; each one
opens by naming what it supersedes and why.

### Aug 23–26 — Foundation (PRs #1–#6)

CTP schema package, policy, transaction, payment, evidence, APIs. Observability, privacy,
`SecureKeyStore`, smoke tests, deployment, evidence bundle. Readiness engine and capability
manifest. This is the `.kiro/specs/counter-platform-foundation` work.

### Aug 25–27 — Counter Merchant + durability (PRs #4, #7–#14)

Full pilot commerce stack (Tasks 1–21). Then the durable cross-instance atomic rolling-spend
ledger (#7), merchant Transactions page wired to the real read-model (#8), and a run of
build/deploy fixes — Docker building only the target backend (#9), topological builds via TS
project references (#10), `pg` ESM default-import (#11).

### Aug 29 — The audit

`COUNTERX-ARCHITECTURE.md` was written against a real audit: build, boot, HTTP probe, not
static reading. Its finding was uncomfortable and specific: roughly **30,000 lines of
tested application logic imported by nothing that runs.** The full bilateral policy engine,
signed CTP receipts, the complete `CheckoutOrchestrator`, all of `@counter/observability`
(152 tests) — built, tested, orphaned. The worker used six hand-rolled predicates instead of
the policy engine. Fly ran `dist/index.js`, a side-effect-free barrel, so **the deployed
worker had never processed a job.** `agent-runtime` threw at module scope under
`NODE_ENV=production`. Nothing anywhere enqueued a job. Every `runtime.*` repository
hardcoded `environment='local'` while the reader bound `environment=NODE_ENV`.

That audit set the agenda for everything after it. Its own closing rule is the most useful
line in the repo: *a static read of this repo is not sufficient evidence for either "it
works" or "it's broken."* Its first pass got two claims wrong from reading alone and only
caught them by executing.

### Aug 30–31 — Wiring the orphans (`streamed-scribbling-sutherland.md`, PRs #15–#24)

Phases A–G. The insight was that this was *wiring, not inventing*: real webhook consumers
for Shopify and Razorpay, activating the real catalog-sync engine, per-merchant Razorpay
credential routing, durable revocation cascade (which `jazzy-roaming-lake.md` finished),
merchant onboarding wizard, refund relay, real Auth0 boundary, real receipt issuance.

Founder decisions recorded here: Razorpay Route deferred, "bring your own Razorpay account"
is the complete v1 path, WooCommerce as the eventual second connector, and **Razorpay-only
on gateways** — decided by research, not assumption: Shopify Payments doesn't operate in
India at all under RBI rules.

`jazzy-roaming-lake.md` also flagged something that had no recorded answer at the time:
the `CLAUDE.md` paragraph claiming a blanket *"granted 2026-08-31"* production-autonomy
authorization, and a loosened `git push` hook, appeared in a diff that contradicted the
founder's explicit instruction in that same session. That plan left both files untouched
pending confirmation. **Resolved 2026-09-05: the founder confirmed directly that this
autonomy grant is real and intentional.** The paragraph stands in `CLAUDE.md` on `main`
on that basis, not as an unconfirmed claim.

### Sep 2–3 — Real purchases, then the remote connector (`federated-enchanting-wave.md`, PRs #25–#38)

Phase 0 hit a wall that shaped everything after it. `MandateBindingService.bind()` would
only create a durable `WalletMandate` if it could verify an *active Razorpay recurring
provider mandate* backing it — and **Razorpay's UPI Autopay / UPI Intent is not
self-service-enabled**, confirmed by direct testing against two separate fresh Razorpay test
accounts. Without it, a mandate could never exist, so no purchase could pass
`checkMandateAuthority`.

The workaround: **a prepaid balance Counter holds** (migration `0021`), with
`prepaid-balance:<walletId>` as a wallet-scoped sentinel `payment_reference_id`. It
unblocked the loop. It also directly contradicted the founding non-custodial rule. Migration
`0021`'s own header comment is the fullest paper trail that decision has anywhere.

Then Phase 2 (notifications backbone — finally running the outbox dispatcher, which had
existed fully tested with zero callers), Phase 3 (remote MCP connector: Vault Transit key
custody, a Fastify reimplementation of the MCP SDK's OAuth surface, two-legged Auth0 proxy),
Phase 4 (wallet-dashboard backend). Phase 3 was an explicit, documented reversal of the
original *"local stdio by default; no unauthenticated network listener"* principle — written
into `design.md` rather than left implicit, on the founder's decision that a buyer should
connect to exactly one thing.

PRs #28–#35 are the cost of that: eight consecutive fixes for one remote-MCP OAuth flow.
Missing `WWW-Authenticate` on 401. Rate limiting sharing one IP budget behind Fly's edge.
Token-exchange failures leaving zero server-side trace. CORS preflight silently rejecting
every browser client. A crash-loop, then a cold-start race. Each one invisible until
something real hit it.

### Sep 3–4 — The mandate pivot (`the-mandate-pivot.md`, PRs #39–#46)

A founder conversation surfaced the doc-vs-code conflict directly, and the decision was to
**stop building around Razorpay's blocker with custody.** Instead: authority is a signed
mandate, never a balance — which was the original design intent, *the balance was the
deviation*. Crypto becomes the settlement rail, because a mandate maps naturally onto a
scoped on-chain permission, settlement is buyer-wallet-to-merchant-wallet with no custody
anywhere, and there's no human-present checkout page blocking autonomous capture. UPI
Autopay becomes "coming soon." Merchant-side wallets/withdrawals were considered and
**rejected** — money lands directly in the merchant's own account; a merchant-held balance
would be custody on *both* sides.

**Phase 1 (Unblock)** — PRs #39–#43. The bar was explicit: *a real, ordinary Auth0 login,
not an operator script, reaching all the way through — log in, pass step-up, register an
agent key, create a mandate with real guardrails — with no engineer touching the database.*
It was met. Two real mandates landed from a browser, carrying `policy_version_id:
wallet-console-v1` — and that string is the whole point, because every prior mandate in that
table reads `cli-v1`, meaning an engineer ran a script.

Getting there cost four live Auth0 tenant fixes that **exist nowhere in git** (see §5), and
the first recorded root cause of the final blocker was wrong in a superficially convincing
way. `HANDOFF.md` §1 keeps both the wrong and right diagnosis, deliberately.

**Phase 2 (retire the prepaid balance)** — PR #44, commit `4f09f1b`. This went beyond the
plan's file list on the founder's explicit decision, and the extra part mattered most:
`main.ts` constructed `PostgresWalletBalanceStore` *unconditionally*, and the debit branch
sat *ahead of* the Razorpay path — so any wallet purchase with no `paymentReferenceId` drew
from the stored pot first. Since `topUp()` had zero callers and `debit()` treats a missing
row as `0n`, that path returned `INSUFFICIENT_BALANCE → declined`. **The custodial branch
was silently breaking real purchases, not merely sitting unused.** Removing it restored the
Razorpay path.

Then PR #45 (real mandate listing + buyer-initiated revoke — the first screen where a buyer
can see their own mandates) and PR #46, which deserves its own line: the rolling spend
ledger **did not actually enforce its cap** on a wallet's first-ever reservation.
`FOR UPDATE` only locks rows that exist, so under `READ COMMITTED` two concurrent
first-ever reservations both saw zero rows and both inserted. Reproduced deterministically
5/5 against real Postgres — three concurrent 400,000-minor reserves against a 1,000,000 cap,
all three succeeded. Fixed with `pg_advisory_xact_lock` keyed on (environment, walletId).
Masked in production only because the worker processes jobs serially in one instance — and
it would have doubled exposure the moment a second rail or instance existed.

**Phase 3 (crypto rail)** — PR #47, open. Research sharpened the chain decision rather than
settling it, and found something genuinely useful: **the CTP mandate seed is byte-for-byte a
Solana keypair seed.** Bare 32-byte Ed25519, raw canonical-JSON signed directly, 64-byte
signature — confirmed by round-tripping one seed through both a CTP envelope and a synthetic
Solana transaction. `VaultSecureKeyStore` and `FileSecureKeyStore` can both sign Solana
transactions. The one path that cannot is the one Phase 1.3 just shipped: the browser consent
key is generated with `crypto.getRandomValues`, held in a function-local `const`, and
discarded when the tab closes — correct for one-time consent, but it means a self-serve
buyer has no durable key to reuse on-chain.

### Sep 4, mid-session — `finalplan.md`

The buildathon detour. Covered in §6.

---

## 4. Where it actually stands — verified this session

**Branch state.** On `feat/wire-solana-settlement-v2`, **4 commits ahead of `origin/main`**,
with **8 files modified and uncommitted**.

The uncommitted diff is the one thing in the repo with no PR and no home: **the Solana
settlement wiring into the worker's money seam.** It adds a `solanaSettlement` branch inside
`real-lifecycle.ts` at step 8, selected when `paymentReferenceId` decodes as a Solana
on-chain delegation, with explicit `declined` / `indeterminate` / unexpected-outcome
handling, plus 210 lines of new tests. **Verified: `pnpm --filter @counter/worker run
typecheck` exits 0 clean.**

Its own code comment flags its central limitation honestly: `merchantReceivingAddress` is
resolved **once at boot for one address**, the same single-pilot-merchant shortcut
`boot.ts` uses for Razorpay credentials. The comment states outright that a real
multi-merchant version must resolve per-charge from `merchant.wallet_connections`, because
boot-time resolution *"would misdirect every merchant's settlement to one address the moment
there's a second merchant."*

**Pull requests.** 47 total. Two open: **#47** (crypto-adapter Solana rail, `MERGEABLE`) and
**#36** (a superseded docs PR). The rest merged.

**`packages/crypto-adapter`** — verified 14 source files, 4 of them tests:
`solana-settlement-provider` (implements `PaymentProvider` as `direct_capture` — a Solana
transfer is one atomic instruction, so `authorize`/`capture` are deliberately unimplemented),
`mandate-delegation` (issuance-time, a different moment from settlement),
`real-solana-port` / `solana-port` (real network behind a narrow injectable interface, so no
test touches the network), `associated-token`, `metadata-codec`,
`payment-reference-codec`, `config`, `types`. 23 tests. PR #47 reports lint/typecheck/build/test
all passing.

PR #47's own disclosures, which are the right ones to carry forward: the program is really
deployed on devnet (confirmed by direct on-chain account query, `executable: true`), and
`initSubscriptionAuthority` / `createFixedDelegation` / an under-cap `transferFixed` were
really executed against devnet. But **on-chain over-cap rejection was never observed live** —
devnet's shared faucet ran dry first. INR paise pass straight through as the token's smallest
unit with no FX layer. There is no CTP-signed evidence envelope for this rail, on the argument
that a devnet transaction signature is independently publicly verifiable.

**`wallet-console`** — verified 13 pages and 4 API routes. `connect/` (real: step-up popup,
in-browser Ed25519 keypair, key registration, client-side mandate signing) and `mandates/`
(real: listing + revoke, from PR #45) are genuinely wired. The other eleven —
`approvals`, `devices`, `enrollment`, `export`, `policy`, `profile`, `references`,
`security`, `settings`, `transactions`, `triggers` — are the pre-existing static set.

**Verification gate.** `pnpm verify` = `format:check && lint && build && typecheck &&
depcruise && test`. Last full recorded result (`.agents/tasks/task-codebase-sanity-cleanup/FINDINGS-REPORT.md`):
build green, **2811 tests passing**, depcruise 0 violations across 1848 modules, lint down
from 963 errors to 1 known backlog item. That cleanup's root cause is worth knowing —
941 of the 963 lint errors were ESLint reading `apps/landing/out/`, a gitignored Next static
export. One missing ignore pattern.

**Known-stale docs.** `COUNTERX-ARCHITECTURE.md` is a 2026-08-29 snapshot and self-flags its
Auth0/console sections as now false. `.kiro/specs/**/tasks.md` is stale for completion status
by its own admission and `CLAUDE.md`'s hierarchy. `.agents/tasks/**` is the live tracker.

---

## 5. Things that are true and easy to lose

**Auth0's tenant configuration is invisible to git.** Four of Phase 1's fixes exist only in
the live tenant: the Post-Login Action source computing assurance from
`event.authentication.methods` and explicitly calling `challengeWithAny()` /
`enrollWithAny([{type:"otp"}])`; the fact that `enrollWithAny` must list `otp` only, because
`"email"` is not a valid Auth0 factor type; the tenant toggle **Security → Multi-factor Auth
→ Additional Settings → "Customize MFA Factors using Actions"** which must be ON or
everything else silently fails; and a deliberate tenant MFA policy of **"Never"**, because
MFA is meant to fire for specific high-value actions, not every login. Action
`b61c2ea0-054f-45f7-81a4-c99a12b2eba0`, tenant `dev-jzw3etjxnn3svs56`, version 4.

There is no committed source of truth beyond `HANDOFF.md` §3. Reproducing this in a second
environment means redoing it by hand.

**The step-up token bug will resurface.** `@auth0/nextjs-auth0@4.27.0`'s
`mfa.challengeWithPopup()` *appends* the elevated token to `session.accessTokens[]` and
deliberately leaves `session.tokenSet` untouched. The read path short-circuits to
`tokenSet` whenever the requested audience and scope match the global ones — which they
always do here. So `getAccessToken()` returns the *stale login token* and passing an
explicit `audience` changes nothing. The fix is `apps/wallet-console/src/lib/step-up-token.ts`,
reading `session.accessTokens[]` directly. `step-up-token.test.ts` fails if anyone
simplifies it back.

`apps/onboarding` has **three bare `auth0.getAccessToken()` calls** that will hit this the
moment that app gets a step-up popup. Not broken today.

**Secrets sitting in plaintext local config, outside the repo.** A couple of local,
gitignored config files hold live-looking credentials on disk (an Auth0 service JWT and
a keystore passphrase in one; a Supabase access token and a GitHub PAT, for two disabled
servers, in another). None of this is a git leak — nothing here is tracked — but it's
worth knowing before sharing a screen or a config file, and worth rotating regardless.

**An orphan-agent wart.** `/api/agent-keys` succeeds before `/api/mandates` is attempted, so
a rejected mandate leaves a registered, active, wallet-owned agent behind. Four exist for the
founder's wallet from five attempts. Harmless, untidy.

**Vercel deploy rate limit** was exhausted around 2026-09-04 and should clear ~09-05. Phase 1
was verified on `localhost:3000` only and **has not been re-confirmed on the deployed domain.**

---

## 6. `finalplan.md` — assessment

### What it proposes

A buildathon-scoped detour, written mid-session 2026-09-04. Eight steps: revert Phase 2 to
restore the prepaid balance (Step 1); build a real self-serve Razorpay top-up flow, which has
never existed (Step 2); register a demo agent with a durable CLI-held key (Step 3); fund the
wallet for real through that new UI (Step 4); run one live agent purchase end to end (Step 5);
archive crypto without deleting it (Step 6); verify and merge as two separate PRs (Step 7);
and a six-beat demo runbook (Step 8).

The reasoning is sound on its own terms. The crypto rail is real but has a dry faucet blocking
live over-cap verification and an unresolved question about who signs on-chain transfers, and
it settles zero real value — same as Razorpay test mode. For a *Razorpay* buildathon, a live
agent purchase through Razorpay's own test checkout is a shorter path and uses the host's
product.

### Its factual claims — I checked the load-bearing ones, and they hold

This plan says of itself that every "confirmed" was checked against the repo, not assumed.
That's accurate:

| Claim | Result |
|---|---|
| `4f09f1b` is the Phase 2 commit, with the listed files | **Verified.** 21 files, 2085 deletions, matching the plan's list exactly |
| Nothing merged since touches any reverted file — revert applies clean | **Verified.** Only PR #45 and #46 landed after it, touching 9 files, **zero overlap** |
| `verifyClientReturn()` at `razorpay-provider.ts:243` | **Verified.** Exactly line 243 |
| `mandate-panel.tsx` + both recurring-mandate routes exist as the pattern to mirror | **Verified.** All three present |
| `scripts/issue-and-bind-prepaid-mandate.mjs` is gone | **Verified.** Absent (the revert restores it) |
| `wallet-balance-routes.ts` is gone | **Verified.** Absent |
| `packages/data/src/wallet-balance-store.ts` kept but unwired | **Verified.** Present |
| No self-serve top-up has ever existed | **Verified.** No topup page/route; `topUp()` appears only in the store, its tests, migration `0021`, and docs |
| `QUICK_ACTIONS` in `wallet-console/page.tsx` for the crypto card | **Verified.** Line 16 |

Steps 1–8 are executable as written. That is not the concern.

### The one thing in it that is actually wrong

**Step 2d's stated assumption does not survive contact with the permission catalog.** It says
to use plain `auth0.getAccessToken()` rather than the step-up helper, on the reasoning that
*"topping up your own wallet with your own money is not a mandate/authority action."* It
correctly flags this as needing confirmation against `packages/authorization/src/assurance.ts`
before shipping.

Confirmed, and the answer is no. Step 2a gates the route on `identity.scope.manage`. Verified
in `assurance.ts`: `identity.scope.manage` maps to `tenantMutationAssurances`, which is
`["multi_factor", "step_up", "service_authenticated"]`. **Plain `"session"` is excluded.**

So as written, Steps 2a and 2d contradict each other — the route demands step-up, the client
sends a session token, and the call gets a 403. This is exactly the failure mode that cost
PRs #40–#43. Two clean options: use `step-up-token.ts` for the top-up calls (one-line change,
matches `/api/mandates`), or gate the route on a permission whose assurance list includes
`session`. Do not loosen `tenantMutationAssurances` — `CLAUDE.md` names that exclusion a
deliberate invariant, and `assurance.ts`'s own comments explain why for each entry.

### The trade-off it names, and is right to name

Step 1 reverts today's own Phase 2 and brings back Counter holding a buyer balance — *the
exact thing* `PRD.md` §5/§14 forbids in twelve places, the thing the founder removed earlier
the same day, and now the thing §14.1 explicitly calls *"a retired experiment, not current
guidance."*

`finalplan.md` states this once, plainly, and asks that the paragraph not be deleted when the
plan is checked off. That instruction is correct and worth honoring. Three things I'd add:

1. **The revert also reverts the prose.** The plan flags this. Concretely: `PRD.md` §14.1,
   `PILOT.md`, `CONFORMANCE.md` §6.6/§12, `HANDOFF.md`, and
   `.kiro/specs/counter-agent-wallet/{requirements,design}.md` will all read as if Phase 2
   never happened, including the `CONFORMANCE.md` line about the crypto rail. After the
   revert, **`CONFORMANCE.md` will understate the crypto work and `PRD.md` will describe a
   balance the product docs forbid.** Cheap mitigation: say so in the PR body, since a later
   session reading `PRD.md` cold would have no way to tell which state is current.

2. **The restored debit branch is the one that was silently breaking purchases.** The revert
   puts the `walletBalanceStore` debit back *ahead of* the Razorpay branch — the plan says so
   explicitly, and for the demo that ordering is exactly what makes a wallet purchase draw from
   the balance. Just know that a wallet purchase reaching that branch with an *unfunded* wallet
   gets `INSUFFICIENT_BALANCE → declined` rather than falling through to Razorpay. Step 4
   funding the wallet before Step 5 is therefore not optional sequencing — it is the thing that
   keeps Step 5 from being declined.

3. **Step 2b's security note is the one line to get exactly right.** Credit the amount from
   Razorpay's verified `GET /v1/payments/:id` response, never from client input. The plan says
   this. It's the difference between a demo and a hole.

### Two smaller notes

**Step 5's fallback is the risky part.** If `apps/local-mcp` has no manual invocation path, the
plan suggests a one-off script mirroring `verify-real-transaction.mjs` but routing through
`write-tools.ts`. That's the right instinct — reuse the CTP intent-signing code rather than
rewrite it. Budget more time for this step than the others; it's the only one whose shape isn't
already known.

**The demo's best moment is Step 8.5, not 8.3.** Showing a purchase succeed is table stakes.
Showing the *second* purchase get declined **before any Shopify order exists** is the actual
product thesis — bounded authority, checked pre-effect — and it's backed by real, verified
machinery: the pre-effect ordering in the money seam, and the spend-ledger cap that PR #46
made genuinely enforceable 24 hours ago.

### What's left dangling

`finalplan.md` doesn't say what happens to the **uncommitted Solana money-seam wiring** on the
current branch. Step 6 covers PR #47 and the branches ("leave them exactly as they are"), but
the working-tree diff isn't a branch or a PR — it's 8 modified files that typecheck clean and
exist nowhere else. If Step 1 starts with `git checkout -b revert/... origin/main`, that work
needs committing to its own branch first or it rides along into unrelated PRs. **This is the
one thing I'd do before touching Step 1.**

---

## 7. What I did not verify

Stated plainly so nothing above reads as more than it is:

- **I did not run `pnpm verify`,** the test suite, or any build beyond the worker typecheck.
  The 2811-test figure is the last recorded result in `.agents`, not something I reproduced.
- **I booted nothing.** No service was started, no route was probed, no UI exercised. Given
  this repo's own documented history of static reads being wrong in both directions, treat
  every §4 claim about *behavior* as inherited from the docs, not confirmed by me. The
  file-existence, git-history, diff, and typecheck facts are mine.
- **I did not check deployed state** on Fly or Vercel, or whether the Vercel rate limit cleared.
- **I did not query the database.** The two `wallet-console-v1` mandates are `HANDOFF.md`'s
  claim, not my observation.
- **I did not run the revert.** "Applies cleanly" is inferred from verified zero file overlap
  between `4f09f1b` and everything merged after it — strong evidence, but not the same as
  having executed `git revert`.
- **I did not read every file in the repo.** I read all top-level docs, all four plans, the
  full PR list, 100 commits, `assurance.ts`, the uncommitted diff, the findings report, and
  targeted structure across `apps/`/`packages/`. I did not read the `.kiro` spec bodies
  (~180KB, and `CLAUDE.md` rates their status claims stale anyway) or `PILOT.md` in full.

---

## 8. If you read one section

Counter is a non-custodial agent-commerce control plane whose entire value is that an AI
agent can spend real money inside cryptographically bounded authority, with no silent
failures. The mandate model — signed ceiling, allowlist, expiry, checked before any external
effect — is real, works, and was reached by a real browser login for the first time today.
The custodial prepaid balance was always the deviation, and it was retired this morning.

`finalplan.md` is a deliberate, well-researched, correctly-labeled 24-hour detour that brings
that deviation back for a demo. Its facts check out. Fix the Step 2d assurance contradiction
before writing the client, commit the stranded Solana work before branching, and keep the
trade-off paragraph in the file. Then the crypto rail — which is where the product is
actually going, and which is byte-compatible with the mandate keys already in production —
is waiting in PR #47 and one uncommitted diff.
