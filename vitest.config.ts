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
  },
});
