# Final Plan — Razorpay Wallet Demo (Buildathon)

**Written:** 2026-09-04, mid-session. Supersedes crypto as the primary demo path for
today's Razorpay buildathon. `~/.claude/plans/the-mandate-pivot.md` (Phase 3, crypto)
stays the long-term direction and is untouched by this plan — see §6.

## Why this plan exists, in one paragraph

The crypto rail (Solana devnet) got built today — real, tested, three PRs open — but it
has real friction left before demo-day (a faucet rate limit blocking live verification,
an unresolved question about who signs on-chain transfers) and it settles zero real
value in either direction, same as Razorpay's own test mode. For a **Razorpay**
buildathon specifically, a live agent-driven purchase through Razorpay's actual test-mode
checkout — money leaving a buyer's wallet, landing in a merchant's own account, with a
real signed receipt — is a shorter, lower-risk path to a working demo, and it uses the
host's own product. This plan gets there.

## The one trade-off, stated once

Step 1 reverts today's own Phase 2 work and brings back a model where Counter holds a
buyer's balance — the exact thing the founding docs say Counter must never do, and the
exact thing removed earlier today at the founder's own direction. Reviving it for a
demo is a reasonable, deliberate call — a demo isn't a production launch — but it's not
a returned-to-neutral state and shouldn't be mistaken for one later. Don't remove this
paragraph when this plan is checked off.

---

## Step 1 — Revert Phase 2, restoring the prepaid-balance backend

**What this restores, verbatim (confirmed by reading the actual commit — nothing here
is guessed):**
- `apps/control-plane-api/src/wallet-balance-routes.ts` + test — `GET /control/v1/wallets/:walletId/balance`
- `apps/control-plane-api/src/prepaid-balance-mandate-binding-store.ts` + `-routes.ts` + tests — `POST /control/v1/wallets/:walletId/prepaid-mandates`
- Their wiring in `apps/control-plane-api/src/index.ts` / `main.ts`
- `apps/worker/src/boot.ts` / `main.ts` / `real-lifecycle.ts` — the `walletBalanceStore` debit branch in the money seam, restored to its exact prior position (**ahead of** the plain Razorpay branch — same as before, this is what makes a wallet purchase draw from the balance instead of creating a fresh order)
- `apps/worker/src/main-wiring.test.ts`, and the prepaid tests in `real-lifecycle.test.ts`
- `scripts/issue-and-bind-prepaid-mandate.mjs`
- Doc language in `PRD.md`, `PILOT.md`, `CONFORMANCE.md`, `.kiro/specs/counter-agent-wallet/*`, `HANDOFF.md`, and the comment in `apps/control-plane-api/src/mandate-binding-store.ts`

**Confirmed clean — checked before writing this plan:** zero files touched by this
revert have been modified by anything merged since (PR #45 mandate-revoke, PR #46
spend-ledger fix). The revert applies with **no conflicts**.

**Commands:**
```bash
git fetch origin main
git checkout -b revert/phase2-prepaid-balance origin/main
git revert 4f09f1b95deb44a8f82e9d179bb4d6bab5ff484d --no-edit
```

**Verify:**
```bash
pnpm --filter @counter/control-plane-api run build
pnpm --filter @counter/control-plane-api run typecheck
pnpm --filter @counter/worker run build
pnpm --filter @counter/worker run typecheck
pnpm --filter @counter/control-plane-api run test
pnpm --filter @counter/worker run test
```
All of the above should pass exactly as they did before Phase 2 was ever merged — this
is old, already-proven code coming back, not new code.

**One follow-up this step creates:** `HANDOFF.md`, `CONFORMANCE.md`, and the `.kiro`
specs will now read as if Phase 2 never happened (the revert undoes that prose too).
Leave this alone for now — not worth the time before a demo — but flag it in the PR
description so a later session doesn't get confused about which state is "current."

**Do not revert PR #46 (spend-ledger fix) or PR #45 (mandate-revoke) — they are
unrelated and stay exactly as merged.**

---

## Step 2 — Build the one piece that never existed: real self-serve top-up

**Confirmed by searching all of git history before writing this:** no self-serve
top-up UI or route has ever existed in this repo. `topUp()` always had script-only
callers. This step is genuinely new work, not a revival.

**The good news:** the exact pattern already exists, fully built and working, for a
different feature — `apps/onboarding/src/app/mandate/mandate-panel.tsx` (a real
Razorpay Checkout.js integration for recurring-mandate registration) plus its two
backend routes `apps/onboarding/src/app/api/recurring-mandate/route.ts` and
`.../confirm/route.ts`. Mirror this structure exactly; adapt from "recurring
authorization" to "one-time top-up."

**Also confirmed:** `RazorpayTestProvider.verifyClientReturn()`
(`packages/razorpay-adapter/src/razorpay-provider.ts:243`) already implements the
*entire* "verify a Razorpay Checkout.js return" flow — HMAC signature check
(`hmacSha256`, `packages/razorpay-adapter/src/signing.ts`) *and* an authoritative
`GET /v1/payments/:id` re-check. **Do not re-implement signature verification. Call
this method.**

