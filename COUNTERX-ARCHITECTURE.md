# CounterX — Actual Architecture

**Status:** Living document reflecting the *verified, running* system, not the aspirational design.
**Basis:** Static source audit + runtime execution (build/test/boot/HTTP probes) against commit `0e7dc36` / `96d64b3` on `main`, on 2026-08-29. Every claim below was either read directly from source or observed by actually running the code — see §8 for the exact commands. Where documentation and code disagree, code wins and the disagreement is called out.
**Not covered here:** business/product rationale (see `PRD.md`), delivery sequencing (see `PLAN.md`), the full CTP object schema (see `TRUST-PROTOCOL.md`).

---

## 1. What CounterX actually is right now

A pnpm monorepo (10 apps, 25 packages, TypeScript ESM strict) implementing an India-first agent-commerce platform. The *designed* architecture is a canonical domain core → CTP trust protocol → bilateral policy engine → orthogonal transaction state machine → adapters at every boundary (Shopify, Razorpay, MCP) → evidence/reconciliation/receipts. The **deployed** system is a much narrower slice of that: one worker process that drives a real Shopify + Razorpay + CTP-test-signed checkout when invoked directly, sitting next to a thin HTTP layer that is mostly disconnected from it. Roughly 30,000 lines of tested application logic (policy engine, evidence/receipts, full CTP checkout orchestrator, observability, wallet application) are built and imported nowhere that runs in production.

```
┌─ Vercel (4 Next 16 apps) ─────────────────────────────────────┐
│ landing │ merchant-console (1 live page) │ wallet-console      │
│         │                                 (mock data) │        │
│         │                     operations-console (empty stubs) │
└──────────────────────┬──────────────────────────────────────────┘
                       │ HTTPS + Bearer   (Auth0 = STUBBED on every console)
┌──────────────────────▼──────────────────────────────────────────┐
│ Fly.io "sin"                                                     │
│  control-plane-api  /control/v1/{status,merchants,merchants/:id/ │
│                      policy, transactions}  — starts fine        │
│  agent-runtime       /runtime/v1/merchants/:id/*  MOCK handlers  │
│                      only — CANNOT start with NODE_ENV=production│
│  worker              job loop + real-lifecycle money seam —      │
│                      Fly's configured process command is WRONG   │
└──────────────────────┬──────────────────────────────────────────┘
                       │ pg (no RLS on these tables)
┌──────────────────────▼──────────────────────────────────────────┐
│ Supabase Postgres — schemas: platform, identity, merchant,        │
│ wallet, runtime.  Migrations 0001–0009, forward+rollback tested.  │
└────────────────────────────────────────────────────────────────────┘
     external: Shopify Admin GraphQL 2025-07 · Razorpay v1 (test mode)
```

**The single most important structural fact:** there are two parallel checkout implementations. `packages/payment-sdk/CheckoutOrchestrator` is the full CTP-conformant path (mandate/intent verification → policy engine → draft → pay → revalidation gate → finalize → reconcile → signed receipt). It is loaded into the worker's module graph (via `payment-sdk`'s barrel export) but **never constructed or invoked**. The path that actually runs is `apps/worker/src/real-lifecycle.ts`, a leaner reimplementation that skips CTP signature verification, the bilateral policy engine, and signed-receipt issuance in favor of inline checks and a plain outbox JSON row.

---

## 2. Repository / package map

### Deployed backend apps

| App | Real? | Verified state |
|---|---|---|
| `apps/worker` (7.3k LOC) | **Yes — the only real money path** | Job-loop + `real-lifecycle.ts` (Shopify + Razorpay + CTP-signed test provider). Starts and runs correctly via `main.js`. |
| `apps/control-plane-api` (2.5k) | Partial | Starts fine under `NODE_ENV=production`; 2 of 4 route groups are real, one is an explicit placeholder. |
| `apps/agent-runtime` (2.5k) | **No — mock handlers only** | 10 routes, all served by `createMockHandlers()`. **Throws synchronously at boot under `NODE_ENV=production`** (verified — see §5). |

### Frontends (all Next.js 16.3.3 / React 19.1.0 — drifted from the `engineering-baseline.yaml` pin of Next 15.1.6/React 19.0.0, no ADR on file)

