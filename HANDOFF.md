# Counter — Session Handoff Document

> **Purpose:** Hand off exact working context to a fresh Claude Code session picking up on `~/.claude/plans/the-mandate-pivot.md`. Self-contained. No secrets committed here — they live in `.env`/`apps/wallet-console/.env.local` (both gitignored) and Fly secrets.
>
> **Written:** 2026-09-04, at the close of Phases 1 AND 2 (both shipped the same day). **Everything below was true when written; re-verify anything load-bearing** (per `CLAUDE.md`'s own source-of-truth hierarchy).

---

## 0. Read this first

The **real plan** is `~/.claude/plans/the-mandate-pivot.md` (supersedes `federated-enchanting-wave.md`, whose Phase 4 shipped). **Phases 1 (Unblock) and 2 (retire the prepaid balance) are both closed** — Phase 1 verified end to end against a real browser login, not statically; Phase 2 verified by booting the compiled server and inspecting the built worker artifact. The next session's job is **Phase 3: build the crypto rail — which opens with a founder decision (which chain), not with code.** See §4a.

**Phase 1's own bar, met in full:** *"a real, ordinary Auth0 login (not an operator script) should be able to reach all the way through — log in, pass step-up, register an agent key, create a mandate with real guardrails — with no engineer touching the database directly."*

On 2026-09-04 the founder did exactly that in a browser, twice, and two real mandates landed:

| mandate_id | agent_id | wallet_id | ceiling | policy_version_id |
|---|---|---|---|---|
| `ctr_mandate_ocIdROugqF1yWZTW6N3-aw` | `ctr_agent_9Z5RUEWn97HmljKse1_3Dw` | `ctr_wallet_I5rsr86W9WUgbDG_dbcjIA` | ₹2000/txn | `wallet-console-v1` |
| `ctr_mandate_q9Y68-rEc2R6oOstNLgkYg` | `ctr_agent_EU2NmNiM49z2sbHPB797iA` | `ctr_wallet_I5rsr86W9WUgbDG_dbcjIA` | ₹2000/txn | `wallet-console-v1` |

`policy_version_id: wallet-console-v1` is the tell that these came from the self-serve UI — every prior mandate in that table is `cli-v1`, i.e. an engineer running a script. That distinction *is* Phase 1.

---

## 1. The last blocker, and why the first diagnosis of it was wrong

The `/connect` flow 403'd on `/api/setup-token` even after real MFA completed. The previous session's recorded root cause — *"`auth0.getAccessToken()` needs an explicit `audience`"* — **was wrong, and the fix it produced was a no-op.** Both are worth writing down, because the wrong version is superficially convincing.

**What is actually true** (read directly out of `@auth0/nextjs-auth0@4.27.0`'s source, then confirmed live):

1. `mfa.challengeWithPopup()` runs a full authorization-code flow in a popup. Its callback calls `mergePopupTokenIntoSession()` (`dist/utils/session-helpers.js`), which **appends** the elevated token to `session.accessTokens[]` keyed by audience and **deliberately leaves `session.tokenSet` — the login-time token — untouched**, so the user's MRRT/refresh tokens survive the popup.
2. The read path (`#getTokenSetFromSession`, `dist/server/auth-client.js`) short-circuits:
   ```js
   isAudienceTheGlobalAudience = !audience || audience === (tokenSet.audience ?? authorizationParameters.audience)
   isScopeTheGlobalScope       = !scope    || compareScopes(...)
   if (both) return tokenSet          // top-level = the STALE login token
   ```
   `session.accessTokens[]` is consulted (via `findAccessTokenSet`) **only when the requested audience/scope differ from the global ones.**
3. This app's popup uses *exactly* the global audience and scope (`lib/auth0.ts`: `https://api.counter.dev`, `openid profile email wallet:read wallet:write`) — which is also what control-plane-api verifies. So the short-circuit always fires. **Passing `{ audience: "https://api.counter.dev" }` explicitly changes nothing**, because that is already the global value.

**The fix:** `apps/wallet-console/src/lib/step-up-token.ts` reads the audience-matched, unexpired entry out of `session.accessTokens[]` directly (a documented field on the public `SessionData` type), falling back to `auth0.getAccessToken()`. Both `/api/setup-token` and `/api/mandates` use it. `step-up-token.test.ts` guards the regression — the first test fails if anyone simplifies it back to a bare `getAccessToken()`.

**Proof it works** (dev-server log, real login):
```
[setup-token] token source=step-up-popup assurance=step_up
[mandates]    token source=step-up-popup assurance=step_up wallet=ctr_wallet_I5rs... agent=ctr_agent_EU2N...
```
Those log lines are permanent and deliberate — public identifiers only, no token material. They are the fastest way to diagnose the next 403.

**Second blocker, found in the same pass:** the Agent ID field was mandatory and expected an ID printed by `apps/local-mcp/scripts/register-agent-self-serve.mjs` — i.e. the flow could not be completed without first running a CLI script, exactly the dependency Phase 1 exists to remove. But `registerAgentKey` (control-plane-api) already mints a real, active, wallet-owned agent as part of registering the consent key. The field is now **optional** and defaults to that agent. Server-side `agentOwnershipCheck` is unchanged and still independently verifies whatever is submitted.

---

## 2. What's done (Phase 1, all merged)

1. **1.1 — recurring-charge credential routing (PR #39).** `apps/worker/src/boot.ts` passes `effectiveRazorpayCreds` (merchant-resolved) to `createRealRazorpayRecurringMandateProvider`, not the raw env pair. Test in `boot.test.ts` fails if reintroduced. Single-pilot-merchant assumption documented in a code comment, not silently assumed.

2. **1.2 — Auth0 step-up assurance.** Code merged in PR #39; the tenant itself needed **four** separate live fixes, none of which live in git — see §3. Post-Login Action `b61c2ea0-054f-45f7-81a4-c99a12b2eba0` (tenant `dev-jzw3etjxnn3svs56`) is at version 4, `all_changes_deployed: true`, and now computes real assurance from `event.authentication.methods` and explicitly calls `challengeWithAny()`/`enrollWithAny([{type:"otp"}])`.

3. **1.3 — self-serve `/connect` flow.** `apps/wallet-console/src/app/connect/` — real, not mocked: step-up via `mfa.challengeWithPopup()`, in-browser Ed25519 consent keypair (never leaves the tab), key registration via `/api/setup-token` + `/api/agent-keys`, then `buildMandateEnvelope` + `signEnvelope` client-side and submission via `/api/mandates`. `mandate-binding-store.ts` carries an **INTERIM BINDING RULE** (accepts a mandate whose `payment_authorization_ref` matches no provider mandate) compensated by a new `agentOwnershipCheck`. Getting here also required making `packages/trust-protocol` and `packages/domain` browser-safe (`@noble/hashes` + hand-written base64url; `Buffer` in `domain/src/ids.ts` was missed by the original grep and hotfixed in PR #41).

---

## 3. Auth0 tenant config is invisible to git — read this before touching Auth0

Four of Phase 1's fixes exist **only in the live tenant**, not in any file in this repo:
- The Post-Login Action's source (assurance computation + the explicit MFA challenge call).
- `enrollWithAny` factor list must be `otp` only — `"email"` is not a valid Auth0 factor type (confirmed by a real log error).
- Tenant toggle **Security → Multi-factor Auth → Additional Settings → "Customize MFA Factors using Actions"** must be **ON**, or you get `"MFA customized via PostLogin action but feature is not enabled"` with everything else correct.
- The tenant MFA policy is deliberately **"Never"** — MFA is meant to fire only for the specific high-value actions that request it, not on every login.

There is no committed source of truth for any of this beyond this document and the live tenant. Reproducing it elsewhere (staging, a second environment) means redoing it by hand.

**`mcp__auth0__auth0_list_logs` / `auth0_get_log` were the decisive tool all session** — every wrong hypothesis was refuted by reading real logs, not by reasoning about code. Use them first for anything Auth0-shaped.

---

## 4. Phase 2 — retire the prepaid balance model: DONE

Shipped 2026-09-04, same day as Phase 1. Counter now has **no runtime code path that funds, reads, or debits a balance it holds.**

**Removed from control-plane-api:** `wallet-balance-routes.ts`, `prepaid-balance-mandate-binding-store.ts`/`-routes.ts`, all six of their tests, and their `index.ts`/`main.ts` wiring — i.e. `GET /control/v1/wallets/:walletId/balance` and `POST /control/v1/wallets/:walletId/prepaid-mandates`. Verified by execution, not by reading source: the compiled server was booted with every remaining optional feature wired and `printRoutes()` asserted on — both routes absent, `GET /control/v1/wallets/:walletId/mandates` still present.

**Removed from the worker's money seam** — this went beyond the plan's own file list, on the founder's explicit decision, and is the part that mattered. `apps/worker/src/main.ts` constructed `PostgresWalletBalanceStore` **unconditionally** whenever a database was configured, and `real-lifecycle.ts`'s debit branch sat **ahead of** the Razorpay path, so any wallet-scoped purchase with no `paymentReferenceId` was drawn from the stored pot first. Since `topUp()` had no callers and `debit()` treats a missing row as `0n`, that path returned `INSUFFICIENT_BALANCE` → `declined(...)` instead of falling through to the real Razorpay one-shot path — i.e. it was silently *breaking* those purchases, not just being unused. Removing it restores the Razorpay path. Confirmed absent from `apps/worker/dist` after a rebuild. `main-wiring.test.ts` (3 tests, existed solely to guard that wiring) and `real-lifecycle.test.ts`'s prepaid describe block (4 tests) were deleted with it.

**Also deleted:** `scripts/issue-and-bind-prepaid-mandate.mjs`, which dynamic-imported the removed `dist/` modules — neither `pnpm typecheck` nor `pnpm test` covers it, so it would have broken silently.

**Deliberately kept and now wired to nothing:** `PostgresWalletBalanceStore`, `packages/data/src/wallet-balance-store.ts`, its export, its integration test, and migration `0021-wallet-prepaid-balance`. The `wallet.balances`/`wallet.balance_events` tables and every row in them are untouched. **Whether to write a real down-migration or drop the tables is an open decision — deliberately not taken here.**

**Docs updated alongside** (`PRD.md` §14.1, `PILOT.md` "Payment authority", `.kiro/specs/counter-agent-wallet/{requirements,design}.md`, `CONFORMANCE.md` §6.6 + §12). `CONFORMANCE.md`'s x402 slot moved from parked to actively-being-designed *without* claiming evidence — it enumerates all five of that section's own requirements as unmet. One now-false line in the dated Vault decision record (`design.md`'s blast-radius bullet, which still listed "real-time balance checks at debit time" as an existing defense layer) is annotated as superseded rather than rewritten, so the record keeps its as-of state.

**Gates:** `lint`, `build`, `typecheck` and the full test suite all pass. Two local-only failures remain and are unrelated — see §5.

---

## 4a. What's next: Phase 3 — build the crypto rail

**Blocked on one decision only the founder can make: which chain.** Do not write chain-specific code before it's settled.

The plan recommends **Solana devnet** for a concrete reason worth re-checking rather than assuming: Solana account keys are natively Ed25519, the same scheme this codebase's CTP mandate signing already uses — `connect-panel.tsx` generates a 32-byte Ed25519 seed via `crypto.getRandomValues`, which is byte-for-byte the shape of a Solana keypair seed. **The signature schemes matching is confirmed; whether one key can safely serve BOTH the mandate-signing and on-chain-account roles is NOT — verify against this codebase's actual mandate-signature construction before committing.** The alternative (an EVM testnet on secp256k1) has broader tooling and stablecoin liquidity but needs genuinely new key-custody work.

Then build, per the plan: a `packages/crypto-adapter` connector following the existing `razorpay-adapter`/`shopify-connector` pattern (typed port, real RPC client, idempotency, timeout→indeterminate semantics); wallet-address provisioning tied to buyer identity; the mandate → on-chain scoped-authorization mapping (genuinely new design work); real settlement from `purchase.execute`, keeping the kill-switch and spend-ledger checks exactly where they are pre-effect; and a "connect your receiving wallet address" step in the merchant wizard.

**Worth doing first, and cheap:** there is still no screen anywhere that shows a buyer their existing mandates — `wallet-console` has no `GET` route for them at all. Two real mandates exist today and the only way to see them is a database query. That's nominally Phase 4 work, but it would make Phase 3 far easier to trust while building.

---

## 5. Known gaps and warts (none block Phase 3)

- **No authenticated live `GET` readback was performed.** The two mandates were verified by reading `wallet.mandates` directly (a *read*; nothing was hand-edited) and by confirming `PostgresMandateRepository.findActive`'s filter (`environment='test' AND wallet_id=? AND status='active'`) matches both rows exactly — so `GET /control/v1/wallets/:walletId/mandates` would return them. An actual HTTP readback was not possible: the `AUTH0_MCP_CLIENT_ID` M2M client is not granted `client_credentials`, and granting it would widen authority — a founder decision, not an implementation detail. `wallet-console` also has **no `GET` route for mandates at all**, so the console cannot display existing mandates yet.
- **A failed mandate submission leaves an orphan agent + key.** `/api/agent-keys` succeeds before `/api/mandates` is attempted, so a rejected mandate still leaves a registered, active, wallet-owned agent behind (four exist for the founder's wallet from five attempts). Harmless — the agent is owned by the buyer's own wallet — but untidy.
- **`apps/onboarding` has three bare `auth0.getAccessToken()` calls** (`api/recurring-mandate/route.ts`, `.../confirm/route.ts`, `api/setup-token/route.ts`). They will hit the same stale-token bug the moment that app introduces a step-up popup. Not currently broken; not fixed, because that app has no step-up flow today.
- **Vercel deploy rate limit** was exhausted ~2026-09-04 and should clear ~2026-09-05. Phase 1 was verified on `http://localhost:3000` only — **it has not been re-confirmed on the deployed domain.** Do that when the limit clears.
- **`COUNTERX-ARCHITECTURE.md`'s Auth0/console sections are known stale** and carry an explicit flag at the top pointing here. It still claims wallet-console is "100% MockWalletClient" and Auth0 is "stubbed on every console" — both false.
- **Local `pnpm format:check` fails on two untracked files** (`.impeccable/hook.cache.json`, `docs/the-mandate-pivot.html`). Neither is committed, so CI is unaffected; the rest of the gate passes.

---

## 6. Documents you can trust vs. re-verify

Per `CLAUDE.md`'s hierarchy: the **plan file** and **this handoff** are the best current starting points. `COUNTERX-ARCHITECTURE.md` is stale on consoles/Auth0 (see above). `.kiro/specs/**/tasks.md` is stale for completion status. Prior handoffs (git history of this file) cover Phase 4 and earlier — still accurate for that scope, superseded here on what's next.
