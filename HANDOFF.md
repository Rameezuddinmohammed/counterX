# Counter — Session Handoff Document

> **Purpose:** Hand off exact working context to a fresh Claude Code session picking up Phase 4 (wallet-dashboard backend) of the plan, after Phase 3 (remote MCP connector) was proven working end-to-end for real. Self-contained. No secrets committed here — they live in `.env` (gitignored) and Fly secrets. The Vault root token/unseal key live ONLY in the founder's own password manager — not in this repo, not in any session's context, not recoverable by Claude.
>
> **Written:** 2026-09-03, end of the session that finally got a real Claude.ai Connector to connect after the prior session left it blocked on a generic "Authorization failed." Everything in this file was true when written; re-verify anything load-bearing before relying on it (per `CLAUDE.md`'s own source-of-truth hierarchy — this file is a starting hypothesis, not gospel).

---

## 0. Read this first

The **real plan** is `~/.claude/plans/federated-enchanting-wave.md` (6 phases: 0–3 done, 4 next — wallet-dashboard backend). The previous handoff (superseded by this one, but still useful background) had the full evidence trail for the connector debugging that got resolved this session — see git history of this file if you want that detail.

**Branch state:** everything below is merged to `main` (PRs #34, #35, both squash-merged after real CI passed). No open branch to pick up — start a fresh branch for Phase 4.

**Headline: the remote MCP connector works now.** A real Claude.ai Connector completed a full OAuth login against `https://counter-remote-mcp.fly.dev` this session, and a real tool call through it (`wallet.list`) returned the correct wallet after a follow-up fix. This is the first time Phase 3's actual goal — buyer connects Claude.ai directly to the hosted URL, no local process — has been proven with a real Claude.ai client, not just curl/browser-automation reproductions of pieces of the flow.

**Important honesty note, don't skip this:** the previous handoff's leading theory (Auth0 Attack Protection blocking repeated attempts) was checked for real this session and **ruled out** — see item 1 below for the dashboard evidence. Two real, previously-undiscovered logging gaps were found and fixed instead (item 1.1–1.2). But **we do not have direct proof either of those two fixes was the actual cause** — neither of their new log hooks ever fired, including during the successful connection. It's equally possible the connector was already working by the time this session started (e.g. once `counter-control-plane-api` truly settled into always-on, see item 1.4) and these two fixes, while real and worth keeping, weren't what was blocking anything. Don't repeat either explanation as confirmed fact without new evidence.

---

## 1. What's actually done (verified by real execution, not static reading)

1. **Ruled out Auth0 Attack Protection as the cause**, with real dashboard evidence the founder pulled directly: Threat Monitoring showed **0 threats** of any kind (credential stuffing, signup attack, MFA bypass) over the full week; Bot Detection is **disabled** entirely; Suspicious IP Activities is **enabled** but recorded **zero** detections even during a spike of 16 failed logins in one window. Whatever was failing, Auth0 itself never considered it an attack.

2. **Found and fixed two real, previously-silent failure paths in `apps/remote-mcp/src/oauth/provider.ts`** (PR #34, merged as `bb04560`):
   - `onUpstreamDenied` — fires when Auth0 redirects `/oauth/callback` with its own `error`/`error_description` (e.g. a Post-Login Action denying access). This path existed since Phase 3 shipped but was never logged anywhere — combined with `disableRequestLogging` on this app (`server-factory.ts`), a real Auth0-side denial left zero server-side trace, ever.
   - `onGrantRejected` — fires when the downstream MCP client (Claude's backend) fails to redeem a code *we* issued, after Auth0's own leg already succeeded (code not found / already consumed / expired / issued to a different client). Added after checking real Auth0 logs mid-session and finding **6 consecutive successful logins** (12:57:18 through 13:47:58 UTC) with zero failures in between — proof the failure, whatever it was, happened *after* Auth0's success, a step that had no logging at all.
   - Both are pure logging additions, client-facing behavior unchanged. Neither has fired in production since deploying — see the honesty note above.

3. **A real, live Claude.ai Connector completed a full OAuth login** against the deployed server (confirmed directly by the founder: "connected!"). Fly logs for that boot are clean — no errors, no new hook firing.

4. **Found a real gap in the "always-on" control-plane-api fix from the prior session**: `fly.control-plane-api.toml` already had `min_machines_running=1`/`auto_stop_machines=false` committed, but the real Fly logs show the app **still auto-stopped twice** (13:01:29Z and 13:14:10Z) after that. It only stopped auto-stopping once a fresh image was actually pulled and the machine restarted around 13:16–13:17Z. Lesson, not a bug to fix: editing a `fly.toml` scaling setting doesn't take effect until the next real deploy actually lands on the machine — don't assume a committed config change is live without checking the machine's own recent restart history.

5. **Found and fixed a third real bug, live, from the connector's very first real use** (PR #35, merged as `ec34391`): `wallet.list` (registered in `apps/local-mcp/src/index.ts`, shared by both local and remote transports) unconditionally returned `{wallets: [], status: "not_implemented"}` — the founder's own Claude session asked to check its wallet, got told none exist, and reasonably assumed the connector was broken. An authenticated MCP session (local or remote) is never scoped to more than one wallet (`mcp-route.ts`'s own invariant), so the fix threads that already-known `walletId` through `createMcpServer`'s new optional `boundWalletId` param. `apps/local-mcp`'s own `main-real.ts` still passes none, so its behavior is deliberately unchanged — only `apps/remote-mcp` benefits today. **Not yet re-confirmed live by the founder as of this writing** — the deploy succeeded (`counter-remote-mcp` now on `deployment-01M1M3FFA9BZC52MR47KKPT1JN`, version 6) but the next real Claude.ai retry hadn't been reported back yet when this handoff was written.

6. **Found, but deliberately did NOT fix (named as separate, bigger, pre-existing work, not silently bundled in)**: four other MCP read tools registered in `apps/local-mcp/src/tools/read-tools.ts` are *also* unconditional hardcoded stubs with no real backing data at all, regardless of input — `wallet.status`, `merchant.list`, `merchant.search`, `pending-actions.list`. This is openly documented in that file's own test header (`read-tools.test.ts`'s docstring already calls these out as "honest-fallback behavior for tools with no reachable client") — not a new discovery, but worth restating because it directly overlaps with Phase 4's scope. **See item 6 below — this changes what "done" should mean for Phase 4.**

**Deployed and live:**
- `counter-remote-mcp` (Fly) — now on `deployment-01M1M3FFA9BZC52MR47KKPT1JN` (version 6), includes both PR #34 and #35's fixes. Scales to zero when idle (unchanged, intentional — see prior handoff's item 11 reasoning for why this is fine for remote-mcp specifically).
- `counter-control-plane-api` (Fly) — confirmed genuinely always-on as of ~13:17Z today (see item 4 above); no further changes this session.
- `counter-vault` (Fly) — unchanged this session; still internal-only, always-on.
- The wallet already in use for all of this: **`ctr_wallet_I5rsr86W9WUgbDG_dbcjIA`**, owned by wallet-user `ctr_wallet-user_xabxQmtNuOpQcNB6OelWHw` (Auth0 subject `google-oauth2|116994243602581564639`, the founder's own Google login). Same wallet the prior session created — provisioning is idempotent per Auth0 subject, so repeated real logins keep resolving to this one wallet. **Do not create a new one.**

---

## 2. What's NOT done yet

**The founder has not yet confirmed the `wallet.list` fix works live.** First thing to check when picking this up: ask them to retry (or check yourself if you have a way to) — Claude asking to list/check the wallet through the connector should now return `ctr_wallet_I5rsr86W9WUgbDG_dbcjIA` instead of "not implemented."

**A real purchase through the remote connector has still never been completed.** Phase 3's own verification criterion — "confirm a purchase tool call signs with the correct buyer's key... reaches the same real HTTP path Phase 0 proved" — is not yet met. The connector can log in and make a read-only tool call; it cannot yet buy anything, because:
- No Vault-backed signing key has been generated for this wallet (`VaultSecureKeyStore.generateKey()` in `packages/wallet-domain` — nothing has called this for this wallet yet).
- No mandate has been bound for it under the remote flow (the local/HTTP-path prepaid-mandate binding from Phase 0 is a different wallet-provisioning path; this wallet hasn't been through it).
- Balance/funding status for this specific wallet is unverified — check `PostgresWalletBalanceStore` for `ctr_wallet_I5rsr86W9WUgbDG_dbcjIA` before assuming it needs a top-up.

The prior session wrote a one-off script, `provision-remote-wallet-agent.mjs`, to do all three in one pass (mirroring `apps/local-mcp/scripts/register-buyer-agent.mjs` for key generation and `scripts/issue-and-bind-prepaid-mandate.mjs` for mandate issuance+binding, but using `VaultSecureKeyStore`/`PostgresVaultKeyRepository` instead of `FileSecureKeyStore`). **That script is not in this repo** — it was saved outside it due to a Windows `sftp` bug (see prior handoff's §3) and this session did not locate or recreate it. Whoever picks this up will likely need to rewrite it. Two things to know before doing that:
- Vault (`counter-vault`) has **no public IP** — a local script can't reach it directly. Either run it via `flyctl proxy <local-port>:8200 -a counter-vault` and point `VaultSecureKeyStore` at `http://localhost:<local-port>`, or run the script from inside a Fly machine that already has 6PN access (e.g. `apps/remote-mcp`'s own machine, which already holds a working Vault token).
- `apps/remote-mcp/src/key-store-factory.ts` shows the exact construction pattern (`tenantId: walletId`, `PostgresVaultKeyRepository`) to mirror.

**Phase 4 (wallet-dashboard backend) hasn't been started**, and this session surfaced something that should change its scope conversation: the plan's Phase 4 as written only mentions `apps/wallet-console`'s placeholder data (`wallet-client.ts`). But item 1.6 above found the **same** kind of placeholder stubbing in the MCP tools an AI agent actually calls (`wallet.status`, `merchant.list`, `merchant.search`, `pending-actions.list`) — arguably the more important surface, since that's what a connected buyer's Claude session actually uses, not the web console. **This is a real scope question for the founder, not a decision to make silently:** should Phase 4's new real endpoints (wallet balance, active mandates, transaction history) also get wired into these MCP tools in the same pass, or kept strictly to the console as originally scoped? Surface this before starting, don't assume either way.

---

## 3. Operational notes from this session

- **`flyctl deploy` is still inconsistently blocked by the auto-mode permission classifier** (same as the prior session's own note) — it worked when run directly by this session about half the time, and needed the founder to run it manually the other half, with no obvious pattern predicting which. When blocked, just ask the founder to run the exact command rather than retrying or working around it.
- **A `ScheduleWakeup` call was blocked by the same classifier once**, specifically one whose `prompt` text included the word "deploy" as part of a longer instruction to itself. Plausibly the classifier reacts to prompt *content*, not just the tool being called. If this happens, don't try to route around it — the background task you're already watching will still notify you when it finishes; you don't need the extra scheduled check-in.
- **The `auth0` MCP connector failed to connect this session** (`CONNECTION_CLOSED`) — no Auth0 dashboard access was available via tooling. Directly asking the founder for specific dashboard screens (Attack Protection tabs, a specific log entry's JSON) worked well as a substitute and got real, precise evidence fast — prefer that pattern over trying to reconstruct Auth0-side state from Fly logs alone when the founder is available.
- Requesting a Management API token via `curl` (using the console app's own `AUTH0_CLIENT_ID`/`SECRET` from `.env`) was blocked by the permission classifier before it could even run — didn't end up mattering since the founder's own dashboard access was faster, but worth knowing this path is closed off if a future session considers it.
- **Full monorepo verification** (`format:check`, `lint`, `build`, `typecheck`, `test`) was run clean for both PRs this session, matching the same pre-existing baseline as the prior handoff: `pnpm depcruise` still fails on the known, unrelated Node 24 incompatibility; `apps/merchant-console` still has its one pre-existing `react-hooks/exhaustive-deps` warning. No new regressions.
- A reminder from direct experience this session: **run the full formatter/build/test chain again after EVERY commit**, not just after the first one in a PR — a second commit that only got a scoped `tsc`/`vitest`/`eslint` check (skipping `prettier --write` on the whole diff) failed CI on formatting alone. Cheap to avoid, mildly annoying to fix after the fact.

---

## 4. Starting point for whoever picks this up next

1. **Confirm `wallet.list` actually works live** (item 2 above) — five-minute check, do this first.
2. **Surface the Phase 4 scope question** (item 2's last paragraph) to the founder before writing any code: console-only, or also the MCP tools real agents call?
3. Decide with the founder whether finishing the real end-to-end purchase (provisioning this wallet's Vault key + mandate + confirming balance, then a real `purchase.propose`/`purchase.execute` through the live connector) takes priority over Phase 4, or runs alongside it — `CLAUDE.md`'s own stated default priority ("get one real transaction flowing end-to-end") suggests it might, and Phase 3 isn't fully proven by its own plan-defined verification criteria until that happens.
4. For Phase 4 itself, once scoped: real endpoints in `apps/control-plane-api` for wallet balance (`PostgresWalletBalanceStore.getBalance` + recent `balance_events`), active mandates (`MandateRepository.findActive`), transaction/receipt history (reusing the Phase 2 buyer-notifications projection table). See the plan file for exact detail. Verify each endpoint directly against real Postgres data for `ctr_wallet_I5rsr86W9WUgbDG_dbcjIA`, not a fresh test wallet — it already exists and already has real history to check against.

---

## 5. Documents you can trust vs. re-verify

Per `CLAUDE.md`'s own hierarchy: the **plan file** and **this handoff** are your best current starting points. `COUNTERX-ARCHITECTURE.md`, if present, is stale relative to this and the prior handoff — treat any of its wiring/boot-status claims as needing re-verification against running code. The prior handoff (visible in this file's git history) is superseded on the connector-failure diagnosis specifically (its Attack Protection theory was checked and ruled out this session) but its operational gotchas (§3 in that version) are still accurate and not repeated in full here — read it if you need the Windows `sftp`/heredoc/Vault-seal details again.