| App | Verified state |
|---|---|
| `apps/merchant-console` | 14 pages; only `/transactions` calls the API. The other 13 render hardcoded `DEMO_*` arrays. Auth0 is a stub (see §5) so even the one live page cannot obtain a token in practice. |
| `apps/wallet-console` | 100% `MockWalletClient`, pre-seeded with one wallet (`wlt-pilot-001`). |
| `apps/operations-console` | 100% stubs returning `Promise.resolve([])`. Auth middleware accepts **any non-empty session cookie/header** — verified as a live bypass (§5). |
| `apps/landing` | Static marketing, builds cleanly, not relevant to the transaction path. |

### Other apps

- `apps/local-mcp` — MCP tool server (stdio, `@modelcontextprotocol/sdk` 1.30.0). Real hard denylist (13 patterns: `key.export`, `policy.mutate`, `settlement.assert`, `payment-secret.*`, …) with reflection tests proving no registered tool matches a denied pattern. Read tools return hardcoded literals; write tools (`purchase.propose`/`purchase.execute`/`purchase.cancel`/`purchase.refund-request`) genuinely wire `PolicyPrecheckService` / `PurchaseIntentBuilder` / `MerchantRuntimeClient`. **No CLI/bin entrypoint exists** — `startServer()` is exported but nothing invokes it, so an agent (e.g. Claude Desktop) cannot launch this today.
- `apps/reference-buyer` — 17-scenario CTP conformance corpus (`SCENARIO-001..017`, covering happy paths, denial paths, retry/uncertainty paths, verification paths per `PILOT.md`) driven by a `ScenarioDriver` against port interfaces. Runs only against mocks in tests; never executed against the real deployed stack.
- `apps/reference-services` — local REST fixture server backing `packages/reference-connector`'s certification harness.

### Packages — wired vs. orphaned (see §5 for the exact reachability check)

**Wired into a deployed app:** `domain`, `data`, `workflow`, `http-api-kit`, `authorization` (permission catalog + actor context only), `connector-sdk`, `shopify-connector`, `razorpay-adapter`, `payment-sdk` (partially — see below), `trust-protocol`, `ui`, `config`.

**Built, tested, imported by zero running process:** `policy` (full bilateral engine + intersection reducer, 2.6k LOC), `merchant-policy`, `merchant-application` (activation/readiness/capability-manifest, 6.0k LOC), `evidence` (receipt issuance/verification/reconciliation/compensation, 6.7k LOC), `observability` (full OTel SDK, metrics, redaction, alerts — 3.2k LOC, 152 tests), `commerce-graph`, `contracts` (the canonical `Command` union is imported nowhere), `wallet-application`/`wallet-domain`/`wallet-contracts` (17k LOC, reachable only from `local-mcp`, which itself has no entrypoint), `testkit`.

---

## 3. Critical transaction lifecycle

`packages/workflow` implements the PRD's orchestration model correctly: one `Phase` (12 states: `DRAFT → QUOTED → CHECKOUT_READY/REVIEW_REQUIRED → COMMITTING → ACTIVE/CLOSED`, plus `INDETERMINATE/DECLINED/EXPIRED/CANCELED/FAILED_REQUIRES_ACTION`) plus five **orthogonal** sub-states — reservation, payment, order, fulfillment, return — each with its own explicit transition table and optimistic-concurrency `expectedVersion`. `INDETERMINATE` is a first-class state throughout, not a fallback.

### The real path (`apps/worker/src/transaction-lifecycle.ts` → `real-lifecycle.ts`)

