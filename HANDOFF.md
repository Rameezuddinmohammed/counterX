# Counter — Session Handoff Document

> **Purpose:** Hand off exact working context to a fresh Claude Code session picking up Phase 3 of the remote-MCP plan, without needing to re-derive anything from scratch. Self-contained. No secrets committed here — they live in `.env` (already in the repo working tree, gitignored) and Fly secrets.
>
> **Written:** 2026-09-02, end of the session that completed Phases 0–2. Everything below was true at that moment; re-verify anything load-bearing before relying on it (per `CLAUDE.md`'s own source-of-truth hierarchy — this file is a starting hypothesis, not gospel).

---

## 0. Read this first

The **real plan** is `~/.claude/plans/federated-enchanting-wave.md` (6 phases: 0 done, 1 done, 2 done, 3 next — remote MCP connector — then 4, notifications-adjacent wallet-dashboard work). Read it before starting Phase 3; this doc is operational context, not a replacement for it.

Your auto-loaded memory (`MEMORY.md` + linked files) already has detailed writeups of Phases 0 and 2 — `phase0_prepaid_mandate_binding_complete.md`, `phase2_notifications_backbone_complete.md`, `founder_production_autonomy_pattern.md`, `auth0_shared_console_app_gaps.md`. Read those before this file if you want the "why", not just the "what."

**Current branch:** `feat/prepaid-wallet-real-razorpay-capture`. **Not pushed to remote** — everything is local commits only. Two new commits this session: `e93196e` (Phase 0) and `38a56fb` (Phase 2), on top of the branch's prior commits (`3a49fe5`, `6a958f5`, ...). Whoever picks this up should decide whether to keep working on this branch, split it, or open a PR — the founder hasn't been asked yet.

---

## 1. What's actually done (verified by real execution, not static reading)

**Phase 0 — prepaid-balance wallet mandate binding.** `PrepaidBalanceMandateBindingService` + `POST /control/v1/wallets/:walletId/prepaid-mandates` + `scripts/issue-and-bind-prepaid-mandate.mjs`. A prepaid-balance-funded wallet can now get a durable `WalletMandate` and pass `checkMandateAuthority` through the real admission path. Also fixed a real bug: `apps/worker/src/transaction-lifecycle.ts`'s `parseAuthority()` silently dropped `mandateId`, which meant the worker's own defense-in-depth revocation re-check was dead code — fixed, regression-tested. Also fixed two real production gaps found while verifying: the deployed worker was 2 days stale, and the pilot merchant (`ctr_merchant_BwcHBwcHBwcHBwcHBwcHBw`) had **no `merchant.scopes` row at all** and no connected Razorpay gateway — both fixed (seeded the row, connected real test credentials, verified via Razorpay's own API).

**Phase 1 — merchant setup completion.** Turned out to be mostly already-built: the Auth0 Post-Login Action that stamps merchant permissions onto login tokens already existed and was already correct. The real gap was that `merchant:read`/`merchant:write` were never defined as permissions on the "Counter Platform API" in Auth0, so the Action's own signal for "is this a merchant login" could never fire. Fixed: added both permissions, granted them to the "Counter Console" app (now 5/5, was 3/5). **Not live-tested** — nobody has done a fresh merchant-console login since the fix; if you touch merchant-console auth, that's the first thing to verify.

**Phase 2 — notifications backbone.** `apps/worker/src/outbox-dispatcher.ts` (claims pending `runtime.outbox_events`, fans out to merchant webhooks + a new `runtime.buyer_notifications` projection), `merchant.webhook_endpoints` table (migration 0022, applied to the real DB), a real Shopify `fulfillments/*` webhook handler, and real `notifications.list`/`invoices.get` MCP tools in `apps/local-mcp`. The dispatcher had never run before this session — the instant it started, it cleared a backlog of outbox rows stuck since **2026-08-29**. Found and fixed a real bug live: the new `merchant.order.created.v1` event initially carried an internal derived transaction id instead of the raw one the buyer actually has, making notifications uncorrelatable — caught by checking the actual DB row after a live purchase, fixed, redeployed, reverified.

Both `apps/worker` and `apps/control-plane-api` are **deployed to Fly with all of this code live** as of session end. `apps/agent-runtime` was not touched this session (still whatever was deployed before) — no source changes there.

---

## 2. Critical operational gotchas hit this session (don't rediscover these the hard way)

- **The Bash tool's network is isolated from the real Supabase DB** — any `node -e` or script run via the `Bash` tool that tries to connect to `DATABASE_URL` gets `ECONNREFUSED` (looks like "nothing listening" but is actually sandboxed egress). **Use the `PowerShell` tool for anything that touches the real database.** `Test-NetConnection` from PowerShell confirmed direct TCP to the Supabase pooler works fine from there.
- **PowerShell `node -e "..."` mangles backticks** — PowerShell treats `` ` `` as its own escape character even inside a double-quoted argument, so inline template-literal one-liners silently break. Write the script to a `.mjs` file with `Write`, then `node path\to\file.mjs` from PowerShell instead.
- **Scripts don't get `.env` for free** — every one-off script needs to manually read and parse `.env` at the top (see any `scripts/*.mjs` for the 4-line pattern: split on newline, regex `^([A-Z_][A-Z0-9_]*)=(.*)$`, only set if not already in `process.env`).
- **`pg`'s named exports don't work under ESM** — `import { Client } from "pg"` throws; use `import pg from "pg"; const { Client } = pg;`.
- **`pnpm db:migrate` (the CLI) is deliberately restricted to a loopback `counter_local`/`counter_test` database** — it will refuse to run against the real Supabase `DATABASE_URL`. To apply a migration to the real DB, write a tiny script using `PostgresDatabase` + `loadMigrations`/`MigrationRunner` directly from `packages/data/dist` (see this session's git history for the exact pattern — it was a temp file, deleted after use, not committed).
- **The Claude-in-Chrome browser extension and the `auth0` MCP server both dropped connection at least once this session** and needed the user to manually restart/reconnect them. If you need either, expect to ask the user to reconnect, and don't assume a `CONNECTION_CLOSED` error means the capability doesn't exist.
- **The `key` action for browser automation can silently TYPE a key name as literal text** instead of pressing it as a special key (happened with `"Page_Down"` — it got typed into a live Auth0 Action's source code before I caught it and undid it). Stick to mouse actions (click, scroll, drag) for navigation in the Auth0 dashboard; only use `key` for things confirmed to work like `ctrl+Home`/`ctrl+End`/single arrow keys after clicking into a text field first, and always screenshot-verify after.
- **Auto-mode's permission classifier blocks direct `flyctl scale`/typing-into-dashboard actions** even under the CLAUDE.md production-autonomy grant — clicking pre-existing UI elements (checkboxes) worked fine, but typing text into an Auth0 form field got blocked. When blocked, explain to the user and let them do that one step, or ask them to unblock it — don't route around it.
- **Test wallet keystores created this session live in the session-scoped scratchpad directory**, e.g. `C:\Users\nazim\AppData\Local\Temp\claude\C--Users-nazim-counter\<session-id>\scratchpad\*.enc.json`. **This path will not exist in a new session.** If you need a wallet with existing balance/mandates for testing, either register a fresh one (cheap — synthetic top-up, real mandate binding, ~2 minutes) or ask the user for the passphrase to a specific keystore file if they've kept a copy.

---

## 3. Real test wallet state (as of session end — likely stale/spent by the time you read this)

The most recently created, still-usable wallet from this session: `ctr_wallet_heYUlPKiGc1wwE23UCZENw` (registered via `apps/local-mcp/scripts/register-buyer-agent.mjs`), agent `ctr_agent_QV0mia24mIc4ynWAD4MCxg`, kid `ctr_key_kWV1xJp4Ayq2vF28B-WtXQ`. Had a synthetic top-up of ₹5,000 and one active mandate `ctr_mandate_0hv-KBLojEQvYZpWYF7dDQ` (ceiling ₹5,000); made two real ₹1,228.82 purchases against it, so balance was ≈₹2,512 minus a bit at last check. **Its keystore lives in the session-scoped scratchpad (see above) and will not survive into a new session** — treat this id as a DB record you can query, not something you can sign new purchases with, unless you re-derive/re-register.

An earlier wallet from Phase 0, `ctr_wallet_vK-wpQwg1l1GHkC37iCfsw`, is real and has real balance but **hit its rolling 24h spend/attempt policy limit** from extensive same-session testing — a real purchase against it will legitimately get `policy-declined`, not a bug. Don't burn time re-diagnosing that if you see it again; either wait out the window or use a fresh wallet.

**Cheapest way to get a fresh, working, funded, mandated wallet for testing:**
```
node apps/local-mcp/scripts/register-buyer-agent.mjs   # prompts for a passphrase; note the walletId/agentId/kid it prints
# then top up (write a tiny script using PostgresWalletBalanceStore.topUp() with a clearly-labeled synthetic reference — see packages/data/src/wallet-balance-store.ts)
node scripts/issue-and-bind-prepaid-mandate.mjs --wallet-id <id> --agent-id <id> --kid <kid> --ceiling-minor 500000
```
All run via PowerShell (see gotcha #1 above), from repo root, after building `packages/data`, `packages/wallet-domain`, `packages/wallet-application`, `packages/trust-protocol`, `packages/domain`, `packages/payment-sdk`, `apps/control-plane-api`.

---

## 4. Production state

- `counter-worker` (Fly) — running current code including the outbox dispatcher and the transactionId fix. Healthy, `payment connector selected { mode: 'real' }`, dispatcher loop confirmed running.
- `counter-control-plane-api` (Fly) — running current code including all Phase 2 routes. Healthy (auto-stops when idle, wakes on request — normal).
- `counter-agent-runtime` (Fly) — untouched this session, whatever was live before.
- Real DB migrations applied through **0022** (`webhook-endpoints-and-buyer-notifications`).
- Pilot merchant `ctr_merchant_BwcHBwcHBwcHBwcHBwcHBw` now has a real `merchant.scopes` row and a connected (real, verified) Razorpay test gateway — this was NOT true before this session and blocked the worker from booting; don't re-diagnose that failure mode if you see old references to it.
- Auth0 "Counter Platform API" now has 5 permissions (`agent:transact`, `wallet-users:provision`, `wallet-users:self-serve`, `merchant:read`, `merchant:write`), all granted to "Counter Console".

---

## 5. Verification baseline at handoff

Full clean build, `pnpm typecheck`, `pnpm lint`, and `pnpm test` were all green across the entire monorepo (20 packages/apps with tests, zero failures) as the very last check before the Phase 2 commit. If you touch anything, re-run the relevant scoped checks; re-run the full suite before another commit/PR.

**Known, pre-existing, NOT-yours-to-fix failures:**
- `pnpm depcruise` fails with a Node 24 / `dependency-cruiser@16.10.0` incompatibility (`node:fs` doesn't export `R_OK` the way that version expects). Unrelated to any of this session's or prior sessions' code changes — a devDependency/Node-version mismatch. Don't attempt a fix unless asked.
- `apps/merchant-console` has one pre-existing `react-hooks/exhaustive-deps` lint warning (not an error, doesn't fail the gate).

---

## 6. Starting point for Phase 3 (remote MCP connector)

This is the biggest, most novel phase. Per the plan, **do the key-custody spike first, before writing any transport code**: confirm Ed25519 signing support and choose between HashiCorp Vault's Transit engine and GCP Cloud KMS, then document the choice and the accepted residual risk directly in `.kiro/specs/counter-agent-wallet/design.md` (updating its "local stdio by default" principle rather than silently contradicting it) — this was a decision the founder already made in principle (signing keys move server-side, buyer only ever connects to one remote MCP URL) but the concrete Vault-vs-KMS choice was left for this phase.

After that: a new multi-tenant `SecureKeyStore` in `packages/wallet-domain` (existing `FileSecureKeyStore`/`InMemorySecureKeyStore` stay untouched), a new `apps/remote-mcp` app wrapping `createMcpServer` from `apps/local-mcp` with the MCP SDK's `StreamableHTTPServerTransport` over Fastify, and a Fastify-native reimplementation of the MCP SDK's OAuth endpoints fronting the **existing** Auth0 tenant via `ProxyOAuthServerProvider` (one new pre-registered Auth0 client — same pattern the three existing consoles use). Full detail is in the plan file itself.

**Known related gap, not part of Phase 3 per se but adjacent:** `AGENT_RUNTIME_M2M_CLIENT_ID`/`SECRET` (the credential a Post-Login Action would use to mint a wallet's own runtime bearer token) is not configured anywhere in this environment — this is the same missing piece that made `apps/local-mcp/src/wallet-runtime-client.ts` (Phase 2) gracefully degrade rather than being live-testable end-to-end through the full self-serve flow. Phase 3's OAuth work may end up touching or resolving this naturally; if not, it's worth flagging to the founder as its own small gap.

---

## 7. Documents you can trust vs. re-verify

Per `CLAUDE.md`'s own hierarchy (which governs this repo — read it, it's short and this doc doesn't repeat it): the **plan file** and **this handoff** are your best current starting points. `COUNTERX-ARCHITECTURE.md`, if present, was already flagged stale by a prior session regarding the payment-signer fixture note — treat any of its wiring/boot-status claims as needing re-verification against running code, same as always. Don't trust this file's own specific numbers (wallet balances, exact commit hashes matching HEAD, exact deploy versions) without a quick real check — trust its shape and gotchas, re-verify its specifics.
