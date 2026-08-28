# Codebase Sanity Check — Findings Report

Baseline (clean state, verified): `pnpm build` green · `pnpm test` 2811 passed / 0 failed · `pnpm depcruise` 0 violations (1848 modules) · `pnpm lint` **963 errors / 1 warning**.

## A. Categorized Inventory

### 1. Lint-Config Problem (ROOT CAUSE — HIGH value, ZERO risk) — FIXED
- **eslint.config.js** ignores list was missing `**/out/**`. ESLint was linting `apps/landing/out/` — the untracked, git-ignored **Next.js static export** output (minified JS chunks).
- Evidence: all 541 `no-undef` + the entire base-rule tail (61 no-prototype-builtins, 45 no-cond-assign, 32 no-empty, 28 no-fallthrough, 8 no-useless-escape, 5 no-control-regex, 3 no-self-assign, 3 no-case-declarations, no-redeclare, no-func-assign) came exclusively from `apps/landing/out/_next/static/chunks/*.js`.
- Action: added `"**/out/**"` to ignores. **Collapsed 963 → 65 errors.** Honest (config-level; suppresses no real source finding).
- Risk of fixing: none (build artifact, not source).

### 2. Real Bugs — FIXED
- **packages/ui/src/components/data-table.tsx:82** — `String(item[column.key] ?? "")` renders objects/arrays as `"[object Object]"`. Severity: low-medium (real UI bug, latent). Fixed with a `renderCellValue` helper (null/undefined→"", primitives identical to before, objects→JSON). Behavior-preserving for all current call sites (primitives only).

### 3. Type-Safety Smells — FIXED
- **apps/merchant-console/src/app/{audit,findings,mapping,transactions}/page.tsx** — ~55 `no-explicit-any` + `no-unsafe-*` from `(item: any)` DataTable cells. Fixed by typing cells with real row models (Transaction/AuditEntry/Finding/MappingEntry). Cell bodies are now genuinely type-checked. See backlog B2 for the `as unknown as` bridge.
- **apps/control-plane-api/src/transaction-routes.ts:91** — `"completed" | "declined" | string` collapses to `string` (no-redundant-type-constituents). Changed to `string` + doc comment. Type-only, behavior-preserving.
- **packages/ui input/loading/sidebar.tsx** — 3× empty-interface (`no-empty-object-type`) → type aliases.

### 4. Dead Code / Useless Info — FIXED
- **apps/worker/src/secret-leakage.integration.test.ts** — stale `eslint-disable no-console` directive (reported "unused directive" warning). Removed.
- **packages/razorpay-adapter/src/real-http-client.ts:133** — unused `_cause` catch binding. Root cause: config lacked `caughtErrorsIgnorePattern`. Fixed via config (general fix), not source edit.

### 5. ESM/CJS Risks — AUDITED CLEAN (no changes needed)
- The `pg` named-value-import trap is already fixed (`import pg from "pg"; const {...} = pg` / type-only imports). No other named-VALUE imports from CommonJS deps remain: `jose` (type=module), `drizzle-orm` (dual w/ import condition), `zod` (has import export condition), `json-canonicalize` (ships ESM `module` entry — verified it resolves under native Node). All 3 backend services import under native Node ESM (fail only on missing DATABASE_URL). No risk.

### 6. Test-Code-In-Prod — DOCUMENTED (see backlog B1)
- `apps/worker/src/adversarial-test-support.ts` is imported ONLY by tests → safely excludable.
- `packages/trust-protocol/src/fixtures.ts`, `packages/connector-sdk/src/fixtures.ts`, `packages/shopify-connector/src/mock-graphql-client.ts` are **re-exported from public `index.ts`** and consumed cross-package (testkit, reference-services) → **LOAD-BEARING**, do NOT silently exclude.

### 7. Do-Not-Touch — CONFIRMED
- Next apps' `next.config.ts` (transpilePackages / ignoreBuildErrors / ignoreDuringBuilds) — intentional, untouched.
- TypeScript project-references build (`tsc -b tsconfig.build.json` + references) — untouched.
- Deployed limits, spend-ledger, worker money-seam, Transactions read-model external contract — untouched.
- `.agents/tasks/*` — untouched.

### 8. Cosmetic / Deprecation — NOTED (not actioned)
- Next 16 deprecation warnings ("middleware → proxy", "Unrecognized key: eslint"). Cosmetic; risky config surgery avoided.

## B. Fixes Applied — Slices
- **Slice A (FEAT-002)**: eslint config (`out/` ignore + caughtErrorsIgnorePattern) + safe source fixes (data-table, ui empty-interfaces, worker stale disable, transaction-routes redundant type). 963 → 58 errors.
- **Slice B (FEAT-003)**: merchant-console type-safety (typed cells) + eslint-plugin-react-hooks install/registration + use-api refetch void-useCallback. 58 → 1 error.

Final verified state (clean): build green · 2811 tests · depcruise 0 · **lint 1 error / 0 warnings** (the 1 = pre-existing backlog item) · frozen-install passes · all backends load under native ESM. Semantic review v1: **APPROVED**.

## C. Prioritized Backlog (deliberately NOT changed — need human decision / higher risk)
1. **[MED] Test-support in prod dist**: adopt a `*.testsupport.ts` convention (or exclude globs) so `adversarial-test-support.ts` stays out of prod images. The fixture re-exports from public `index.ts` need an API decision first (they are load-bearing).
2. **[LOW] DataTable generic constraint**: merchant-console uses `as unknown as DataTableColumn<Record<string,unknown>>[]` bridges. Cleaner fix: relax `DataTable<T extends Record<string,unknown>>` (e.g. `T extends object` + keyed columns) so typed interfaces assign directly. Non-blocking.
3. **[LOW] renderCellValue object branch** has no unit test in packages/ui (no data-table test file exists). Add one if a ui test harness is introduced.
4. **[MED] Transaction read-model follow-ups** (touch deployed contract — human decision): (a) LIST can emit duplicate rows if a transaction_id has two workflow_intents (needs DISTINCT ON); (b) `loadAmount` picks an arbitrary spend_ledger row (`ORDER BY id ASC LIMIT 1`) on multi-wallet refs — make deterministic/aggregate; (c) N+1 fan-out (~401 round-trips at limit=200) — batch into IN queries. Files: apps/control-plane-api/src/transaction-{routes,store-postgres}.ts.
5. **[LOW] worker test no-unsafe-return** at secret-leakage.integration.test.ts:326 — not trivially typeable; left as-is.
6. **[LOW] operations-console react-hooks**: 7 pre-existing exhaustive-deps warnings in use-operator-api.ts surface if react-hooks linting is enabled console-wide. Enable + fix as a dedicated slice.
7. **[COSMETIC] Next 16 deprecations** (middleware→proxy, eslint key).
