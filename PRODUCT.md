# Product

<!-- impeccable:product-schema 1 -->

## Platform

web

## Users

**INFERRED, not confirmed by the founder — see note at end of file.**

- **Merchant.** A Shopify store owner who wants their catalog reachable by AI shopping agents (Claude, ChatGPT, etc.) without rebuilding their commerce stack. Arrives already running a real store; the job here is: connect Shopify, connect a payment account, set the rules an agent must sell inside (price ceilings, categories, allowed payment paths), and see what agents have bought. Primary anxiety: losing control to something autonomous — the product's answer is that every rule is enforced before an order exists, not after.
- **Wallet user (buyer).** A person who wants their own AI agent to shop and buy on their behalf, inside limits they set themselves, without handing the agent their card or bank credentials. Arrives already using an AI agent day to day (Claude via MCP is the concrete path this build supports). The job here is: fund a spending balance through a real payment flow, register the agent's key, set a ceiling and merchant allowlist, then trust the agent to transact unattended within that boundary — and see exactly what it did afterward.

## Product Purpose

Counter is the trust and control layer between AI agents and merchants for agent-driven commerce. It lets a merchant become safely transactable by AI agents, and lets a buyer authorize their own agent to spend real money autonomously, inside a cryptographically bounded, revocable, auditable limit — never an open-ended credential handed to a model.

## Positioning

**INFERRED — see note at end of file.**

The mechanism a competitor cannot casually copy: spending authority is a signed mandate (ceiling, merchant allowlist, expiry) that is checked *before* the external effect happens — before the order is created, before money moves — not a policy applied after the fact to detect and reverse overspend. An over-limit purchase is provably declined pre-effect, not refunded post-hoc. This is demonstrated live, not claimed: a purchase inside the mandate succeeds end to end (real Shopify order, real signed receipt); a purchase over the ceiling is rejected before any order exists.

## Operating Context

- A merchant runs a self-serve onboarding wizard: business basics → connect Shopify → review catalog → confirm → go live. Payment-account connection is optional, not a gate to going live (a deliberate scope decision this session — see engineering history, not re-litigated here).
- A wallet user logs in (Auth0), funds a spending balance via a real Razorpay test-mode payment, registers their agent's signing key, and sets a ceiling/allowlist on that agent's authority.
- The buyer's agent (Claude, connected over MCP) then discovers merchants, gets quotes, and executes purchases autonomously, bounded by the signed mandate, with no human approval step per purchase inside the limit.
- Everything in this build runs in test mode: Razorpay test-mode payments, one connected Shopify test store, INR only. No live money moves.
- A known, disclosed limitation the UI must state honestly rather than hide: buyer payments are currently collected centrally, and settlement to a merchant's own account is not yet automated — merchants see a real "pending settlement" figure, not a fabricated "paid out" claim.

## Capabilities and Constraints

- Merchant backend: Shopify only.
- Payment rail: Razorpay, test mode only.
- Currency: INR only.
- Buyer authority: a signed mandate (ceiling, merchant allowlist, expiry) is the unit of authorization — there is no separate standalone "buyer policy" object independent of a mandate.
- Agent interface: MCP (Claude Desktop local connector, and a hosted remote connector reachable from Claude.ai).
- Explicitly out of scope for this build (documented, not silently dropped): device management, security/2FA settings, export/data-portability tooling, approval-inbox workflows, time-triggered purchases, audit log, findings/dispute tooling, merchant suspension tooling, policy simulation, an internal operations console. These are real product ideas, correctly deferred as "coming soon" rather than built shallow.

## Evidence on Hand

- A real Shopify test store, a real Razorpay test-mode account, real Auth0 login — all live and exercised, not mocked.
- A verified end-to-end run exists (this session's engineering history): real wallet top-up, real agent purchase inside a mandate ceiling, real over-ceiling purchase correctly declined before any order was created, real signed receipt.
- No customer testimonials, press, case studies, or third-party proof exist. Do not fabricate any.
- Existing visual implementation (dark theme, `#f97316` orange accent, glassmorphism, floating-cube motifs, `packages/ui` — a shadcn-equivalent component layer already on Radix/CVA/Tailwind) is being treated as **anti-reference for this pass, per explicit founder instruction ("current UI is slop, rework from the beginning")** — evidence of what to move away from, not a constraint to preserve. `packages/ui` itself (the component architecture, not its current visual skin) is kept and extended, not replaced, since three apps already depend on it and it is architecturally sound.

## Product Principles

1. Enforce before the effect, not after — every limit is a pre-purchase gate, never a post-hoc reversal.
2. Never claim settlement, payout, or safety that isn't real; an honest "not yet" beats a comforting fabrication.
3. One component system, three consoles — visual consistency comes from a shared design language, not three independent skins.
4. Design for the operator doing a task (merchant, wallet console) differently from the visitor deciding to act (landing page) — same brand, different mode.
5. Every screen this build ships must be genuinely functional against the real backend; a feature with no real backend is labeled "coming soon," never faked.

---

**Note on how this file was produced:** the founder authorized proceeding without an interview ("go ahead. you know the answers"), which is this project's own accepted path per the design skill's rules for an explicit proceed instruction. Users, Positioning, and the redesign framing above are inferred from this session's own engineering history (verified backend behavior, prior product decisions, and the founder's explicit "rework from the beginning" instruction), not confirmed by direct answer. Anyone revisiting this file should treat the inferred sections as a standing hypothesis, not settled fact, and correct them if they're wrong rather than build further on an uncorrected guess.