```
createTransactionLifecycleHandler(provider, sink).execute(job, now)
  1. parsePayload → deriveTransactionId (hash of payload.transactionId → CounterId)
  2. state machine DRAFT → QUOTED → CHECKOUT_READY → (payment: authorizing) → COMMITTING
  3. provider.authorizeAndCapture(request)        [real-lifecycle.ts]
       a. killSwitch.blocked()        → runtime.kill_switches            (pre-effect gate)
       b. policy.allow()              → createProductionPolicy           (pre-effect gate)
                                          → PostgresSpendLedger.reserveSpend (atomic, FOR UPDATE)
       c. resolveVariant()
       d. stepLedger.claim(key,'shopify.draft')   ← atomic cross-instance pre-claim
       e. Shopify draftOrderCreate    → record 'shopify.draft'
       f. Razorpay POST /v1/orders    (X-Razorpay-Idempotency header)
       g. CounterTestPaymentProvider authorize+capture → CTP-signed envelope
       h. Shopify orderFinalize       → record 'shopify.finalize'
       i. Shopify paymentRecord (mark-paid, ≤5 retries on Shopify's eventual consistency)
       j. Shopify orderQuery          ← authoritative evidence, source of truth
  4. reconcile capturedMinor vs payload.amountMinor
  5. sink.record(receipt) → runtime.outbox_events 'transaction.receipt.v1'  (plain JSON, not CTP-signed)
```

**Idempotency is layered and genuinely proven, not just claimed:**
- In-process `outcomeCache` (same transaction retried within one live port instance → same result, zero re-effect)
- Durable `runtime.lifecycle_steps` ledger keyed `(environment, idempotency_key, step)`, with an atomic pre-claim (`.claim` rows under the same unique index) that closes the cross-instance race on Shopify's `draftOrderCreate`, which has **no native idempotency key**
- Provider-native idempotency (Razorpay `X-Razorpay-Idempotency` header)
- Proven by execution, not just unit tests: an integration test counts **actual Shopify API invocations** across two racing worker instances sharing one ledger and asserts exactly one draft is created; a separate crash-simulation test kills the process between draft and finalize and asserts restart resumes from the ledger rather than re-drafting.

**Explicit-uncertainty is real:** provider outcomes are never collapsed to try/catch→failed. An `indeterminate` outcome propagates as `INDETERMINATE`, and — critically — indeterminate steps are **never written to the step ledger**, so a later attempt or the reconciliation scanner can re-drive them to resolve the unknown state, rather than the ledger permanently locking in an unresolved effect.

**Known weakness, verified in source (not yet exercised against a live DB in this session):** the transaction state machine is rebuilt from `DRAFT` on every handler invocation — state is a local variable, never persisted. A retryable failure *after* capture (e.g. `reconciliation.mismatch`) re-invokes `authorizeAndCapture` for the same transaction; correctness rests entirely on the idempotency layers above holding, which the code's own doc comments say explicitly: *"Resume-from-persisted-state is deferred to the live-connector milestone."*

### What starts a transaction lifecycle job — **verified absent**

`grep`ing the **compiled production `dist/`** (which by construction excludes test files) across all three deployed entrypoints for `.enqueue(` calls and `INSERT INTO runtime.jobs` finds **zero callers**. Nothing in shipped code ever calls `PostgresJobRepository.enqueue`. The only place a `transaction.lifecycle` job is ever created is inside `apps/worker/src/worker.integration.test.ts` and the manual `scripts/verify-real-transaction.mjs` script. **There is no path today from any external actor — an agent, an HTTP request, an MCP tool call — to a transaction actually starting.**

---

## 4. Agent-commerce lifecycle

`TRUST-PROTOCOL.md` §16 specifies a 13-step pre-commit verification sequence. Checked against the deployed worker:

| Step | Implemented somewhere | Wired into the running worker |
|---|---|---|
| 1. Authenticate agent/interface | Auth0 JWT + JWKS (`http-api-kit`) | ✔ on the API layer; **✘ stubbed on every console** |
| 2. Resolve AgentRegistry + key | `CounterTestAgentRegistry` | ✘ |
| 3. Verify mandate | `CtpAuthorityVerifier` | ✘ |
| 4. Verify merchant capability manifest | `capability-manifest.ts` | ✘ — `HttpMerchantRuntimeClient` only checks the `signature` field is **non-empty**, no cryptographic verification |
| 5. Verify quote signature/digest/freshness | `quote-verification.ts` | ✘ |
| 6. Verify bound intent + approval | `PurchaseIntentBuilder`, `approval-inbox` | ✘ |
| 7. Revocation check | `revocation-service` | Partial — worker checks `authority.revokedAtMs` only if the caller supplies it in the job payload |
| 8. Atomic cumulative limit reserve | `PostgresSpendLedger.reserveSpend` | **✔ — fully wired, the one CTP step genuinely enforced end-to-end** |
| 9. Bilateral policy intersection | full engine in `packages/policy` | ✘ — worker uses 6 hand-rolled predicates in `apps/worker/src/lifecycle-policy.ts` instead |
| 10. Persist decision + durable intent | — | ✘ (see §3, "nothing writes `workflow_intents`" below) |
| 11. Typed payment/merchant actions | — | ✔ |
| 12. Resolve against authoritative sources | `orderQuery` | ✔ |
| 13. Reconcile + receipt | `evidence` package (full CTP-signed receipts) | Partial — reconciliation scanner ✔ (off by default); signed-receipt issuance ✘, only a plain JSON outbox row |

