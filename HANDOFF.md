# Counter — Session Handoff Document

> **Purpose:** Hand off exact working context to a fresh Claude Code session picking up after Phase 3 (remote MCP connector) of the plan. Self-contained. No secrets committed here — they live in `.env` (gitignored) and Fly secrets. The Vault root token/unseal key live ONLY in the founder's own password manager — not in this repo, not in any session's context, not recoverable by Claude.
>
> **Written:** 2026-09-03, end of the session that built and deployed Phase 3. Everything below was true at that moment; re-verify anything load-bearing before relying on it (per `CLAUDE.md`'s own source-of-truth hierarchy — this file is a starting hypothesis, not gospel).

---

## 0. Read this first

The **real plan** is `~/.claude/plans/federated-enchanting-wave.md` (6 phases: 0–3 done, 4 next — wallet-dashboard backend). `.kiro/specs/counter-agent-wallet/design.md`'s "Remote MCP transport and key custody" section has the full key-custody decision writeup — read it before touching Vault or `apps/remote-mcp`.

**Branch state:** everything through Phase 3 is merged to `main` (PRs #25 and #26, both squash-merged after real CI passed). No open branch to pick up — start a fresh branch for whatever's next.

---

## 1. What's actually done (verified by real execution, not static reading)

**Phase 3 — remote MCP connector.** Buyers can now (once someone completes step 4 below) connect Claude.ai directly to a hosted `https://counter-remote-mcp.fly.dev` URL instead of running a local stdio process.

1. **Key-custody spike**: confirmed by running a real local Vault 1.17.6 dev server that its Transit engine signs with a non-exportable Ed25519 key, and the signature verifies bit-for-bit with this repo's own `@noble/ed25519`. Chose Vault over AWS/GCP KMS (no AWS/GCP credentials exist anywhere in this environment; ADR-0006's AWS default inherits from ADR-0009's AWS pilot target, which was never actually realized — the real deployment is Fly + Supabase, a stale-doc-vs-code conflict flagged, not silently resolved).
2. **`VaultSecureKeyStore`** (`packages/wallet-domain`) + **`PostgresVaultKeyRepository`** (`packages/data`, migration `0023`): multi-tenant Ed25519 signing where a store built for tenant A structurally cannot reach tenant B's key (every keyId is checked against a durable ownership record before Vault is ever called).
3. **`apps/remote-mcp`**: Streamable-HTTP MCP server fronted by `CounterOAuthServerProvider`, a genuine **two-legged OAuth 2.1 proxy** — necessary because MCP clients require dynamic client registration and Auth0 doesn't support it. Full design in the file's own header comment. The MCP SDK's stock `ProxyOAuthServerProvider` does NOT work for this (confirmed by reading its source — it only supports a single fixed downstream client). Migration `0024` (`platform.remote_mcp_clients`) is the durable DCR registry.
4. **Automatic Vault token rotation**: `apps/remote-mcp`'s Vault credential is a genuine Vault **periodic token** (30-day window), renewed by the app itself every 6 hours (`src/vault-token-renewal.ts`) — not a long fixed TTL, which isn't real rotation.
5. **Real bug found and fixed in shared code**: `packages/http-api-kit`'s `authPlugin` skip-route matching ignored query strings, silently 401ing any OAuth route (`/authorize?client_id=...`). Was latent everywhere else; `apps/remote-mcp` was the first thing to actually hit it.
6. **Two more real bugs found only by running the deployed system**, both documented in `vault-config.hcl`: Vault's listener was IPv4-only (`0.0.0.0`) and unreachable over Fly's IPv6-only private network — every local ssh-console health check kept passing while cross-app calls silently failed; and the `remote-mcp-signer` Vault policy had no grant for `auth/token/renew-self`, so automatic renewal 403'd until fixed.

**Deployed and live:**
- `counter-vault` (Fly) — internal-only (no public IP), holds the Transit engine. Initialized, unsealed, real `remote-mcp-signer` policy + periodic token issued.
- `counter-remote-mcp` (Fly) — public, single machine (`min_machines_running = 0`, confirmed auto-stops when idle in the logs). Health, OAuth metadata, and `/mcp` 401-without-token all verified against the live URL.
- New Auth0 application **"Counter Remote MCP"** (Regular Web App, `qy7o09wDfrHMGNFc4Sh5vf1ZdQS6v6Id`) created in the dashboard: grant types trimmed to Authorization Code + Refresh Token only, callback URL `https://counter-remote-mcp.fly.dev/oauth/callback`, authorized for the `agent:transact` permission on "Counter Platform API" with Allow Offline Access turned on (needed for refresh tokens).

---

## 2. What's NOT done yet

**A real Claude.ai Connector has not been pointed at this.** Everything up through the OAuth dance and MCP session handshake was verified with real HTTP calls against the real deployed server (see PR #26's test plan), but nobody has actually added `https://counter-remote-mcp.fly.dev` as a Connector in a live Claude.ai account and completed a real purchase through it end-to-end. That's the natural next step — needs a live client to test against, which is why it wasn't done automatically this session.

Phase 4 (wallet-dashboard backend, real endpoints for balance/mandates/history) hasn't been started.

---

## 3. Critical operational gotchas hit this session (don't rediscover these the hard way)

- **`flyctl` commands that touch real infrastructure get inconsistently blocked by the auto-mode permission classifier** — `flyctl deploy`, `flyctl ssh console -C "..."` for anything destructive-looking (e.g. `rm -rf`), and `flyctl secrets import` via stdin all hit this at different points, sometimes passing on retry, sometimes not. When blocked, ask the founder to run the exact command rather than working around it.
- **`flyctl ssh sftp put` has a real bug on Windows** (at least via Git Bash and PowerShell in this session): it sometimes computes the wrong remote destination path, silently failing with a confusing `file does not exist` error unrelated to the actual paths given. Multi-line heredocs piped through `flyctl ssh console -C "..."` also fail — nested quoting between PowerShell, flyctl's own arg parser, and the remote shell breaks reliably. **What actually works:** the founder opens `flyctl ssh console --app <app>` interactively themselves and pastes a `cat > file << 'EOF' ... EOF` heredoc block directly at the prompt. Slower, but it sidesteps every quoting/encoding issue at once.
- **PowerShell pipes a UTF-8 BOM to native processes by default**, which broke `flyctl secrets import`'s stdin parsing (`"﻿NAME" is not a valid secret name`). Setting `$OutputEncoding` didn't fix it. What worked: `flyctl secrets set NAME=VALUE NAME2=VALUE2 ...` as direct command-line arguments instead of stdin.
- **A Fly Machine's `/tmp` is the container's ephemeral filesystem, NOT the persistent volume.** A `flyctl deploy` (even just to change `vault-config.hcl`) replaces the container and silently destroys anything left only in `/tmp` — this cost a full Vault wipe-and-reinit this session (see `vault-config.hcl`'s own note). **Never leave the only copy of anything durable in `/tmp` on a Fly machine** — get it onto the operator's own machine (or the persistent volume, if appropriate for that specific secret) immediately.
- **Fly's private 6PN network is IPv6-only.** A service that binds only `0.0.0.0` (IPv4) will accept local/loopback connections fine (so `ssh console` health checks pass) but be silently unreachable from other apps in the org. Bind `[::]` (IPv6 wildcard; dual-stacks IPv4 loopback too) for anything meant to be reached over 6PN.
- **A fresh Fly app's first deploy creates 2 machines for HA by default**, even with `min_machines_running = 0` in `fly.toml` — costs nothing extra once both scale to zero, but `apps/remote-mcp`'s design (in-process OAuth/session state) genuinely breaks with >1 concurrent machine. Scaled down to 1 machine manually (`flyctl machine destroy <id>`) after the first deploy.
- **The Vault root token and unseal key must never be the only copy anywhere Claude can lose them** — they were generated, immediately handed to the founder to save in their own password manager, and never displayed in this session's own visible output (redirected straight to files, extracted via `grep`/`awk` server-side, never `cat`'d into a tool result). The `remote-mcp-signer` Vault token (scoped to sign/verify only, already proven to reject listing-all-keys and sys/admin access) is a different, much lower-stakes secret and is fine to have passed through a session's context and into `flyctl secrets set`.
- **The real deployed data partition is `COUNTER_ENV=test`**, not `"pilot"` or `"sandbox"` (both appear as decorative/descriptive strings elsewhere in scripts, not the actual partition) — confirmed by querying `merchant.scopes`/`wallet.mandates` directly against the real Supabase DB, and independently confirmed by the fact that the `COUNTER_ENV` secret's DIGEST on the newly-created `counter-remote-mcp` app matches `counter-control-plane-api`'s exactly once set to `"test"`.

---

## 4. Production state

- `counter-worker`, `counter-control-plane-api` (Fly) — unchanged this session, same state as previous handoff.
- `counter-agent-runtime` (Fly) — still untouched, shows `suspended` (expected — scales to zero when idle).
- `counter-vault` (Fly, **new**) — internal-only, always-on (`min_machines_running` not set to 0 — a sealed Vault needs a human to unseal it, so it doesn't auto-stop like the others). Real Transit engine, real `remote-mcp-signer` policy + periodic token, auto-renewed by `apps/remote-mcp`.
- `counter-remote-mcp` (Fly, **new**) — public, scales to zero when idle (confirmed in logs).
- Real DB migrations applied through **`0024`** (`remote-mcp-clients`).
- Auth0 "Counter Platform API" unchanged from previous handoff except: new "Counter Remote MCP" application added and authorized for `agent:transact`; "Allow Offline Access" turned on (previously off — needed for the new app's refresh tokens; check whether this has any effect on the three existing console apps if you touch Auth0 next, though none of them requested `offline_access` scope before and this only permits refresh-token issuance, doesn't force it).

---

## 5. Verification baseline at handoff

Full clean-state (`pnpm clean` + deleted tsbuildinfo) `format:check`, `lint`, `build`, `typecheck`, and `test` all green across the entire monorepo, both before and after Phase 3 landed. Real Postgres migration lifecycle (`pnpm db:test:lifecycle`) green — 21/21 — after updating two hardcoded RLS-relation-count test fixtures that Phase 0/2's own migrations (0021, 0022) had silently drifted out of sync with (that branch had never been pushed through CI before this session; see PR #25's fix commits for the exact drift).

**Known, pre-existing, NOT-yours-to-fix failures:**
- `pnpm depcruise` fails with a Node 24 / `dependency-cruiser@16.10.0` incompatibility. Unrelated to any session's code changes.
- `apps/merchant-console` has one pre-existing `react-hooks/exhaustive-deps` lint warning (not an error).

---

## 6. Starting point for whoever picks this up next

**Most valuable next step: the live Claude.ai Connector test.** Add `https://counter-remote-mcp.fly.dev` as a Connector in a real Claude.ai account, complete the OAuth flow (it'll redirect through Auth0's real login), and confirm a purchase tool call actually signs with the correct buyer's key and reaches the same real HTTP path Phase 0 proved. If this needs a wallet_user Auth0 login that doesn't exist yet, that's the same self-serve/invite gap noted in prior handoffs (`auth0_shared_console_app_gaps` memory) — check whether it's been resolved since.

After that (or in parallel): **Phase 4**, wallet-dashboard backend — real endpoints in `apps/control-plane-api` for balance/mandates/transaction history, no visual/UI work (the founder is handling that separately). See the plan file for exact scope.

---

## 7. Documents you can trust vs. re-verify

Per `CLAUDE.md`'s own hierarchy: the **plan file** and **this handoff** are your best current starting points. `COUNTERX-ARCHITECTURE.md`, if present, is stale relative to everything in this and the prior handoff — treat any of its wiring/boot-status claims as needing re-verification against running code. Don't trust this file's own specific numbers (exact commit hashes, exact deploy versions) without a quick real check — trust its shape and gotchas, re-verify its specifics.
