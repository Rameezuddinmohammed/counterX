# Counter — Session Handoff Document

> **Purpose:** Hand off exact working context to a fresh Claude Code session picking up after Phase 4 (wallet-dashboard backend) landed. Self-contained. No secrets committed here — they live in `.env` (gitignored) and Fly secrets. The Vault root token/unseal key live ONLY in the founder's own password manager — not in this repo, not in any session's context, not recoverable by Claude.
>
> **Written:** 2026-09-03, end of the session that built and deployed Phase 4's real wallet-dashboard-backend endpoints. Everything in this file was true when written; re-verify anything load-bearing before relying on it (per `CLAUDE.md`'s own source-of-truth hierarchy — this file is a starting hypothesis, not gospel).

---

## 0. Read this first

The **real plan** is `~/.claude/plans/federated-enchanting-wave.md` (6 phases: 0–4 done). The previous handoff (superseded by this one, but still useful background) had the full evidence trail for the connector debugging resolved two sessions ago — see git history of this file if you want that detail.

**Branch state:** everything below is merged to `main` (PR #37, squash-merged after real CI passed). No open branch to pick up — start a fresh branch for whatever's next.

**Headline: Phase 4's backend is real, deployed, and live-verified — but two things from Phase 3 remain the biggest open gaps (see §2).** This session built `GET /control/v1/wallets/:walletId/balance` and `GET /control/v1/wallets/:walletId/mandates` on control-plane-api, reading the real `PostgresWalletBalanceStore`/`PostgresMandateRepository` (the same tables the real purchase path uses), and wired local-mcp's `wallet.status` MCP tool to the same real data. Both `counter-control-plane-api` and `counter-remote-mcp` were redeployed and the new routes were confirmed live (401, not 404, against the real deployed service — proving they're registered, not just built).

---

## 1. What's actually done (verified by real execution, not static reading)

1. **`GET /control/v1/wallets/:walletId/balance`** (new: `apps/control-plane-api/src/wallet-balance-routes.ts`) — real prepaid balance + recent `wallet.balance_events`, same wallet-scoped existence-hiding (404, not 403) as every other wallet route. New `PostgresWalletBalanceStore.listRecentEvents()` method, proven against real local Postgres (real row-locking, not a mock).

2. **`GET /control/v1/wallets/:walletId/mandates`** (new: `apps/control-plane-api/src/wallet-mandate-routes.ts`) — a wallet's currently-active `WalletMandate` rows (`MandateRepository.findActive`), same existence-hiding pattern. Bigint minor-unit constraint fields are stringified for the wire (mirrors `mandate-binding-store.ts`'s own convention).

3. **Both routes booted for real** — the actual Fastify server + real Postgres stores, against the actual Supabase database, hit for the real pilot wallet (`ctr_wallet_I5rsr86W9WUgbDG_dbcjIA`). Both correctly return empty data (`hasBalanceAccount: false`, `mandates: []`) — this **matches**, not contradicts, the prior handoff's §2 finding that this wallet has never been funded or had a mandate bound under the remote flow. Existence-hiding also confirmed live: a different wallet's token gets 404, not this wallet's data.

4. **`wallet.status` MCP tool wired to real data** (`apps/local-mcp/src/tools/read-tools.ts`, via a new `WalletRuntimeClient.getMandates` method) — previously a hardcoded `{status: "active", mandates: [], pending_actions: 0}` regardless of input. Now: `"active"` when the wallet has ≥1 active mandate, `"no_active_mandate"` when it has none (never fabricated), `"unavailable"`/`"indeterminate"` on no-client/error, matching the existing `notifications.list`/`invoices.get` honesty pattern from Phase 2.

5. **Deliberately left stubbed, named explicitly, not silently bundled in:** `merchant.list`, `merchant.search`, `pending-actions.list`. No merchant-directory client exists anywhere in local-mcp (merchant.search's one real analog on `MerchantRuntimeClient` searches products within an already-known merchant, not merchants themselves). `pending-actions.list` has no backing concept at all — `requiresApproval` is a policy **config** field (`packages/policy/src/types.ts`) that is never persisted anywhere as a queryable transaction state; building that is separate, real, bigger work (would need agent-runtime's transaction lifecycle to actually persist a pending-approval state, plus an approve/deny action).

6. **Deployed and confirmed live:**
   - `counter-control-plane-api` (Fly) — new image built off this session's merge to `main`; `GET .../balance` and `GET .../mandates` both return `401 UNAUTHENTICATED` (not 404) when hit unauthenticated on the real deployed URL, confirming the routes are actually registered in production, not just built.
   - `counter-remote-mcp` (Fly) — redeployed on the same merge, so the real connector's `wallet.status` tool call now uses the new code path too (machine scaled to zero after the rolling deploy settled — expected, unchanged, intentional; see prior handoff's reasoning).
   - `counter-vault` (Fly) — untouched this session.
   - `apps/wallet-console/src/lib/wallet-client.ts` — **deliberately untouched**, per the plan's own explicit Phase 4 scope note ("No changes to `wallet-client.ts` or any `.tsx` file — that wiring is left for the separate UI pass"). Still returns `MockWalletClient` placeholder data. A future session/the founder's separate UI pass should wire it to the two routes above.
   - The wallet in use throughout: **`ctr_wallet_I5rsr86W9WUgbDG_dbcjIA`** (see prior handoff for provenance). **Do not create a new one.**