The `authority` envelope carried on the job payload (`quotedAmountMinor`, `authorizationExpiresAtMs`, `mandateExpiresAtMs`, `revokedAtMs`, `authorizedMerchantId`, `walletId`) is the seam meant to thread CTP authority into the worker. **Every field is optional and silently skips its predicate when absent.** A payload with no `authority` object passes the quote-tamper, revocation, mandate-expiry, authorization-expiry, and merchant-scope gates unconditionally — only the per-transaction amount ceiling always applies (enforced independently by `PostgresSpendLedger`). Since §3 established nothing enqueues jobs today, this gap is currently unreachable, but it is load-bearing the moment §3's missing enqueue path is built.

MCP: `apps/local-mcp` enforces a genuine denylist against key export/rotation, policy mutation, approval self-bypass, recovery initiation, and settlement assertion — this boundary is real and tested. It has no launchable entrypoint today.

---

## 5. Architectural / security invariants — verified, not assumed

Every item below was executed this session (build, boot, HTTP probe, or targeted script), not merely read.

**Holds:**
- **Deny-by-default authorization.** Live probe against `control-plane-api` with locally-minted JWTs: unregistered routes → 403; missing token → 401; wrong tenant scope → 403 (and a nonexistent transaction ID returns 404, not 403 — existence isn't disclosed to the wrong tenant); operator with `platform` scope but no `platform.operator` role → 403.
- **Dependency boundaries hold**, verified against all five `dependency-cruiser` rules by direct grep substitute and later by running the actual tool: 0 violations across 1848 modules / 4202 dependencies. No package imports an app; `domain` has zero framework/infra imports; merchant packages never import wallet packages or vice versa; merchant packages never import `pg`/`drizzle`/`@counter/data` directly.
- **Secret redaction is real.** `redactAuthorization()` scrubs the Razorpay Basic-auth header; a secret-leakage integration test scans logs, the returned result, and durable DB rows for literal env-secret values and `shpat_`/`rzp_test_` patterns, with a positive control proving the scanner itself isn't silently broken.
- **CTP envelope verification correctly rejects** algorithm downgrade, wrong issuer/audience/environment, and unknown critical extensions (all covered by dedicated unit tests, re-confirmed passing under the pinned Node runtime this session).

**Broken — verified by execution, not inference:**
- **Auth0 is a stub on every console.** `merchant-console`: `GET /api/auth/me` returns `{"message":"Auth0 handler - configure AUTH0_SECRET to enable"}` (200, no token); `GET /transactions` served 200 with 28KB of page content to a request carrying **no session at all**.
- **`operations-console`'s middleware is a live bypass.** `curl -H "Cookie: counter_operator_session=x" .../fleet` → **HTTP 200**, full Fleet Health page. Any non-empty cookie or `x-operator-session` header value passes; the middleware never validates the value.
- **The deployed worker signs payment evidence with the repo's committed public test key.** `boot.ts` calls `createTestSignerA()`, whose 32-byte seed is hardcoded in `packages/trust-protocol/src/fixtures.ts` and re-exported from that package's public `index.ts` (so it ships in every service's `dist/`). Verified by construction: built and signed a forged `counter.evidence.v1` envelope claiming `"status":"confirmed"` for a fabricated payment reference, using exactly the production code path (`buildUnsignedEnvelope` → `signEnvelope(createTestSignerA())`), and the project's own `verifyEnvelope()` **accepted it as authentic**.
- **No RLS on any `runtime.*` table or `merchant.policy_configs`.** The `identity.*` schema has a genuinely strong RLS layer (12 tables, ~24 policies, session-claim functions, a 1266-line isolation test suite) — but `ScopedTransactionManager`/`PostgresIdentityRepositories`, the only things that establish those session claims, are **instantiated by zero application code**. The tables that hold live transaction/policy data have no RLS at all; isolation there rests entirely on `verifyTenantAccess()` in two route files.
- **`deriveTransactionId` (worker → typed `CounterId`) uses a per-slot sum mod 256 to fold an arbitrary-length string into 16 bytes.** Refuting an earlier overstatement of this: 200,000 realistic keys of the form `txn-<base36>` produced zero accidental collisions — position matters (`i % 16`), so casual permutations don't collide. But a caller who controls `payload.transactionId` can cheaply construct one (verified: `derive("A") === derive(""+15×NUL+"@")`). Low practical severity today (nothing reaches this path — see §3), but load-bearing the moment the enqueue path exists.

---

## 6. Wired vs. unwired — summary table

| Component | Built | Wired into a running service |
|---|---|---|
| Shopify connector (7 typed actions, SSRF guard, retry, throttle) | ✔ | ✔ worker only |
| Razorpay real HTTP client (Basic auth, idempotency header, timeout→indeterminate) | ✔ | ✔ worker only — order creation only; webhooks/refunds not wired |
| Durable step ledger + cross-instance draft pre-claim | ✔ | ✔ |
| Durable atomic spend ledger (rolling 24h) | ✔ | ✔ (see caveat below) |
| Durable kill switches (platform/merchant/connector/payment_adapter) | ✔ | ✔ — checked before every external effect |
| Reconciliation scanner (INDETERMINATE → authoritative resolution) | ✔ | Built correctly, **off by default** (`RECONCILIATION_ENABLED` unset) |
| `CheckoutOrchestrator` (full CTP checkout) | ✔ | Loaded into worker's module graph, **never constructed** |
| Bilateral policy engine (`packages/policy`) | ✔ | ✘ — worker uses 6 ad-hoc predicates instead |
| Signed CTP receipts (`packages/evidence`) | ✔ | ✘ — worker writes a plain JSON outbox row |
| OpenTelemetry / `@counter/observability` | ✔ (152 tests) | ✘ imported by nothing |
| Job enqueue → `runtime.jobs` | ✔ (repository layer) | ✘ nothing shipped calls it |
| `runtime.workflow_intents` writer (console's read-model spine) | — | ✘ nothing shipped writes it (fix exists unmerged, see §7) |
| Webhook ingress (Shopify/Razorpay signature verifiers exist) | ✔ (verifiers) | ✘ — adapter map registered empty; live probe: `POST /webhooks/v1/shopify` → 404, `.../razorpay` → 404 `Unknown webhook adapter` |
| Outbox dispatcher | — | ✘ — `append()` is called (worker, reconciliation); `claim`/`markDispatched`/`markDeadLetter` have zero callers in `dist/` |
| MCP server | ✔ (denylist + write tools) | ✘ no launchable entrypoint |
| Auth0 (server side) | ✔ | ✔ API only; ✘ all 3 consoles |

---

## 7. Known blockers, in the order they actually block each other

1. **`fly.worker.toml` runs the wrong file.** `[processes] worker = "node apps/worker/dist/index.js"` — `index.js` is a side-effect-free barrel export; importing it and waiting confirms nothing is scheduled and the process would exit. The correct entrypoint is `main.js`, which starts the poll/lease/execute loop (verified: with the deployment's exact env vars, `main.js` logs `worker loop started` and stays alive; `index.js` logs nothing and exits 0 immediately). **The deployed worker has, as configured, never processed a job.**
2. **`apps/agent-runtime` cannot start under `NODE_ENV=production`.** `resolveMerchantHandlers` throws synchronously at module scope inside `createServer()` because only mock handlers exist and mocks are gated to non-production environments — verified by running the exact deployment command; the process dies before binding a port.
3. **No enqueue path exists** (§3) — even with #1 and #2 fixed, nothing creates a `transaction.lifecycle` job outside a test file.
4. **Every `runtime.*` repository hardcodes `environment = 'local'`** in its SQL (`PostgresStepLedger`, `PostgresSpendLedger`, `PostgresKillSwitchStore`, `PostgresIdempotencyStore` — verified by instrumenting each against a query-recording stub and reading the emitted SQL text directly), while `control-plane-api`'s read model binds `environment = NODE_ENV` (typically `"production"`). **The reader queries a partition the writers never write to.**
5. **The worker's derived pilot-merchant id doesn't match the console's default.** `pilotMerchantId()` in `boot.ts` → `ctr_merchant_BwcHBwcHBwcHBwcHBwcHBw`; `merchant-console`'s `NEXT_PUBLIC_MERCHANT_ID` default → `merchant-pilot-001`. A third, independent reason the Transactions page would stay empty even after #3 and #4 are fixed.
6. **`origin/feat/persist-transaction-read-model`** (5 commits, based on the current `main`, merges cleanly) adds a `PostgresTransactionProjectionStore` that writes `runtime.workflow_intents` before the provider call and closes gap #4 via a `COUNTER_RUNTIME_ENV` env var — but ships no tests, is wired only in real-connector mode (so it can't be exercised without live credentials), and only calls its `fail()` transition on the *declined* branch — the `indeterminate` and `reconciliation.mismatch` branches leave the intent stuck at `executing` forever. It does not fix #5.
7. **Webhooks (§6) and the outbox dispatcher (§6)** are the next tier — real verifiers exist, nothing routes to them.
8. **The rolling-spend ledger has an unverified phantom-read risk** on a wallet's *empty* window: `reserveSpend`'s `FOR UPDATE` only locks existing rows, so under `READ COMMITTED` two concurrent first-ever reservations for the same wallet could both observe zero rows and both insert. **Not verified this session** — no local Postgres was available (Docker absent from the sandbox).
9. **No lease renewal.** `renewLease` exists with zero callers (verified: grep across all of `dist/`). Lease duration is 30s, `batchSize` is 10, and worst-case per-job wall time (draft/finalize/markPaid with 5×1.5s retries plus 15s action timeouts) can exceed 160s — a job could plausibly be re-claimed by a second worker while the first is still executing it.

---

## 8. Source-of-truth hierarchy

| Layer | Authority | Trustworthiness (this session) |
|---|---|---|
| `PRD.md`, `PLAN.md`, `TRUST-PROTOCOL.md`, `CONFORMANCE.md`, `PILOT.md` | **Canonical.** Explicitly states "documentation is not implementation evidence"; every capability defaults to `Planned` unless evidence says otherwise. | High — deliberately under-claims, verified consistent with what's actually built (as design intent, not as deployed state). |
| `.kiro/specs/*/tasks.md` | Named authoritative in `PRD.md` §22 | **Stale.** Foundation shows 4/20 checked; merchant/wallet specs show 0/21 and 0/20 checked despite substantial shipped work. Abandoned in favor of `.agents/tasks/`. |
| `.agents/tasks/**` | De facto live tracker | Reflects actual recent work (task findings, review dispositions) more accurately than `.kiro/`. |
| `HANDOFF.md` | Operational handoff notes | **Several claims refuted by direct execution this session** (see below) — treat as a starting hypothesis, not ground truth, without re-verifying. |
| `engineering-baseline.yaml` | Pinned toolchain versions, requires an ADR to change | Drifted silently: Next 16.3.3 vs pinned 15.1.6, React 19.1.0 vs 19.0.0, no superseding ADR on file. |
| Code (`apps/`, `packages/`) | Ground truth for *what runs* | Authoritative once actually executed — static reading alone was repeatedly wrong in both directions during this session's own two-phase audit (see below). |

**Specific HANDOFF.md claims refuted or corrected by running the code this session:**
- *"worker records transactions IN MEMORY"* — receipts do persist (to `runtime.outbox_events`); the actual gap is narrower: nothing writes `runtime.workflow_intents`.
- *"worker deployed running `node apps/worker/dist/index.js`"* — that file is a no-op barrel; the real entrypoint is `main.js` (§7.1).
- *"agent-runtime boots past module load"* — it throws synchronously under `NODE_ENV=production` (§7.2).
- *"Transactions page shows an EMPTY list"* — it shows an **auth error**; the stub Auth0 handler never returns a token, so the fetch never reaches the API at all.
- *"NO open PRs at handoff"* — `origin/feat/persist-transaction-read-model` (5 commits) exists, based on the handoff commit itself, addressing exactly the gap HANDOFF calls the top priority.

**Rule for future sessions:** a static read of this repo is not suffient evidence for either "it works" or "it's broken" claims about wiring, boot behavior, or environment interaction — this session's own first pass got the `CheckoutOrchestrator` reachability claim and the `deriveTransactionId` collision claim wrong from static reading alone, and both were corrected only by executing code. Prefer running over reading wherever the two could plausibly disagree.

---

## 9. Commands used to verify this repository

All run from the repo root. `pnpm-lock.yaml` and `package.json` pin `pnpm@9.15.4`; `engineering-baseline.yaml`/CI pin `node@22.14.0` exactly — this sandbox's default Node was 24.18.0, which crashes `dependency-cruiser@16.10.0` (`node:fs` no longer exports `R_OK` under Node 24's stricter ESM loader) and was worked around by prepending a portable Node 22.14.0 binary to `PATH` for the affected commands only, never by touching pinned config.

```bash
# Install (verifies the lockfile is in sync with package.json)
pnpm install --frozen-lockfile

# Full verification chain (what `pnpm verify` runs, in order)
pnpm format:check      # prettier --check .
pnpm lint               # eslint .
pnpm build               # pnpm -r --if-present run build  (tsc -b per package, topological via project references)
pnpm typecheck           # pnpm -r --if-present run typecheck
pnpm depcruise            # depcruise --config .dependency-cruiser.cjs apps packages  — needs Node 22.14.0
pnpm test                 # pnpm -r --if-present run test  (vitest run per package)
pnpm verify                # the six above, chained

# Clean-state build (avoids a latent build-order race that a warm build can mask)
find apps packages -name '*.tsbuildinfo' -delete
rm -rf apps/*/dist packages/*/dist

# Runtime verification beyond the npm scripts (this session's method, not a repo script):
# 1. Boot each service's compiled dist/main.js directly under the exact env vars
#    its Fly config supplies, and observe stdout/exit code.
# 2. Probe running HTTP servers with curl / server.inject() using a locally-minted
#    RS256 JWT (via `jose`) against the server's injectable JWKS — no Auth0 contact
#    needed to test auth/tenancy logic in isolation.
# 3. Compute real import-reachability from a compiled entrypoint by walking its
#    `dist/` module graph, then separately grep for `new <Symbol>(` across all of
#    `dist/` to distinguish "loaded" from "instantiated".
# 4. Instantiate a repository class (e.g. PostgresStepLedger) against a
#    query-recording stub implementing the DatabaseSession interface, and read
#    back the exact SQL text it emits — no real database required to prove what
#    environment value a query binds.
# 5. `pnpm verify:real` — the repo's own on-demand real-transaction script;
#    SKIPS cleanly (exit 0) with no Shopify/Razorpay credentials present, which
#    was itself verified as the correct safety behavior.

# On-demand real E2E transaction against LIVE Shopify + Razorpay test-mode
# (never run this session — no credentials available; documented for completeness)
pnpm verify:real
```

**Not verified this session, and why:** the DB-gated integration suites (RLS isolation, tenant isolation, spend-ledger phantom-read, migrations up/down) require a local Postgres — Docker is not installed in this sandbox. The 8 creds-gated worker integration suites (concurrency, kill-switch, revocation-midflight, secret-leakage, adversarial policy, reconciliation, real-lifecycle, step-ledger-crash) require live Shopify + Razorpay test credentials, which were not available and would be out of scope to use without explicit authorization. Both suite families are skipped by design (`describe.skip`) when their prerequisites are absent, and both are confirmed to run in CI's Postgres-service job **except** the 8 creds-gated ones, which run nowhere automatically — they are the repository's strongest evidence and currently require a human to run them locally.
