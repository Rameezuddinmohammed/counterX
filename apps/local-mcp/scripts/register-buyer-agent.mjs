#!/usr/bin/env node
/**
 * One-time operator setup: registers one real wallet identity and one real
 * Ed25519 agent signing key in the database, so the real MCP entrypoint
 * (main-real.ts) has something genuine to sign purchases with.
 *
 * This is NOT a server route — it's a script an operator runs once per
 * wallet they want to provision. It writes directly (via parameterized SQL,
 * matching this repo's established pattern for one-off production data
 * operations) rather than through the RBAC-gated PostgresIdentityRepositories:
 * that repository's ScopedTransactionManager requires the database
 * connection to already be authenticated as a specifically restricted
 * Postgres role (see packages/data/src/scoped-transaction.ts's
 * assertRuntimeRolePosture) — infrastructure this deployment doesn't have
 * configured, and setting it up is separate, larger work. The inserts below
 * satisfy the exact same database CHECK constraints that repository would
 * have enforced (CounterId format, algorithm, key format, validity window).
 *
 * PREREQUISITE: run `pnpm --filter @counter/data build` and
 * `pnpm --filter @counter/wallet-domain build` first (imports compiled dist).
 *
 * SECURITY: never prints the private key. The key file itself is encrypted
 * at rest by FileSecureKeyStore.
 */
import { readFileSync } from "node:fs";
import { fileURLToPath, pathToFileURL } from "node:url";
import { dirname, resolve } from "node:path";
import readline from "node:readline/promises";

const scriptDir = dirname(fileURLToPath(import.meta.url));
const repoRoot = resolve(scriptDir, "../../..");

function importFromRepo(relativePath) {
  return import(pathToFileURL(resolve(repoRoot, relativePath)).href);
}

for (const line of readFileSync(resolve(repoRoot, ".env"), "utf8").split(/\r?\n/)) {
  const m = line.match(/^([A-Z_][A-Z0-9_]*)=(.*)$/);
  if (m && process.env[m[1]] === undefined) process.env[m[1]] = m[2];
}

const databaseUrl = process.env.DATABASE_URL;
if (!databaseUrl) throw new Error("DATABASE_URL is required");

const ENVIRONMENT = process.env.COUNTER_ENV ?? "test";

const { PostgresDatabase } = await importFromRepo("packages/data/dist/database.js");
const { createCounterId } = await importFromRepo("packages/domain/dist/index.js");
const { FileSecureKeyStore, defaultWalletKeyStorePath } = await importFromRepo(
  "packages/wallet-domain/dist/index.js",
);

function requireCounterId(kind, entropy) {
  const result = createCounterId(kind, entropy);
  if (!result.ok) throw new Error(`Failed to derive a ${kind} id: ${result.error.message}`);
  return result.value;
}

const walletId = requireCounterId("wallet", crypto.getRandomValues(new Uint8Array(16)));
const agentId = requireCounterId("agent", crypto.getRandomValues(new Uint8Array(16)));

const keyStorePath = process.env.COUNTER_WALLET_KEYSTORE_PATH ?? defaultWalletKeyStorePath();
let passphrase = process.env.COUNTER_WALLET_KEYSTORE_PASSPHRASE;
if (passphrase === undefined) {
  const rl = readline.createInterface({ input: process.stdin, output: process.stdout });
  passphrase = await rl.question(
    `Passphrase to protect the new key file at ${keyStorePath} (remember this — it's needed every time the real MCP server starts): `,
  );
  rl.close();
}
if (passphrase.trim().length === 0) throw new Error("A non-empty passphrase is required");

const keyStore = new FileSecureKeyStore(keyStorePath);
keyStore.unlockStore(passphrase);
const { keyId, publicKey } = await keyStore.generateKey("agent-signing");
const publicKeyBase64Url = Buffer.from(publicKey).toString("base64url");

const now = new Date();
const database = new PostgresDatabase(databaseUrl);
try {
  await database.transaction(async (session) => {
    await session.query(
      `INSERT INTO identity.scope_registry (environment, scope_kind, scope_id, created_at)
       VALUES ($1, 'wallet', $2, $3)`,
      [ENVIRONMENT, walletId, now.toISOString()],
    );
    await session.query(
      `INSERT INTO wallet.scopes (environment, scope_kind, wallet_id, created_at)
       VALUES ($1, 'wallet', $2, $3)`,
      [ENVIRONMENT, walletId, now.toISOString()],
    );
    await session.query(
      `INSERT INTO identity.actors (
         environment, actor_kind, actor_id, owner_scope_kind, owner_scope_id, status, created_at
       ) VALUES ($1, 'registered_agent', $2, 'wallet', $3, 'active', $4)`,
      [ENVIRONMENT, agentId, walletId, now.toISOString()],
    );
    await session.query(
      `INSERT INTO identity.agent_public_keys (
         environment, owner_scope_kind, owner_scope_id, key_id, actor_kind,
         agent_id, algorithm, public_key_base64url, created_at, not_before
       ) VALUES ($1, 'wallet', $2, $3, 'registered_agent', $4, 'Ed25519', $5, $6, $6)`,
      [ENVIRONMENT, walletId, keyId, agentId, publicKeyBase64Url, now.toISOString()],
    );
  });
} finally {
  await database.close();
}

console.log("Registered a real wallet + agent signing key:");
console.log(`  environment: ${ENVIRONMENT}`);
console.log(`  walletId:    ${walletId}`);
console.log(`  agentId:     ${agentId}`);
console.log(`  keyId (kid): ${keyId}`);
console.log(`  keyStorePath: ${keyStorePath}`);
console.log("\nSet these as COUNTER_WALLET_ID / COUNTER_AGENT_ID / COUNTER_AGENT_KID for main-real.ts.");