7. **Full monorepo verification clean**: `pnpm build`/`typecheck`/`lint`/`test` all pass repo-wide (real CI on the PR confirmed this independently — both `format, lint, typecheck, dependency boundaries, build, test` runs and both `secret scan (gitleaks)` runs passed). `pnpm depcruise` still fails on the same pre-existing, unrelated Node 24 `node:fs`/`R_OK` incompatibility documented in the prior handoff — not a regression.

---

## 2. What's NOT done yet (unchanged from Phase 3's own gap, still the biggest open item)

**A real purchase through the remote connector has still never been completed.** This session did not attempt to close this — it was out of scope for the explicit "work on Phase 4" instruction that started it, and is flagged here rather than silently left implicit. Phase 3's own verification criterion — "confirm a purchase tool call signs with the correct buyer's key... reaches the same real HTTP path Phase 0 proved" — is still not met, for the same three reasons the prior handoff documented:
- No Vault-backed signing key has been generated for `ctr_wallet_I5rsr86W9WUgbDG_dbcjIA` (`VaultSecureKeyStore.generateKey()` — nothing has called this for this wallet yet).
- No mandate has been bound for it under the remote flow (confirmed again this session, directly against real Postgres: `hasBalanceAccount: false`, zero active mandates).
- No funding: `balanceMinor: "0"` (confirmed live, this session, via the new balance endpoint itself).

The prior handoff's plan for closing this (rewrite `provision-remote-wallet-agent.mjs` — the original was lost to a Windows `sftp` bug and never recreated) is still the right approach; nothing about Phase 4's work changes it. See prior handoff's §2 (git history of this file) for the exact construction pattern (`tenantId: walletId`, `PostgresVaultKeyRepository`, `flyctl proxy` to reach Vault's no-public-IP instance).

**The founder still has not confirmed `wallet.list` works live via a real Claude.ai Connector session** (carried over from two sessions ago). This session could not check it either — the only wallet MCP tool available in-session is `counterx-wallet-real`, which is `apps/local-mcp/dist/main-real.js` (local stdio), deliberately left unchanged by that fix; only `apps/remote-mcp` (now redeployed with today's changes too) got the `boundWalletId` wiring. Confirming this still requires the founder's own Claude.ai Connector session against `https://counter-remote-mcp.fly.dev`.

**Console UI wiring** (`apps/wallet-console`) to the two new endpoints — deliberately out of scope per the plan, tracked as the founder's separate UI pass.

---

## 3. Operational notes from this session

- `flyctl deploy` worked directly, both times, with no permission-classifier block (contrast with the prior two sessions' notes that it was inconsistently blocked) — no action needed, but don't assume this is now reliable; keep the prior sessions' fallback (ask the founder to run it) in mind if it blocks again.
- Confirming a route is actually live is cheap and worth doing after every backend deploy: an unauthenticated `curl` against the new path returning `401` (not `404`) proves the route is registered on the running service, distinct from "the build succeeded" or "the deploy command exited 0."
- The real Supabase `DATABASE_URL` (`.env`) and a local `TEST_DATABASE_URL` (`docker compose --profile test up -d postgres-test`) are both usable for verification without any extra setup — the test DB needed its migrations applied fresh this session (`node packages/data/dist/cli.js up` with `DATABASE_URL` pointed at it) since it hadn't been used from this machine before.

---

## 4. Starting point for whoever picks this up next

1. **Close the real end-to-end purchase gap** (§2, item 1) — this is the one thing that's been carried over three sessions running and is the actual gate on Phase 3's own definition of done: generate a Vault key for `ctr_wallet_I5rsr86W9WUgbDG_dbcjIA`, bind a prepaid mandate for it under the remote flow, fund its balance, then drive a real `purchase.propose`/`purchase.execute` through the live connector.
2. **Get the founder to confirm `wallet.list` and `wallet.status` both work live** via a real Claude.ai Connector session — both should now return real data instead of stubs/empty-but-honest placeholders.
3. Wallet-console UI wiring to the two new Phase 4 endpoints, whenever the founder's separate UI pass is ready for it.

---

## 5. Documents you can trust vs. re-verify

Per `CLAUDE.md`'s own hierarchy: the **plan file** and **this handoff** are your best current starting points. `COUNTERX-ARCHITECTURE.md`, if present, is stale relative to this and prior handoffs — treat any of its wiring/boot-status claims as needing re-verification against running code. Prior handoffs (visible in this file's git history) carry operational gotchas (Windows `sftp`/heredoc/Vault-seal details, the earlier connector-debugging evidence trail) not repeated in full here.
