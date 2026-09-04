# Counter

**A non-custodial control plane for AI agents to buy real things from real merchants — inside limits a human cryptographically signed, with Counter never touching the money.**

India-first, protocol-neutral, real infrastructure throughout (real Shopify store, real Razorpay test-mode payments, real Auth0 identity, real Postgres) — not a mockup.

> **License:** All rights reserved — see [`LICENSE`](./LICENSE). No reuse, redistribution, or derivative use is permitted without explicit written permission.

---

## What this is

Counter connects three things that normally don't trust each other automatically:

- **A merchant**, who wants to be safely transactable by AI agents without rebuilding their commerce stack.
- **A buyer's AI agent**, which needs to spend real money on the buyer's behalf, but only within limits the buyer actually set.
- **A payment rail**, which needs proof that a purchase is authorized before it moves money.

The core idea is a **mandate**: a cryptographically signed, human-issued document that says exactly what an agent may spend, where, and until when — never a payment method Counter itself holds. Every purchase is checked against that mandate, before any external effect happens, and the outcome is never guessed: it's either confirmed against an authoritative source or explicitly reported as pending, declined, or indeterminate. Silent failure is the one thing this system is built not to do.

## What's actually real here

This isn't a demo built on fixtures. As things stand today:

- A buyer can register a wallet, generate a real Ed25519 signing key, and sign a real spending mandate — through an ordinary browser login, no engineer touching a database.
- A wallet can be funded through a **real Razorpay test-mode checkout** (test card, real HMAC-verified payment, real database credit).
- An AI agent, using its own real key, can sign a real purchase intent and execute a **real purchase against a real Shopify test store**, debiting the funded balance under the worker's actual production policy (spend limits, revocation checks, mandate expiry) — not a bypassed test path.
- A purchase that would exceed the remaining balance or the mandate's ceiling is **declined before any order is created or any money moves** — the actual safety property this whole system exists to prove.
- The MCP (Model Context Protocol) tool surface is wired to real infrastructure end to end — an AI assistant connected via MCP can check a wallet's real balance and mandates, get real product quotes, and execute real purchases.

Everything above was independently verified by actually running it — hitting real endpoints, checking real database rows, not reading code and assuming it works. See [`HANDOFF.md`](./HANDOFF.md) for the most recent verified state and [`finalplan.md`](./finalplan.md) for the reasoning behind the current setup.

A parallel, non-custodial settlement path — direct on-chain wallet-to-wallet transfer on Solana, with no payment gateway and no custody on either side — is built and tested on `feat/wire-solana-settlement-v2` and PR #47, and is the intended longer-term direction once ready for a live demo.

## Architecture, in one paragraph

A canonical domain core sits under a versioned trust protocol (**CTP** — Counter Trust Protocol: signed envelopes for identity, mandates, intents, quotes, policy decisions, and receipts), under a bilateral policy engine, under an orthogonal transaction state machine, with adapters at every external boundary (Shopify, Razorpay, Auth0) and evidence/reconciliation at the end of every flow. Money-affecting checks always run **before** the external effect, never after — enforced as an architectural invariant, not a convention. Full detail: [`PRD.md`](./PRD.md) (product definition), [`TRUST-PROTOCOL.md`](./TRUST-PROTOCOL.md) (the signed-envelope contract), and [`COUNTERX-ARCHITECTURE.md`](./COUNTERX-ARCHITECTURE.md) (a periodically-refreshed, execution-verified snapshot of what's actually wired versus merely written).

## Repository layout

A pnpm monorepo, TypeScript throughout, strict ESM.

**`apps/`** — 12 deployable services and consoles:
| App | What it is |
|---|---|
| `control-plane-api` | Merchant + wallet configuration API — enrollment, policy, mandates, keys |
| `worker` | The job loop and the only real money-movement path (the "money seam") |
| `agent-runtime` | The merchant-facing runtime API a buyer's agent actually transacts against |
| `remote-mcp` | Hosted, OAuth-authenticated MCP server — the one URL a real AI host (e.g. a Claude Connector) connects to |
| `local-mcp` | stdio MCP server for a buyer's own machine, holding their real signing key |
| `wallet-console` | Buyer-facing web app — connect an agent, manage mandates, top up, view activity |
| `merchant-console` | Merchant-facing web app |
| `operations-console` | Internal operations tooling |
| `onboarding` | Public self-serve signup for wallet creation |
| `landing` | Marketing site |
| `reference-buyer` / `reference-services` | Conformance-testing harnesses (a scripted buyer, a fixture merchant backend) |

**`packages/`** — 26 shared libraries: domain types, the trust protocol implementation, policy engine, payment-provider adapters (Razorpay, Shopify, a Solana crypto adapter), data access, authorization, and the shared UI kit. `dependency-cruiser` enforces the boundaries between them (e.g. merchant packages never import wallet packages).

## Getting started

Requires Node `>=22.14.0` and `pnpm@9.15.4` (pinned via `packageManager` in `package.json`).

```bash
pnpm install
cp .env.example .env   # fill in real credentials to exercise anything beyond unit tests
pnpm build
pnpm test
```

Common scripts (see `package.json` for the full list):

```bash
pnpm verify        # format:check + lint + build + typecheck + depcruise + test — the full gate
pnpm dev           # not a single command — each app under apps/*/ has its own dev script
pnpm db:migrate    # apply Postgres migrations (needs DATABASE_URL)
pnpm verify:real   # runs ONE real end-to-end transaction against live Shopify + Razorpay test-mode credentials
```

Real infrastructure (Shopify, Razorpay, Auth0, a Postgres database — Supabase in this deployment) is required for anything beyond unit tests. `.env.example` documents every variable; nothing beyond that file's placeholders is needed to get unit tests and builds passing.

## Documentation map

| Document | What's in it |
|---|---|
| [`PRD.md`](./PRD.md) | Canonical product definition — what Counter is, isn't, and why |
| [`PILOT.md`](./PILOT.md) | Pilot scope and constraints |
| [`TRUST-PROTOCOL.md`](./TRUST-PROTOCOL.md) | The CTP signed-envelope contract |
| [`CONFORMANCE.md`](./CONFORMANCE.md) | A claims register — what's `Planned`, `In Progress`, or `Verified`, with an evidence bar for each |
| [`COUNTERX-ARCHITECTURE.md`](./COUNTERX-ARCHITECTURE.md) | What's actually wired vs. merely written — refreshed by execution, not by re-reading code |
| [`HANDOFF.md`](./HANDOFF.md) | The most recent session's verified state and what's next |

This project's documentation deliberately defaults every claim to `Planned` until it's been proven by running it — "documentation is not implementation evidence" is a stated principle here, not a disclaimer. Where a document and the running code disagree, the code is treated as correct.

## Verification discipline

`pnpm verify` runs the full gate: formatting, lint, build, typecheck, dependency-boundary checks, and the test suite (2,800+ tests). Beyond that, this project's own history is built on a rule worth stating plainly: a static read of source code is not sufficient evidence that something works — an early audit of this exact codebase found ~30,000 lines of fully-tested application logic that was never actually reachable at runtime. Everything described as "real" in this README was confirmed by actually executing it against live infrastructure, not by reading the code that claims to do it.