### 2a. Backend: `POST /control/v1/wallets/:walletId/topup/order`

New file `apps/control-plane-api/src/wallet-topup-routes.ts`, mirroring
`wallet-balance-routes.ts`'s existence-hiding/permission pattern:
- Input: `{ amountMinor: string }` (INR paise, validate `> 0` and some sane upper bound,
  e.g. ≤ ₹50,000 for a demo).
- Creates a real Razorpay order via the SAME `RazorpayTestProvider` instance the worker
  already uses (`config.razorpay` in `main.ts` — inject it into this route the same
  way `merchant-payment-connection-store.ts` gets its Razorpay client).
- Returns `{ referenceId, checkout: { razorpayOrderId, razorpayKeyId, amountMinor, currency } }`
  — `razorpayKeyId` is public, safe to return; never return `keySecret`.
- Gate: `identity.scope.manage` (wallet-scoped write), existence-hiding 404 for a
  mismatched wallet — same as every other route in this file family.

### 2b. Backend: `POST /control/v1/wallets/:walletId/topup/confirm`

Same file. Input: `{ razorpayOrderId, razorpayPaymentId, razorpaySignature }`.
1. Call `razorpayProvider.verifyClientReturn({ queryParams: { razorpay_order_id, razorpay_payment_id, razorpay_signature }, receivedAt })`.
2. If `kind !== "verified"` → 400, do NOT credit anything.
3. If verified, call `walletBalanceStore.topUp({ walletId, reference: razorpayPaymentId, amountMinor: <from the verified evidence, never from client input>, currency: "INR" })`.
4. Return the new balance.

**Security note to carry into the code comment:** the credited amount MUST come from
Razorpay's own verified response, never from what the client claims — otherwise a
buyer could top up ₹10 and tell the server they paid ₹10,000.

### 2c. Wire into `apps/control-plane-api/src/index.ts` / `main.ts`

Same conditional-registration pattern as every other optional route in this repo
(`if (options?.walletTopupRoutes !== undefined) { ... }` in `index.ts`; construct in
`main.ts` alongside `walletBalanceStore`, which Step 1 already restored).

### 2d. Frontend: `apps/wallet-console/src/app/wallet/topup/page.tsx`

Server component resolving `walletId` from session (copy the exact pattern from
`connect/page.tsx` / `mandates/page.tsx`), rendering a new client component
`topup-panel.tsx` that is `mandate-panel.tsx` adapted:
- Drop `recurring: 1` from the Razorpay options object (this is a one-time payment).
- Drop the UPI-specific phone-number field; keep the amount field.
- POST to `/api/wallet/topup` (begin) and `/api/wallet/topup/confirm` — two new
  Next.js route handlers in `apps/wallet-console/src/app/api/wallet/topup/`, each a
  thin proxy exactly like every other wallet-console API route this session already
  built (`api/mandates/route.ts` is the closest template — session resolution,
  `NAMESPACE` scope decode, forward to control-plane-api).
- Use plain `auth0.getAccessToken()`, NOT the step-up helper — topping up your own
  wallet with your own money is not a mandate/authority action. (Confirm this
  assumption against `packages/authorization/src/assurance.ts`'s permission catalog
  before shipping — if `identity.scope.manage` already requires step-up, match that;
  don't invent a new permission tier under time pressure.)
- On success, show the new balance and a link back to `/connect` or `/mandates`.

**Verify:** `pnpm --filter @counter/wallet-console run typecheck && run lint`, then a
real click-through — enter an amount, complete Razorpay's test-mode checkout (test
card `4111 1111 1111 1111`, any future expiry, any CVV — Razorpay's own documented
test card), confirm the balance updates.

---

## Step 3 — Register a demo agent with a durable key

**The problem, confirmed today:** the founder's existing wallet-console-registered
agent (`ctr_agent_9Z5RUEWn97HmljKse1_3Dw`) signed its mandate with a browser key that
is deliberately discarded after signing. There is no private key left to sign a *new*
purchase as that agent. This blocks a live demo purchase regardless of which rail is
used — it is not specific to crypto.

**Fix — use the CLI path, which keeps its key on disk (restored by Step 1):**
```bash
node apps/local-mcp/scripts/register-agent-self-serve.mjs
```
Follow its prompts (it will mint a setup token against the founder's real wallet and
print a new `agentId`). This uses `FileSecureKeyStore` — the key persists at
`~/.counter/wallet-keys.enc.json`, encrypted, reusable for signing real purchases.

Then bind a real mandate to the prepaid balance for this new agent:
```bash
node scripts/issue-and-bind-prepaid-mandate.mjs
```
(Restored by Step 1. Follow its prompts — wallet id, the new agent id, a ceiling,
merchant allowlist.) This produces a real, durable `WalletMandate` bound to
`prepaid-balance:<walletId>`, signed with the CLI agent's own durable key.

