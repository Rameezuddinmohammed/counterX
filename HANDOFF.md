# Counter — Session Handoff Document

> **Purpose:** Hand off the full working context of the Counter build to a fresh assistant session so no context is lost and nothing is hallucinated. Self-contained. Secrets/API keys are **NOT** in this file (never commit them) — they are provided separately in chat. Where a secret is needed, this doc names it and points to the chat handoff.

---

## 0. What Counter is

**Counter** is an India-first **agent-commerce platform**: AI agents buy from merchants under **bounded authority** (spend limits, scopes, kill switches). Brand: name "Counter", domain **getcounter.in**, tagline "The commerce layer for AI agents", bold-orange + Linear-style UI + Stripe-quality docs.

**Product bar (user's north star, quote):** *"I need a real product not an impressive demo"* — bias toward: **real execution -> durable effects -> adversarial tests -> external truth -> reconciliation -> evidence.** "Iron tight." User wants layman explanations often and is cost-conscious.

---

## 1. Current status (at handoff)

### Shipped & merged to `main`
- Foundation (20 tasks), Counter Merchant (21 tasks), Counter Agent Wallet (20 tasks).
- Full UI overhaul: shared `@counter/ui` package (shadcn/ui: Radix + CVA + tailwind-merge + cmdk + sonner + next-themes + lucide + framer-motion), landing page, 3 consoles.
- **PR #7** — durable cross-instance **atomic rolling-spend ledger** (migration 0009 `runtime.spend_ledger`; `PostgresSpendLedger.reserveSpend` = atomic check-and-reserve in one txn with `FOR UPDATE`). Proven vs real Supabase.
- **PR #8** — Merchant Console **Transactions page wired to a real read-model** (endpoints `GET /control/v1/merchants/:merchantId/transactions`, `GET /control/v1/transactions/:transactionId`; projects `Transaction` from `runtime.workflow_intents` + `runtime.lifecycle_steps` + `runtime.spend_ledger`; server-side tenant isolation).
- **PR #9** — **Docker OOM fix**: backend image builds only the target app, not the 4 Next consoles.
- **PR #10** — **Monorepo topological build fix**: all tsc-built packages converted to **TypeScript project references** (`references` arrays + per-package `tsconfig.build.json` excluding tests; `build` = `tsc -b tsconfig.build.json`). Fixes clean-state build races. Dockerfile uses a **name-based** pnpm filter derived from `BUILD_TARGET`.
- **PR #11** — **pg ESM crash fix**: `import { DatabaseError } from "pg"` (named value import from a CommonJS module) crashed under native Node ESM; changed to `import pg from "pg"; const { DatabaseError } = pg;`.
- **PR #12 + #13** — **Codebase sanity sweep** (lint 963->~9 by ignoring `apps/landing/out/` static-export in eslint; real fixes: data-table `[object Object]` bug, empty-interface types, merchant-console typed table cells).

**All merged. NO open PRs at handoff.** `main` HEAD ~= `e2be632` (Merge PR #13).

### Deployed & live
- **Supabase Postgres** (region ap-southeast-1, project ref `enreujnhmydptyasxlvm`): migrations **0001-0009 applied**.
- **3 Fly.io backend apps** (region `sin`), all **deployed & confirmed healthy** after the fixes:
  - `counter-control-plane-api` — `/control/v1/status` returns `{"error":{"code":"UNAUTHENTICATED"}}` (HEALTHY: up + auth-guarded).
  - `counter-agent-runtime` — boots past module load (no longer crash-looping).
  - `counter-worker` — deployed (process group `worker`, runs `node apps/worker/dist/index.js`).
- **4 Vercel projects** (Hobby/free): `merchant-console-bay`, `wallet-console`, `operations-console-two`, `landing`. Deployed by the USER (Vercel Hobby blocks bot commits).

### Verified baseline (CLEAN build)
`pnpm build` green; `pnpm test` **2,811 passing** (+ ~25 DB-gated integration tests skip without creds); `pnpm depcruise` 0 violations; `pnpm lint` ~9 residual real-source items (in findings report; not blocking).

---

## 2. THE SINGLE MOST IMPORTANT NEXT STEP — "Slice 2"

**The Transactions page is wired correctly but shows an EMPTY list, because the worker records transactions IN MEMORY and never persists them to the DB.** All `runtime.*` transaction tables are currently **0 rows**.

**Slice 2 = make the worker persist real transactions to Postgres** (`runtime.workflow_intents` + `runtime.lifecycle_steps` + `runtime.spend_ledger`) as a transaction executes, idempotently + crash-safely (consistent with the existing durable machinery). After Slice 2, a real Shopify/Razorpay transaction will **appear live in the merchant console** — the moment Counter becomes a visible product. **Planner-led.**

---

## 3. Roadmap after Slice 2 (told to user)
1. **Slice 2** — worker persists transactions to `runtime.*`.
2. Fan out remaining merchant-console pages (audit, findings, policy, killswitch) to real data (reuse read-model pattern).
3. Wire **wallet-console** and **operations-console** to real data.
4. Connect a **real AI agent E2E** (Claude Desktop MCP -> agent-runtime).
5. **Razorpay human-present** browser handoff (Standard Checkout returns `action_required`; unattended path uses deterministic `CounterTestPaymentProvider` but ALSO creates a real Razorpay order to prove integration).
6. First real **pilot**.

---

## 4. Architecture / repo map

Monorepo `~/counterX` (pnpm 9.15.4 workspaces, 36 projects, TypeScript ESM strict, Node pinned **22.14.0**).

- **Backend apps (Fly.io/Docker):** `apps/control-plane-api`, `apps/agent-runtime`, `apps/worker`.
- **Frontend apps (Vercel, Next.js 16 / React 19):** `apps/merchant-console`, `apps/wallet-console`, `apps/operations-console`, `apps/landing`.
- **Other apps:** `apps/local-mcp` (MCP stdio), `apps/reference-buyer`, `apps/reference-services`.
- **Key packages:** `domain` (leaf, no infra), `data` (Postgres repos: `PostgresSpendLedger`, `PostgresStepLedger`, `PostgresKillSwitchStore`, `PostgresJobRepository`, `PostgresOutboxRepository`, identity repos), `payment-sdk`, `shopify-connector`, `razorpay-adapter`, `trust-protocol`, `workflow`, `authorization`, `http-api-kit` (`getActorContext`, `registerRoutePermission`), `ui` (shadcn), `contracts`/`merchant-contracts`/`wallet-contracts`, `evidence`, `observability`, `testkit`.

**Deployment stack decision:** Supabase (Postgres) + Fly.io (APIs/worker) + Vercel (consoles) + Grafana Cloud (telemetry) + Auth0 (identity). Rejected AWS (cost/ops), Railway/Render (paid). Fly ~$1-5/mo with auto-stop.

---

## 5. Build / test / deploy mechanics (READ before touching anything)

### Node setup — REQUIRED at start of EVERY bash command
```
source ~/.nvm/nvm.sh && nvm use 22
```
Repo pins 22.14.0; sandbox has 22.23.x; `engines` = `>=22.14.0`.

### Build system = TypeScript project references
- Each tsc-built package/app has a `references` array in `tsconfig.json` + a sibling `tsconfig.build.json` (distinct `tsBuildInfoFile`, **excludes** `**/*.test.ts` and `**/*.integration.test.ts`, references deps' build variants).
- Per-package `build` = `tsc -b tsconfig.build.json`. Root `pnpm build` = `pnpm -r --if-present run build`.
- **Always verify from a CLEAN state** (repo had a latent build-order race only clean builds expose):
  ```
  find apps packages -name '*.tsbuildinfo' -delete; rm -rf apps/*/dist packages/*/dist
  ```
  (The broad `find . -path ./node_modules -prune -o -name '*.tsbuildinfo' -delete` form has MISFIRED in the sandbox — prefer explicit `find apps packages ...`.)

### Dockerfile (shared by all 3 Fly apps)
- Builds ONLY the target app + its workspace dep closure via a **name filter** derived from `BUILD_TARGET` (a path like `apps/worker`):
  `RUN pnpm --filter "$(node -p "require('./${BUILD_TARGET}/package.json').name")..." run build`
- Consoles are NEVER built in the backend image. Do not reintroduce full `pnpm build`.

### Fly deploy (user runs locally on Windows PowerShell)
```
cd $HOME\counter\counterX; git checkout main; git pull origin main
& "$HOME\.fly\bin\flyctl.exe" deploy --config fly.control-plane-api.toml --remote-only
& "$HOME\.fly\bin\flyctl.exe" deploy --config fly.agent-runtime.toml --remote-only
& "$HOME\.fly\bin\flyctl.exe" deploy --config fly.worker.toml --remote-only
& "$HOME\.fly\bin\flyctl.exe" scale count worker=1
```
Fly apps: `auto_stop_machines=true`, `min_machines_running=0` -> **scale to zero when idle (STATE: stopped is NORMAL, not a crash).** Failed builds cost nothing.

### Fly secrets each app needs (NAMES only; values in chat handoff)
- **control-plane-api & agent-runtime:** `DATABASE_URL`, `NODE_ENV=production`. (Fail loud without `DATABASE_URL` in prod-like env; do NOT read Auth0 vars at startup.)
- **worker:** `DATABASE_URL`, `NODE_ENV=production`, `COUNTER_ENV=test`, `SHOPIFY_STORE_DOMAIN`, `SHOPIFY_ACCESS_TOKEN`, `SHOPIFY_API_VERSION`, `SHOPIFY_TEST_VARIANT_GID`, `RAZORPAY_KEY_ID`, `RAZORPAY_KEY_SECRET`, `RAZORPAY_WEBHOOK_SECRET`, `SHOPIFY_WEBHOOK_SECRET`. (`selectPaymentAuthorizationPort` FAILS LOUD in prod-like env if Shopify/Razorpay creds missing.) Webhook secrets can be `"x"` for now.
- **`DATABASE_URL` gotcha:** the `#` in the DB password MUST be percent-encoded as `%23`.

### Vercel env vars (consoles) — set by user per project in Vercel dashboard
`AUTH0_SECRET` (any 64-hex), `AUTH0_BASE_URL` (deployed URL), `AUTH0_ISSUER_BASE_URL`, `AUTH0_CLIENT_ID`, `AUTH0_CLIENT_SECRET`, `AUTH0_AUDIENCE`, `NEXT_PUBLIC_SUPABASE_URL`, `NEXT_PUBLIC_SUPABASE_ANON_KEY`, `NEXT_PUBLIC_API_BASE_URL=https://counter-control-plane-api.fly.dev`. merchant-console page reads `NEXT_PUBLIC_MERCHANT_ID` (falls back to pilot merchant); real tenant boundary is server-side from the token.

---

## 6. SANDBOX / ENVIRONMENT BUGS (do NOT re-diagnose)

1. **File-tool overlay divergence (CRITICAL):** `fs_write`/`str_replace`/`read_file` + `grep_search` operate on a per-turn overlay that **DIVERGES from real disk** (git/pnpm/tsc/node). Caused real failures (a lost eslint fix reported "done"; a "1 error" that was really 907; this very HANDOFF file failed the first fs_write). **ALWAYS edit via bash (python3 heredoc / `cat <<'EOF'`) and verify with `cat`/`git diff`/by running the command.** Never trust a file tool's readback alone.
2. **Verify from ground truth, not sub-agent reports.** Sub-agents have reported success not matching disk. Orchestrator re-verifies (git diff, re-run lint/build) before publishing.
3. **Sandbox resets between sessions:** workspace may be empty — re-clone `git clone https://github.com/Rameezuddinmohammed/counterX.git ~/counterX`.
4. **Sandbox network to Fly may time out** (curls to *.fly.dev time out from inside) — sandbox egress, NOT apps down. Trust `flyctl status`/`logs` from user's machine.
5. **git/GraphQL:** clone via HTTPS; `gh pr`/`gh issue`/`gh repo view` are GraphQL and fail — use `gh api "<REST>"`. `gh auth status` "failure" is cosmetic. Push to a NEW branch + PR via `gh api repos/.../pulls`; never push to main directly.
6. **Tests use vitest (esbuild)** — LENIENT about CJS/ESM named-import interop, so runtime ESM crashes (like `pg`) pass tests but crash prod Node. For import changes, prove native load: `node -e "import('./apps/<app>/dist/main.js').catch(e=>{console.error(e);process.exit(1)})"` (missing-env exit is fine; a `SyntaxError` on import is the bug).

---

## 7. Data model notes for Slice 2

There is **NO `transactions` table**. A transaction's truth lives across `runtime.*`:
- `runtime.workflow_intents` — SPINE: `id`, `transaction_id`, `environment`, `scope_kind` ('merchant'|'wallet'|'platform'), `scope_id` (= merchantId when scope_kind='merchant'), `command_type`, `command_digest`, `authority_context` jsonb, `status` ('pending'|'executing'|'completed'|'failed'), `created_at`. Dedup unique index `(environment, transaction_id, command_type, command_digest)`.
- `runtime.lifecycle_steps` — per external-effect outcome: `(environment, idempotency_key, step)` unique; `step` e.g. `shopify.draft`/`shopify.finalize`/`shopify.markPaid`(+`.claim`); `status` ('completed'|'declined'); `reference` (provider order id); `snapshot` jsonb (currently null); `created_at`/`completed_at`.
- `runtime.spend_ledger` — `(environment, wallet_id, reference)` unique; `amount_minor` (minor units, /100 for INR display), `currency`, `spent_at`.
- Others: `idempotency_keys`, `inbox_events`, `outbox_events`, `jobs`, `job_attempts`, `kill_switches`.

Read-model projection (PR #8) maps these to the front-end `Transaction` type. `buyerRef`/`method` have no persisted column yet -> read from `authority_context` else `(unavailable)`/`unknown`. NOTE: `PostgresStepLedger` hardcodes `environment='local'` in queries — relevant when wiring persistence; scope must flow through `workflow_intents.scope_id`.

---

## 8. Prioritized backlog (from sanity sweep; deliberately NOT changed)

Full report: `.agents/tasks/task-codebase-sanity-cleanup/FINDINGS-REPORT.md`. Highlights:
1. **[MED] Transaction read-model follow-ups** (touch deployed API contract — human decision): (a) LIST can emit duplicate rows if a `transaction_id` has two `workflow_intents` -> `DISTINCT ON`; (b) `loadAmount` picks an arbitrary `spend_ledger` row (`ORDER BY id ASC LIMIT 1`) on multi-wallet refs -> make deterministic/aggregate; (c) N+1 fan-out (~401 round-trips at limit=200) -> batch into `IN` queries. Files: `apps/control-plane-api/src/transaction-{routes,store-postgres}.ts`.
2. **[MED] Test-support code in prod dist:** adopt `*.testsupport.ts` convention / exclude globs. CAUTION: `fixtures.ts`/`mock-graphql-client.ts` are re-exported from public `index.ts` and are **load-bearing** (cross-package) — needs an API decision first.
3. **[LOW] DataTable generic constraint** forces `as unknown as ...` bridges in merchant-console — relax `DataTable<T extends Record<string,unknown>>`.
4. **[LOW] operations-console** has 7 pre-existing `react-hooks/exhaustive-deps` issues (eslint-plugin-react-hooks is NOT installed/registered — removed to keep PR #13 coherent).
5. **[COSMETIC] Next 16 deprecations** ("middleware -> proxy", "Unrecognized key: eslint" in next.config.ts) — harmless now; clean up before a Next upgrade.

---

## 9. Domain facts / limits (PILOT.md Profile 0.1)
- Max transaction: **500,000 paise (Rs 5,000)**. Rolling 24h total: **1,000,000 paise (Rs 10,000)**. Max **5 attempts / 24h**.
- Real transaction proven E2E: real Shopify order, real Razorpay order, signed receipt, reconciled. Fixed real-infra bugs previously: Shopify `noteAttributes`->`customAttributes` (API 2025-07), Razorpay double `/v1` base URL, Shopify mark-paid eventual-consistency retry.
- Shopify token lacks `write_products`. Razorpay TEST mode. `COUNTER_ENV=test` uses deterministic `CounterTestPaymentProvider` for the unattended path but ALSO creates a real Razorpay order to prove integration; Razorpay Standard Checkout stays human-present (`action_required`).

---

## 10. Working agreements with the user
- Report when ALL of a multi-part task is done, not per-task (unless blocked).
- Give layman explanations often; user is cost-paranoid (reassure: Fly idle = $0, failed builds = $0).
- Publish is the default final step: push to a NEW branch + open a PR via the GitHub Power; never push to main directly; share the PR link. The USER merges and deploys (Vercel Hobby blocks bot commits).
- Grafana token was EXPIRED (401) — user must regenerate; telemetry wiring deferred.

---

## 11. First-run verification checklist for the next session (from clean)
```
source ~/.nvm/nvm.sh && nvm use 22 && cd ~/counterX
git checkout main && git pull origin main
find apps packages -name '*.tsbuildinfo' -delete; rm -rf apps/*/dist packages/*/dist
pnpm install --frozen-lockfile
pnpm build            # expect: green
pnpm test             # expect: 2811 passing (+ integration skips w/o DATABASE_URL)
pnpm depcruise        # expect: 0 violations
pnpm lint             # expect: ~9 residual real-source items (see findings report)
```
For integration/DB work, export `DATABASE_URL` (value in chat handoff; keep `#` as `%23`).
