# Counter — Session Handoff Document

> **Purpose:** Hand off exact working context to a fresh Claude Code session. Self-contained. No secrets committed here — they live in `.env`/`apps/wallet-console/.env.local` (both gitignored) and Fly secrets.
>
> **Written:** 2026-09-04, at the close of the Razorpay buildathon detour (`finalplan.md`). **Everything below was true when written; re-verify anything load-bearing** (per `CLAUDE.md`'s own source-of-truth hierarchy). This entirely supersedes the previous version of this file (Phase 1 / mandate-pivot handoff, 2026-09-04 morning) — that content is in git history if needed, but its "what's next" section (retire the prepaid balance) was executed and then **deliberately reverted** the same day; see §1.

---

## 0. Read this first — the state is NOT what the morning session left it in

This morning's session retired the custodial prepaid-balance model (Phase 2 of `the-mandate-pivot.md`) because it directly contradicts `PRD.md` §5/§14 — Counter must never hold a buyer's balance. That was correct and deliberate.

**This afternoon's session reverted it**, on the founder's own explicit direction, for one reason: a Razorpay buildathon needed a demoable live purchase faster than the in-progress Solana crypto settlement rail could be made demo-ready. The rationale, the exact trade-off, and everything that was checked before doing it are in `finalplan.md` at the repo root — **read that file before assuming either "state" is current.** Its own text asks that its trade-off paragraph not be deleted "when this plan is checked off"; it hasn't been.

**Net effect on `main` right now:**
- The custodial prepaid-balance model is back (PR #48, revert of PR #44).
- A brand-new piece was built on top of it that never existed before either time: real self-serve Razorpay top-up (PR #49/#50 — see §3 for the PR-numbering hiccup).
- The crypto settlement rail (PR #47, `feat/crypto-adapter-solana` + the pushed-but-unmerged `feat/wire-solana-settlement-v2` branch) is untouched, real, tested, and still the stated long-term direction — it was set aside for today only, not abandoned.

If a future session's job is anything resembling "finish the mandate pivot" or "get back to non-custodial," **the correct move is very likely reverting today's revert** (i.e., re-applying commit `4f09f1b`'s intent) and finishing the crypto rail instead — not building more on top of the prepaid-balance model. Get the founder's explicit confirmation before doing that; don't assume.

---

## 1. What happened today, in order

1. **Morning:** Phase 1 (self-serve mandate flow) and Phase 2 (prepaid-balance retirement) of `the-mandate-pivot.md` shipped to `main` (PRs #39–#46), plus a real money-safety concurrency fix in the spend ledger (PR #46 — `pg_advisory_xact_lock`, closing a race where two concurrent first-ever reservations both bypassed the cap). A Solana devnet crypto settlement rail was also built (PR #47, `feat/crypto-adapter-solana`) and its wiring into the worker's money seam was left uncommitted on `feat/wire-solana-settlement-v2`.
2. **Mid-session (`finalplan.md` written):** the founder redirected to a Razorpay-buildathon-scoped demo. Before touching anything, the uncommitted Solana wiring was committed and pushed to `feat/wire-solana-settlement-v2` (commit `eb3ef89`) so it wasn't stranded or lost when branching for the revert.
3. **Step 1 — revert.** `git revert 4f09f1b` on a fresh branch off `origin/main`, confirmed zero file overlap with PR #45/#46 (both untouched, still correct), merged as **PR #48**.
4. **Step 2 — new work.** Real self-serve Razorpay top-up (`wallet-topup-routes.ts` + `/wallet/topup` UI), built on top of the revert. **Caught and fixed one real bug before shipping**: the topup route requires step-up assurance (`identity.scope.manage`), so the client uses `lib/step-up-token.ts` + `mfa.challengeWithPopup()`, not plain `auth0.getAccessToken()` — the latter would have 403'd every request. This PR was originally opened stacked on the revert branch as **PR #49**; merging PR #48 with `--delete-branch` auto-closed #49 (GitHub closes a PR when its base branch is deleted) — it was **re-opened against `main` as PR #50** with the identical commit and merged. No work was lost; if you see PR #49 in history, it's closed-unmerged and PR #50 is its replacement.
5. **Steps 3–5 — verified live, not just tested.** All of the following were independently confirmed against the **real** Supabase database, not inferred from logs or UI text:
   - A real Razorpay test-mode top-up of ₹2,000 to wallet `ctr_wallet_I5rsr86W9WUgbDG_dbcjIA`, driven through an actual browser checkout (test card `4111 1111 1111 1111`, completed by the founder — entering card numbers is outside this agent's own permitted actions even for test-mode dummy data). `wallet.balances`/`wallet.balance_events` confirmed the credit.
   - A new demo agent (`ctr_agent__nR51leUYCqMZF9xYQKBqQ`) registered via `register-agent-self-serve.mjs` with a durable, disk-persisted Ed25519 key at `~/.counter/wallet-keys-demo.enc.json` (passphrase `counterx-buildathon-demo-2026` — a demo-only value, not the founder's own real keystore passphrase; deliberately a **separate file** from the founder's existing `~/.counter/wallet-keys.enc.json` since that one's passphrase wasn't known and shouldn't be guessed at).
   - A real, `active` `WalletMandate` (`ctr_mandate_IHEvoD9s4cPpZKEOClq_Gg`) bound to `prepaid-balance:ctr_wallet_I5rsr86W9WUgbDG_dbcjIA` via `issue-and-bind-prepaid-mandate.mjs`, confirmed in `wallet.mandates`.
   - A real ₹500 purchase via the new `scripts/demo-agent-purchase.mjs` (see §2): real signed CTP intent (independently re-verified, not just self-asserted), real Shopify order (then cancelled as cleanup), real prepaid-balance debit (₹2,000 → ₹1,500, confirmed in `wallet.balance_events`), real signed receipt.
   - A real ₹3,000 purchase against the ₹1,500 remaining balance: **declined** (`HandlerError("payment.declined", ...)`) before any money moved; balance confirmed unchanged afterward.
6. **Step 6.** Crypto rail left exactly as-is (PR #47, `feat/wire-solana-settlement-v2` both untouched). Added a disabled "Crypto Settlement — coming soon" quick-action card and an "Add Funds" sidebar entry to wallet-console.
7. **Step 7.** `pnpm verify`'s full gate (format/lint/build/typecheck/test) passes clean across the whole monorepo for everything this session touched. **`depcruise` could not run at all in this environment** — `dependency-cruiser@16.10.0` crashes on Node 24.18.0 (`node:fs` no longer exports `R_OK`), which this session's terminal runs despite the repo pinning Node `>=22.14.0`. This is a pre-existing environment mismatch, not something this session's changes caused — confirm on a pinned-Node-22 environment (or after a `dependency-cruiser` upgrade) before trusting a "0 violations" claim again.

---

## 2. New file: `scripts/demo-agent-purchase.mjs`

Drives one real purchase through the **worker's actual production money seam** — same `selectPaymentAuthorizationPort` + `createTransactionLifecycleHandler` wiring `apps/worker/src/main.ts` runs, with the **same real durable stores** (spend ledger, revocation store, wallet-balance store, step ledger, kill-switch store) main.ts wires, so the real production policy governs it — not the `ALLOW_ALL` default `scripts/verify-real-transaction.mjs` exercises.

It also builds + signs a real CTP purchase intent using `@counter/wallet-application`'s `PurchaseIntentBuilder` (the same class `apps/local-mcp`'s `purchase.execute` handler uses) with the demo agent's own real key, and independently re-verifies that signature via `@counter/trust-protocol`'s `verifyEnvelope` before trusting it.

**What it does NOT reproduce** (disclosed in its own header comment): the full `apps/local-mcp` → `agent-runtime` HTTP hop a real MCP client would go through, or `agent-runtime`'s own mandate-ceiling check. This deployment's self-serve agent has **no `agent-runtime` M2M credentials configured** (`register-agent-self-serve.mjs` prints `<ask Counter>` for `COUNTER_AGENT_RUNTIME_URL`/`COUNTER_RUNTIME_AUTH_TOKEN`) — that's a real, pre-existing gap, not something this session introduced or attempted to work around. If a future session needs the full agent-runtime hop working end-to-end for a self-serve agent, that credential wiring is the blocker to solve first.

Usage:
```
COUNTER_WALLET_KEYSTORE_PATH=~/.counter/wallet-keys-demo.enc.json \
COUNTER_WALLET_KEYSTORE_PASSPHRASE=counterx-buildathon-demo-2026 \
node scripts/demo-agent-purchase.mjs --amount-minor 50000   # normal purchase
node scripts/demo-agent-purchase.mjs --decline               # over-balance decline demo
```

---

## 3. Known gaps and warts (verified today, none block anything specific)

- **A Shopify *draft* order is created before the prepaid-balance sufficiency check runs**, not after — the real-lifecycle.ts money seam creates the draft at step 6, and the prepaid debit check is inside step 8. This is not a new issue and not specific to this session's revert: the general draft→pay→finalize ordering is unconditional across every payment branch, and a Shopify draft order is explicitly non-committal (no inventory reservation, not a real "Order" until `orderFinalize` runs, which only happens *after* a successful payment). The declined-purchase demo leaves a harmless, reversible draft order behind in the test store; it was not individually cleaned up (no Shopify order id is available to cancel when the handler throws before ever creating a receipt).
- **PR #49 exists in GitHub history as closed-unmerged** (see §1.4) — not a real PR to look at for context; PR #50 is the merged one with the identical commit.
- **The revert also reverted doc prose** in `PRD.md` §14.1, `PILOT.md`, `CONFORMANCE.md`, and `.kiro/specs/counter-agent-wallet/*` — those now read as if Phase 2 (custodial retirement) never happened. This was a known, accepted side effect (flagged in `finalplan.md` and PR #48's description), not fixed here — a later session reading those files cold should trust this handoff and `finalplan.md`, not those files, for current state.
- **`.env`'s `COUNTER_ENV=test`** was the environment every verification in this session ran against — the real Supabase dev database's `test` partition, not `production`/`pilot`. Nothing in this session touched anything outside that partition.
- **Local `pnpm format:check` fails on two pre-existing untracked files** (`.impeccable/hook.cache.json`, `docs/the-mandate-pivot.html`) — neither committed, neither touched by this session, both predate it.
- **`depcruise` could not be run** — see §1.7.

---

## 4. Documents you can trust vs. re-verify

Per `CLAUDE.md`'s hierarchy: `finalplan.md` (this session's own plan, with a self-check of its factual claims already baked in) and this handoff are the best current starting points for *today's* work. `COUNTERX-ARCHITECTURE.md`'s Auth0/console sections are still stale (predates this session, flagged at its own top). `PRD.md`/`PILOT.md`/`CONFORMANCE.md`/`.kiro/specs/**` now describe a non-custodial state that is **not what `main` currently runs** — see §3. `.kiro/specs/**/tasks.md` is stale for completion status per `CLAUDE.md`'s own hierarchy note.
