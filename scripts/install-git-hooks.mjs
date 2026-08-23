#!/usr/bin/env node
/**
 * Installs the repository's opt-in git hooks (currently: a pre-commit
 * gitleaks secret scan over staged changes) by pointing git's
 * core.hooksPath at scripts/git-hooks.
 *
 * Usage: pnpm hooks:install
 */
import { spawnSync } from "node:child_process";
import { chmodSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, resolve } from "node:path";

const repoRoot = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const hooksDir = resolve(repoRoot, "scripts", "git-hooks");

try {
  chmodSync(resolve(hooksDir, "pre-commit"), 0o755);
} catch {
  // chmod is a no-op on some platforms (e.g. Windows); git still executes
  // the hook through its own shell wrapper.
}

const result = spawnSync("git", ["config", "core.hooksPath", "scripts/git-hooks"], {
  cwd: repoRoot,
  stdio: "inherit",
});

if (result.status !== 0) {
  console.error("Failed to configure core.hooksPath. Run this from inside the git repository.");
  process.exit(result.status ?? 1);
}

console.log("Git hooks installed. Pre-commit will run a gitleaks scan over staged changes.");
console.log("Requires Docker Engine to be running locally.");