**Verify:** query `wallet.mandates` for the new mandate (same pattern used earlier
today — `SELECT * FROM wallet.mandates WHERE agent_id = '<new agent id>'`), confirm
`payment_reference_id = 'prepaid-balance:<walletId>'` and `status = 'active'`.

---

## Step 4 — Fund the demo wallet for real

Through the UI built in Step 2: log into wallet-console as the founder, go to
`/wallet/topup`, top up a real amount (e.g. ₹2,000) via Razorpay's test checkout.
Confirm via `GET /control/v1/wallets/:walletId/balance` (or a quick DB check on
`wallet.balances`) that the balance actually reflects the top-up before moving on —
don't assume the UI succeeded silently.

---

## Step 5 — Run one real purchase, live, start to finish

Using the agent from Step 3 (durable key, real mandate bound to the now-funded
balance), drive a real `purchase.execute` call through `apps/local-mcp` — this is the
same MCP tool surface a buyer's actual AI assistant would use. Check
`apps/local-mcp/README.md` or its own `scripts/` directory for the exact CLI/REPL
invocation this repo already supports for a manual test call; if none exists, the
fastest path is a small one-off script mirroring `scripts/verify-real-transaction.mjs`'s
pattern but going through `apps/local-mcp/src/tools/write-tools.ts`'s real handler
instead of calling the worker directly — reuse, don't rewrite, the CTP intent-signing
code already in that file.

**What this should produce, exactly like `verify-real-transaction.mjs` already proved
today:** a real Shopify draft order → finalized → marked paid, a real Razorpay
test-mode order, the wallet's balance debited by the purchase amount, and a signed CTP
receipt. If the purchase amount exceeds the mandate's ceiling or the wallet's
remaining balance, confirm it's correctly **declined** before any Shopify order is
created — that's the safety property worth showing off in the demo, not just the
happy path.

**This is the actual demo moment.**

---

## Step 6 — Archive crypto, don't delete it

- Leave PR #47 (`feat/crypto-adapter-solana`), the mandate-revoke PR chain, and the
  unmerged `feat/wire-solana-settlement-v2` branch exactly as they are — pushed, real,
  tested, mergeable later. Do not close or delete them.
- Stop spending time on it for today specifically: no more devnet faucet retries, no
  live over-cap verification, no further worker-wiring polish, unless Steps 1–5 finish
  with real time to spare before judging.
- One small frontend addition, low-risk: a "Crypto settlement — coming soon" note.
  Simplest honest placement: a disabled/greyed card on the wallet-console dashboard
  (`apps/wallet-console/src/app/page.tsx`'s `QUICK_ACTIONS` list already has the right
  shape — add a fifth entry, disabled, with that label) or a small badge on the
  landing page if one exists (`apps/landing`). Keep it to a few lines — this is
  framing, not a feature.

---

## Step 7 — Verification and merge

Once Steps 1–5 are demonstrated working live:
```bash
pnpm verify
```
Full gate, same discipline as every other merge today. Open one PR for the revert
(Step 1) and a second for the new top-up feature (Step 2) — keep them separate so the
revert's own history stays legible. Merge both via `gh pr merge`, never a direct push
to `main`.

---

## Step 8 — Demo runbook (for the actual live walkthrough)

1. Open wallet-console, log in, show the existing mandate from `/mandates` (already
   real, from earlier today).
2. Go to `/wallet/topup`, add ₹2,000 via Razorpay's real test checkout — narrate: "this
   is Razorpay's actual test-mode payment flow, same one a real production checkout
   would use."
3. Run the Step 5 purchase live (terminal, or a small demo page if time allows) —
   narrate: "the AI agent is now spending within the limit the human set, no human in
   the loop for this step."
4. Show the resulting real Shopify order and the signed receipt.
5. Attempt a second purchase that exceeds the remaining balance or the mandate's
   ceiling — show it get declined *before* any order is created. This is the actual
   safety story: the agent cannot overspend, and the check happens before anything
   external happens, not after.
6. Close with the crypto "coming soon" note — one sentence: "this same mandate model
   is designed to also settle directly on-chain, non-custodially, with no payment
   gateway at all — that's the direction, built and tested (name the PR), just not
   today's demo."

---

## Cross-cutting notes

- Every claim in this plan about "confirmed," "restored," or "no conflicts" was
  checked directly against the repo before writing this file, not assumed — the exact
  commit SHA, exact file lists, and exact existing code to mirror are named above so
  nothing here needs re-deriving.
- The two absolute boundaries still apply throughout: never cause a real-money payment
  to move as a standalone action outside the platform's own reviewed flow (Razorpay
  test mode moves no real money, so this doesn't apply to Steps 2–5, but does apply
  the moment anyone points this at live credentials); `git push` only ever targets a
  non-main branch, merge via `gh pr merge`.
