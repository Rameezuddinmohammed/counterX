import { defineConfig } from "vitest/config";

/**
 * Root vitest config. Each package/app runs its own "test" script
 * (`vitest run`) inside its own directory via `pnpm -r`, so this file
 * only pins shared defaults for editor/IDE tooling and ad-hoc root-level
 * invocations (e.g. `pnpm vitest run --project domain`).
 */
export default defineConfig({
  test: {
    environment: "node",
    passWithNoTests: false,
    // Parallel subagent work runs in git worktrees under .claude/worktrees/
    // (see CLAUDE.md's subagent guidance) - without this, a root-level
    // invocation like scripts/run-db-lifecycle.mjs's `vitest run <paths>`
    // also picks up identically-named test files inside any worktree that
    // happens to exist on disk at the time, running them against the same
    // TEST_DATABASE_URL and mixing their results into one report.
    exclude: ["**/node_modules/**", "**/dist/**", "**/.claude/worktrees/**"],
  },
});
