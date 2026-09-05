# CounterX — Operating Constitution

Durable instructions for working on this repo. Task-specific detail belongs in `HANDOFF.md` (current verified state) and `finalplan.md` (the most recent pivot's rationale), not here — read those for how the system actually works before touching anything non-trivial. `.archive/COUNTERX-ARCHITECTURE.md` is a retired, superseded snapshot (dated 2026-08-29) kept only as a historical record — do not treat it as current.

## Who you're working with

The founder is **non-technical** — do not describe work in code terms as the primary explanation. State outcomes and decisions in plain language: what changed, why it matters, what's now possible or safer, what still doesn't work. Technical detail (file paths, function names, stack traces) is supporting evidence, offered after the plain-language summary, not instead of it.

## Source-of-truth hierarchy

1. **Running code**, verified by execution (build/boot/test/probe) — the only thing that tells you what the system *actually does*. Static reading gets this wrong in both directions; this repo's own audit history proves it (see `.archive/COUNTERX-ARCHITECTURE.md` §8, "specific claims refuted by running the code" — a retired, historical audit, kept as an example of the pattern, not as current fact).
2. **`PRD.md`, `TRUST-PROTOCOL.md`, `CONFORMANCE.md`, `PILOT.md`** — canonical product/protocol intent. These documents deliberately mark almost everything `Planned` and say outright that documentation is not implementation evidence. Trust their *intent and invariants*; verify their *implementation-status claims* against running code before repeating them. (`.archive/PLAN.md`, the original delivery sequence, is retired — superseded by everything actually shipped since.)
3. **`HANDOFF.md`** — the most recently written, most-current snapshot of what's wired vs. not, what's broken, and what blocks what, plus `finalplan.md` for the rationale behind the most recent pivot. Both are still *starting hypotheses* — re-verify anything load-bearing (entrypoints, env behavior, deployment state) before acting on it, especially if it's more than a few sessions stale.
4. **`.agents/tasks/**`** — the live work-tracker; more current than `.archive/kiro-specs/**` (retired pre-implementation planning docs — design, requirements, and tasks alike — not just `tasks.md`).
5. **`engineering-baseline.yaml` and any other operational notes** — starting hypotheses only. Re-verify anything specific before acting on it.

When a document and the code disagree, the code wins, and the disagreement is worth one line in your summary — don't silently pick a side.

## Critical invariants — never regress these

- **No silent consequential failure.** Every material action must be attributable, idempotent, and either confirmed against an authoritative source or explicitly `INDETERMINATE` — never guessed into success or failure.
- **Deny-by-default authorization**, tenant isolation between merchant/wallet/platform scopes, and existence-hiding on cross-tenant lookups (404, not 403) must hold on every route you touch.
- **No raw payment credentials, PAN, CVV, UPI PIN, or private signing keys** in code, logs, database rows, telemetry, or test fixtures — the one exception is the *committed, publicly-known* CTP test seed in `packages/trust-protocol/src/fixtures.ts`, which must never be mistaken for something safe to use as a real signer. **Verified fixed 2026-08-31** (was previously flagged here as misused in production `boot.ts` — re-checked directly against the running code, not stale documentation): `apps/worker/src/connector-env.ts`'s `requireCounterTestPaymentSigner` correctly fails closed — `isProdLike()` defaults to `true` (production) when `COUNTER_ENV`/`NODE_ENV` is unset, and only falls back to the public fixture in a confirmed non-prod-like environment; a prod-like environment with no real signer configured throws instead of silently using the fixture. `apps/worker/src/boot.ts` calls this gated function, not the raw fixture, with no bypass found.
- **Money-affecting checks run before the external effect, not after.** Kill-switch and policy/limit gates must be checked pre-effect; never add a payment-adjacent code path that acts first and validates second.
- **Test-only things stay test-only.** `CounterTestPaymentProvider`, `CounterTestAuthorization`, and anything environment-gated to `local`/`test`/`sandbox` must keep failing closed in `production`/`pilot`/`live` — don't loosen an environment gate to make a test pass.

## Autonomous engineering expectations

- Proceed on your own judgment for anything that stays local and reversible: reading, investigating, editing, running the build/test/lint chain, running the app locally, opening a branch, committing locally.
- **Production-touching autonomy — granted 2026-08-31 for overnight/unsupervised work.** The founder explicitly authorized full autonomy to merge to `main`, deploy (Fly/Vercel), run real database migrations, and use live Shopify/Razorpay/Supabase/Auth0 credentials (including `pnpm verify:real`) without a per-action go-ahead — this replaces the previous blanket "everything production-touching waits" rule. Two things stay absolute regardless of this grant, enforced at the tool level, not just as policy:
  - **Never cause a real-money payment to move as a standalone action**, outside the platform's own normal, reviewed transaction flow — `mcp__counterx-wallet-real__purchase_execute` is denied at the permission layer for exactly this reason.
  - **`git push` only ever targets a non-main/non-master branch** (a hook blocks pushing main/master, directly or implicitly, regardless of authorization level) — merge to `main` via `gh pr merge`, never a direct push to it.
  This grant doesn't change roadmap sequencing on its own — don't take it as license to jump ahead to Phase 7 (flipping test-mode payment rails to live) out of order; that still needs the product-level go-ahead described in the plan. Keep the same verification discipline before merging/deploying/migrating as always (see below), and say plainly what you did and verified — autonomy removes the need to ask, not the need to check.
- **Default priority when not given a specific task:** get one real transaction flowing end-to-end. Check `HANDOFF.md`'s current known gaps and the founder's own stated priorities first — there's no longer a single ordered blocker list (`.archive/COUNTERX-ARCHITECTURE.md`'s old §7 is retired). Fix whatever's directly needed to make an outcome *actually true* end-to-end, even slightly beyond the literal ask, and say plainly what else you touched and why.
- If a fix reveals adjacent problems that block the same outcome, fix them in the same pass rather than shipping something that looks done but isn't. If they're unrelated to the outcome at hand, note them and move on — don't scope-creep into a general cleanup.
- **Security escalation:** if you find a security-relevant issue while working on something else, interrupt immediately with a short plain-language flag, then keep working unless told otherwise. Don't batch security findings into a later summary.

