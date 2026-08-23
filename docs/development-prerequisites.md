# Supported development prerequisites

This document defines the supported local environments for Counter Platform Foundation. It applies to the current monorepo bootstrap, development, and verification workflow.

## Supported host environments

- Windows 11 with WSL 2 using Ubuntu 24.04 LTS; run Node, pnpm, Docker CLI, and repository commands inside the WSL distribution.
- macOS 14 or later on Apple Silicon or Intel.
- Ubuntu 24.04 LTS.

Other environments may work but are not supported for verification or pilot-release evidence.

## Required tooling

Install the exact baseline versions in [`engineering-baseline.yaml`](../engineering-baseline.yaml): Node.js 22.14.0, pnpm 9.15.4, Docker Engine 27.5.1 with Docker Compose 2.32.4, and OpenTofu 1.9.0. Git must be installed with line-ending preservation enabled; do not use global package installations for project dependencies.

Docker must have sufficient resources for PostgreSQL and the optional telemetry collector (minimum 4 GB memory allocated to Docker). Local development uses Docker only for dependencies; applications must run in local/test mode without AWS credentials.

## Access and secrets

No cloud account, provider account, production certificate, payment credential, or private agent key is needed to bootstrap the repository. Copy `.env.example` to an ignored local `.env` file and supply only synthetic local values. Never place secrets in versioned files, shell history, fixtures, logs, traces, Docker build arguments, or OpenTofu variables committed to the repository.

AWS access is required only for Task 19 after Gate A approval. Any deployed environment uses AWS Secrets Manager and KMS references, not plaintext environment files.

## Compatibility policy

The exact compatibility matrix, transitive dependency anchors, and upgrade rules are in [`engineering-baseline.yaml`](../engineering-baseline.yaml). Developers use the single committed `pnpm-lock.yaml`; CI installs the exact Node.js/pnpm toolchain with `pnpm install --frozen-lockfile`. The baseline prohibits additional lockfiles and non-exact direct dependency ranges; the current automated gate enforces the frozen pnpm lockfile and toolchain, while repository review must reject any extra lockfile or manifest range.

All transports use UTF-8. CTP canonical artifacts use RFC 8785-compatible canonical JSON via `json-canonicalize@1.1.1`, SHA-256, unpadded base64url key material, and Ed25519 as defined by ADR-0002. System time is UTC only and public identifiers are opaque as defined by ADR-0003.

## First verification checklist

After Task 2 scaffolding exists, run the package-manager version check, frozen lockfile installation, format/lint/typecheck/test suite, dependency-boundary check, and Docker Compose smoke test. OpenTofu validation must run without cloud credentials; plans and applies require explicitly approved environment credentials.

Run these commands from the repository root:

```sh
node --version   # 22.14.0
pnpm --version    # 9.15.4
pnpm install --frozen-lockfile
pnpm format:check
pnpm lint
pnpm typecheck
pnpm depcruise
pnpm build
pnpm test
```

`pnpm verify` runs formatting, lint, typecheck, dependency-boundary checks, builds, and package tests in one command. It does not install dependencies, verify the tool versions, start Docker, run `pnpm db:test:lifecycle`, or run the gitleaks scan; CI and the explicit local commands documented below run those separate gates.

## Secret detection

Secret scanning uses [gitleaks](https://github.com/gitleaks/gitleaks) (MIT-licensed), pinned to `v8.30.1` everywhere it runs. The ruleset lives in [`.gitleaks.toml`](../.gitleaks.toml) at the repository root and extends gitleaks' maintained default rules.

- CI runs a full-history scan on every push/PR via `.github/workflows/ci.yml`'s `secret-scan` job, using the standalone Linux binary (no Docker, no license key, no cloud credential required).
- Locally, `pnpm secrets:scan` runs the same pinned version through Docker (`zricethezav/gitleaks:v8.30.1`) against the full working tree.
- `pnpm hooks:install` configures a git `pre-commit` hook (`scripts/git-hooks/pre-commit`) that scans only staged changes before each commit, so leaked secrets are caught before they are committed. This is optional and opt-in; it also requires Docker.

None of these paths require a gitleaks license key: the CLI itself is free and unrestricted, and the license requirement only applies to the hosted `gitleaks-action` PR-commenting product used by GitHub organizations, which this repository does not use.

## Local database lifecycle

Copy `.env.example` to the ignored `.env` file and replace both local-only password placeholders. The persistent `counter_local` database and ephemeral `counter_test` database use separate roles, ports, and storage:

```sh
pnpm infra:up
pnpm db:migrate
pnpm db:seed

pnpm infra:test:up
pnpm db:test:lifecycle
```

`pnpm db:test:lifecycle` requires `TEST_DATABASE_URL` and fails before starting Vitest when it is absent, so the integration gate cannot report a skipped test as success. The URL is an isolated bootstrap/migration credential because the lifecycle suite must create a temporary runtime role and install forced-RLS helpers. The suite executes repository/RLS assertions through a separate temporary `LOGIN NOSUPERUSER NOBYPASSRLS NOINHERIT` role that owns no protected relation and has only explicit grants.

`DATABASE_URL` and `TEST_DATABASE_URL` are migration/lifecycle credentials, not application runtime credentials. Application processes that use scoped repositories must use a distinct restricted runtime role: `LOGIN NOSUPERUSER NOBYPASSRLS NOINHERIT`, no membership in a superuser/BYPASSRLS role, no protected-relation ownership, and only explicit schema/table/sequence/function grants. `ScopedTransactionManager` verifies the checked-out session posture and rejects the operation before setting claims if this contract is violated. The current Compose services create only the bootstrap owner; production runtime-role provisioning and secret delivery belong to deployment/IaC, never to an application startup path.

Start the optional collector with `pnpm infra:telemetry:up`. Stop all local profiles with `pnpm infra:down`. No AWS credentials are used by these commands.

Migrations live in `packages/data/migrations` as contiguous, immutable `*.up.sql`/`*.down.sql` pairs. The runner verifies SHA-256 checksums in `platform.schema_versions`, serializes changes with a PostgreSQL advisory lock, supports incremental upgrades and explicit rollback targets, and refuses to seed before the latest version. Seed files are environment-specific and constrained by the database schema to carry a `synthetic` classification and payload marker.

`pnpm db:backup` writes a custom-format dump under the ignored `.local/backups` directory. `pnpm db:restore -- <backup-path>` restores only to `RESTORE_DATABASE_URL`, which must be a distinct loopback `counter_test` or `*_restore` database. The scripts require PostgreSQL 17 client tools on `PATH` (or `PG_BIN_DIR`) and pass credentials through process environment variables rather than command arguments. Restore validation is destructive only to the explicitly isolated restore/test target; it never targets `counter_local`.