# Counter

**Give your AI agent a real budget, and let it actually buy things — safely.**

Set a spending limit. Connect your AI assistant. It shops for you, on its own, and it is architecturally incapable of spending past what you allowed. Every purchase is checked against your limit *before* it happens — never after, never as a hopeful retry.

---

## How it works

1. **You set the limit.** Sign a spending mandate — a maximum per purchase, which merchants are allowed, how long it's valid — with your own key, from your own browser.
2. **You add funds.** A real payment, through Razorpay, funds the amount your agent is allowed to spend.
3. **Your agent shops.** Connected over MCP, your AI assistant can browse, quote, and buy — no approval click needed for each purchase, because the limit itself *is* the approval.
4. **The limit holds, every time.** Try to spend more than what's left, and the purchase is declined before any order is created and before any money moves. Not a soft warning — a hard stop, checked first.

## What's real here

Not a mockup, not fixtures. Everything below runs against live infrastructure:

- A real Razorpay checkout funds your agent's spending limit — a real payment, a real signature check, a real balance update.
- A real Shopify store is what your agent actually buys from.
- Your agent signs its own purchases with its own key. Counter independently re-verifies that signature every time — it never just trusts a client's word.
- Try to overspend, and it's rejected *before* an order exists — the actual safety property this whole system is built around, not a footnote.
- Any MCP-compatible AI assistant (Claude, or anything else that speaks the protocol) can connect and use this directly: check a balance, get a quote, execute a purchase.

## Where this is going

The spending-mandate model is rail-agnostic by design — it binds a limit, an allowlist, and an expiry, never a specific payment mechanism. A direct wallet-to-wallet settlement path on Solana is already built and tested in this repo: no intermediary holding funds even briefly, agent and merchant settle directly. That's the direction this is headed.

## Under the hood

Every purchase passes through one shared, signed protocol — a canonical envelope for identity, mandates, purchase intent, and receipts — so a purchase's evidence means the same thing no matter which payment rail or merchant backend handled it. Policy checks run strictly before any external effect: a purchase either gets confirmed against an authoritative source, or it's explicitly reported as declined or pending — never guessed into a false success.

A pnpm/TypeScript monorepo: a job worker that owns the only real money-movement path, a merchant-facing runtime API, hosted and local MCP servers, and console apps for both sides of the transaction. Real Postgres, real Auth0 identity, dependency boundaries enforced between packages, 2,800+ tests, zero lint warnings.

---

**License:** All rights reserved — see [`LICENSE`](./LICENSE). No reuse, redistribution, or derivative use without explicit written permission.
