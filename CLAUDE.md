# CounterX — Operating Constitution

Durable instructions for working on this repo. Task-specific detail belongs in `COUNTERX-ARCHITECTURE.md`, not here — read that file for how the system actually works before touching anything non-trivial.

## Who you're working with

The founder is **non-technical** — do not describe work in code terms as the primary explanation. State outcomes and decisions in plain language: what changed, why it matters, what's now possible or safer, what still doesn't work. Technical detail (file paths, function names, stack traces) is supporting evidence, offered after the plain-language summary, not instead of it.

## Source-of-truth hierarchy

1. **Running code**, verified by execution (build/boot/test/probe) — the only thing that tells you what the system *actually does*. Static reading gets this wrong in both directions; this repo's own audit history proves it (see `COUNTERX-ARCHITECTURE.md` §8, "specific claims refuted by running the code").
2. **`PRD.md`, `PLAN.md`, `TRUST-PROTOCOL.md`, `CONFORMANCE.md`, `PILOT.md`** — canonical product/protocol intent. These documents deliberately mark almost everything `Planned` and say outright that documentation is not implementation evidence. Trust their *intent and invariants*; verify their *implementation-status claims* against running code before repeating them.
3. **`COUNTERX-ARCHITECTURE.md`** — the last verified snapshot of what's wired vs. not, what's broken, and what blocks what. Re-verify anything load-bearing before relying on it if it's more than a few sessions stale — the system changes.
4. **`.agents/tasks/**`** — the live work-tracker; more current than `.kiro/specs/**/tasks.md`, which is stale and should not be trusted for completion status.
5. **`HANDOFF.md`, `engineering-baseline.yaml`, and any other operational notes** — starting hypotheses only. Re-verify anything specific (entrypoints, env behavior, deployment state) before acting on it.

When a document and the code disagree, the code wins, and the disagreement is worth one line in your summary — don't silently pick a side.

## Critical invariants — never regress these

- **No silent consequential failure.** Every material action must be attributable, idempotent, and either confirmed against an authoritative source or explicitly `INDETERMINATE` — never guessed into success or failure.
- **Deny-by-default authorization**, tenant isolation between merchant/wallet/platform scopes, and existence-hiding on cross-tenant lookups (404, not 403) must hold on every route you touch.
- **No raw payment credentials, PAN, CVV, UPI PIN, or private signing keys** in code, logs, database rows, telemetry, or test fixtures — the one exception is the *committed, publicly-known* CTP test seed in `packages/trust-protocol/src/fixtures.ts`, which must never be mistaken for something safe to use as a real signer (see the architecture doc §5 — it's currently misused that way in production `boot.ts`; know this before touching payment evidence).
- **Money-affecting checks run before the external effect, not after.** Kill-switch and policy/limit gates must be checked pre-effect; never add a payment-adjacent code path that acts first and validates second.
- **Test-only things stay test-only.** `CounterTestPaymentProvider`, `CounterTestAuthorization`, and anything environment-gated to `local`/`test`/`sandbox` must keep failing closed in `production`/`pilot`/`live` — don't loosen an environment gate to make a test pass.

## Autonomous engineering expectations

- Proceed on your own judgment for anything that stays local and reversible: reading, investigating, editing, running the build/test/lint chain, running the app locally, opening a branch, committing locally.
- **Everything that touches production waits for an explicit go-ahead**: merging to `main`, deploying (Fly/Vercel), running a database migration against a real database, or using any live Shopify/Razorpay/Supabase/Auth0 credential (including `pnpm verify:real`). Opening a PR on your own judgment is fine; landing it is not.
- **Default priority when not given a specific task:** get one real transaction flowing end-to-end. Bias toward the blockers in `COUNTERX-ARCHITECTURE.md` §7 in order — they're ordered by actual dependency, not importance. Fix whatever's directly needed to make an outcome *actually true* end-to-end, even slightly beyond the literal ask, and say plainly what else you touched and why.
- If a fix reveals adjacent problems that block the same outcome, fix them in the same pass rather than shipping something that looks done but isn't. If they're unrelated to the outcome at hand, note them and move on — don't scope-creep into a general cleanup.
- **Security escalation:** if you find a security-relevant issue while working on something else, interrupt immediately with a short plain-language flag, then keep working unless told otherwise. Don't batch security findings into a later summary.

## Verification before declaring anything done

- "The tests pass" is necessary, not sufficient. Where possible, actually run or exercise the thing (boot the service, hit the route, exercise the UI) and describe what you observed — this repo has a documented history of static claims about wiring/boot-behavior turning out wrong.
- Before claiming a gate is fixed, re-run it from a clean state (`pnpm verify`, or the specific `pnpm build`/`typecheck`/`lint`/`depcruise`/`test` step) and quote the actual result, not an inference from the diff.
- Never expand the scope of what you were told to verify — if you fix a small thing and discover a bigger pre-existing issue nearby, name it explicitly as out of scope rather than silently bundling a fix for it into the same change (this repo has direct history of that going wrong — see the "402 pre-existing formatting files" incident this session).

## Subagents / parallel work

Use forks and subagents freely when they'd genuinely speed things up — the founder reads your summary, not their transcripts, so there's no cost to delegating research or independent investigation in parallel. Don't spin up subagents for something you can just do directly in a few tool calls.

## When to stop and ask

- Before any destructive or hard-to-reverse action: force-push, `git reset --hard`, dropping/truncating a table, deleting a branch, overwriting uncommitted work.
- Before merging, deploying, migrating a real database, or using any live/production credential (see above — this is a hard boundary, not a judgment call).
- Before widening any authority/policy/limit boundary (merchant allowlist, spend limit, approval threshold, agent scope) — even temporarily, even for testing.
- When two canonical documents conflict, or a document and the running code disagree on something safety-relevant — surface the conflict rather than picking silently.
- When you're genuinely blocked on a decision only the founder can make (a real product tradeoff, not an implementation detail) — ask directly, don't guess and hope.

Otherwise: use your judgment, keep moving, and explain what you did and why in language a non-coder can act on.
