#!/usr/bin/env node
/**
 * Operator-only admin script: approves a merchant sitting in
 * ACTIVATION_REVIEW into ACTIVE — the one lifecycle transition in the
 * self-serve onboarding wizard that a merchant can never trigger for
 * itself. See apps/control-plane-api/src/merchant-activation-store.ts
 * (the real state-machine-backed transition this script calls) and
 * apps/control-plane-api/src/merchant-activation-routes.ts (the HTTP route
 * this script stands in for — POST /control/v1/merchant-applications/
 * :merchantId/approve, which requires a real operator-kind Auth0 JWT).
 *
 * Once a merchant is ACTIVE here, apps/agent-runtime/src/
 * merchant-directory-store.ts starts showing it to real buyer agents as a
 * live, money-accepting merchant — this is a real, disclosed judgment
 * call, not a low-stakes toggle.
 *
 * WHY THIS SCRIPT CALLS MerchantActivationStore DIRECTLY INSTEAD OF POSTing
 * to the real route: identical reasoning to
 * issue-and-bind-prepaid-mandate.mjs — the route requires a real Auth0
 * operator JWT (actor_kind 'operator', platform.operator role, step_up or
 * multi_factor assurance), and this deployment's Auth0 tenant has no
 * scripted way to mint one for CLI use yet. This script constructs the
 * exact same MerchantActivationStore class the real HTTP route uses (see
 * main.ts's wiring), so the state-machine logic exercised is identical —
 * only the HTTP+Auth0 transport is skipped. It does NOT bypass
 * transitionMerchantLifecycle: the store still validates the transition is
 * legal (currently ACTIVATION_REVIEW, or already ACTIVE for an idempotent
 * repeat run) before writing anything.
 *
 * A real operatorId is not required to exist as a durable identity.actors
 * row today — see merchant-activation-store.ts's header: no transition in
 * this whole store persists actor/reason/evidence beyond lifecycle_state/
 * lifecycle_version (a pre-existing limitation shared by every other
 * lifecycle-transition call site in this codebase, not introduced here).
 * A fresh operator id is generated per run unless --operator-id is passed.
 *
 * PREREQUISITES:
 *   `pnpm --filter @counter/domain build && pnpm --filter @counter/data build
 *    && pnpm --filter @counter/merchant-application build
 *    && pnpm --filter @counter/trust-protocol build
 *    && pnpm --filter @counter/control-plane-api build` (imports compiled
 *   dist, same convention as every other script in this directory)
 *
 * Usage:
 *   node scripts/approve-merchant-activation.mjs \
 *     --merchant-id ctr_merchant_... --reason "documents verified" \
 *     [--operator-id ctr_operator_...]
 *
 * Reads DATABASE_URL from .env, same as every other script here.
 */
import { readFileSync } from "node:fs";
import { fileURLToPath, pathToFileURL } from "node:url";
import { dirname, resolve } from "node:path";
import { randomBytes } from "node:crypto";

const scriptDir = dirname(fileURLToPath(import.meta.url));
const repoRoot = resolve(scriptDir, "..");

function importFromRepo(relativePath) {
  return import(pathToFileURL(resolve(repoRoot, relativePath)).href);
}

for (const line of readFileSync(resolve(repoRoot, ".env"), "utf8").split(/\r?\n/)) {
  const m = line.match(/^([A-Z_][A-Z0-9_]*)=(.*)$/);
  if (m && process.env[m[1]] === undefined) process.env[m[1]] = m[2];
}

function parseArgs(argv) {
  const args = {};
  for (let i = 0; i < argv.length; i += 1) {
    const key = argv[i];
    if (!key.startsWith("--")) continue;
    const value = argv[i + 1];
    args[key.slice(2)] = value;
    i += 1;
  }
  return args;
}

const args = parseArgs(process.argv.slice(2));
const merchantId = args["merchant-id"];
const reason = args["reason"];
if (!merchantId || !reason) {
  console.error(
    "Usage: node approve-merchant-activation.mjs --merchant-id <id> --reason <text> [--operator-id ctr_operator_...]",
  );
  process.exit(1);
}

const databaseUrl = process.env.DATABASE_URL;
if (!databaseUrl) throw new Error("DATABASE_URL is required");
const environment = process.env.COUNTER_ENV ?? "test";

const { PostgresDatabase } = await importFromRepo("packages/data/dist/database.js");
const { createCounterId } = await importFromRepo("packages/domain/dist/ids.js");
const { MerchantActivationStore } = await importFromRepo(
  "apps/control-plane-api/dist/merchant-activation-store.js",
);

let operatorId = args["operator-id"];
if (!operatorId) {
  const generated = createCounterId("operator", randomBytes(16));
  if (!generated.ok) throw new Error("Failed to generate an operator id");
  operatorId = generated.value;
  console.log(`No --operator-id given — generated one for this approval: ${operatorId}`);
}

const database = new PostgresDatabase(databaseUrl);

try {
  const store = new MerchantActivationStore(database, environment);
  const result = await store.approve(merchantId, operatorId, reason);

  console.log("\nMerchant activation result:");
  console.log(`  merchantId:       ${result.merchantId}`);
  console.log(`  lifecycleState:   ${result.lifecycleState}`);
  console.log(`  lifecycleVersion: ${result.lifecycleVersion}`);
  if (result.lifecycleState === "ACTIVE") {
    console.log(
      "\nThis merchant is now discoverable to buyer agents (merchant-directory-store.ts's ACTIVE gate).",
    );
  }
} finally {
  await database.close();
}