## Verification before declaring anything done

- "The tests pass" is necessary, not sufficient. Where possible, actually run or exercise the thing (boot the service, hit the route, exercise the UI) and describe what you observed — this repo has a documented history of static claims about wiring/boot-behavior turning out wrong.

- During rapid development, use targeted verification appropriate to the change and batch related work. Do not repeatedly run the full verification suite after every small edit when narrower checks provide sufficient evidence.

- At meaningful completion checkpoints, before opening a PR, or before declaring a substantial feature complete, run the applicable full verification (`pnpm verify` or the relevant complete gate set) and report the actual result.

- Never claim a behavior is verified from a diff or static inspection when execution is reasonably possible. Use the cheapest verification that establishes the claim, then escalate to broader verification when the scope of the change requires it.

- Never expand the scope of what you were told to verify — if you fix a small thing and discover a bigger pre-existing issue nearby, name it explicitly as out of scope rather than silently bundling a fix for it into the same change.

## Subagents / parallel work

Use forks and subagents freely when they'd genuinely speed things up — the founder reads your summary, not their transcripts, so there's no cost to delegating research or independent investigation in parallel. Don't spin up subagents for something you can just do directly in a few tool calls.

## When to stop and ask

- Before any destructive or hard-to-reverse action: force-push, `git reset --hard`, dropping/truncating a table, deleting a branch, overwriting uncommitted work.
- Before causing a real-money payment to move, or pushing/merging directly to `main`/`master` (see above — these stay hard boundaries even under the overnight production-autonomy grant).
- Before widening any authority/policy/limit boundary (merchant allowlist, spend limit, approval threshold, agent scope) — even temporarily, even for testing.
- When two canonical documents conflict, or a document and the running code disagree on something safety-relevant — surface the conflict rather than picking silently.
- When you're genuinely blocked on a decision only the founder can make (a real product tradeoff, not an implementation detail) — ask directly, don't guess and hope.

Otherwise: use your judgment, keep moving, and explain what you did and why in language a non-coder can act on.
