#!/usr/bin/env node
/**
 * Runs a gitleaks secret scan against the whole repository using the
 * pinned `zricethezav/gitleaks:v8.30.1` Docker image (matches
 * .github/workflows/ci.yml's pinned CLI version). Cross-platform: works
 * from PowerShell, bash, or zsh without shell-specific `$PWD`/`%cd%`
 * syntax, because Node resolves the repository root itself.
 *
 * Usage: pnpm secrets:scan
 * Requires: Docker Engine (see docs/development-prerequisites.md).
 */
import { spawnSync } from "node:child_process";
import { fileURLToPath } from "node:url";
import { dirname, resolve } from "node:path";

const GITLEAKS_IMAGE = "zricethezav/gitleaks:v8.30.1";

const repoRoot = resolve(dirname(fileURLToPath(import.meta.url)), "..");

const result = spawnSync(
  "docker",
  [
    "run",
    "--rm",
    "-v",
    `${repoRoot}:/repo`,
    GITLEAKS_IMAGE,
    "detect",
    "--source=/repo",
    "--config=/repo/.gitleaks.toml",
    "--redact",
    "--no-banner",
  ],
  { stdio: "inherit" },
);

if (result.error) {
  console.error(
    "Failed to run gitleaks via Docker. Is Docker Engine installed and running? " +
      "See docs/development-prerequisites.md.",
  );
  console.error(result.error.message);
  process.exit(1);
}

process.exit(result.status ?? 1);
