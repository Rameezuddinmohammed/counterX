#!/usr/bin/env node
/**
 * Self-serve counterpart to register-buyer-agent.mjs (that script stays as
 * the founder's own operator-only path, untouched). This one is for anyone
 * who just signed up on the Counter website: it never touches the database
 * directly, and never needs a DATABASE_URL. The only proof of identity it
 * has is the single-use setup token minted by the website's "Generate
 * connect command" button (apps/onboarding/src/app/connect/connect-panel.tsx),
 * which it redeems against the public
 * POST /control/v1/wallet-users/agent-keys route
 * (apps/control-plane-api/src/wallet-user-routes.ts).
 *
 * Usage:
 *   node register-agent-self-serve.mjs --wallet <walletId> --setup-token <token>
 *
 * PREREQUISITE: run `pnpm --filter @counter/wallet-domain build` first
 * (imports its compiled dist, same as register-buyer-agent.mjs).
 *
 * SECURITY: never prints the private key. The key file itself is encrypted
 * at rest by FileSecureKeyStore, exactly like the founder's own key.
 */
import { fileURLToPath, pathToFileURL } from "node:url";
import { dirname, resolve } from "node:path";
import readline from "node:readline/promises";

const scriptDir = dirname(fileURLToPath(import.meta.url));
const repoRoot = resolve(scriptDir, "../../..");

function importFromRepo(relativePath) {
  return import(pathToFileURL(resolve(repoRoot, relativePath)).href);
}

function parseArgs(argv) {
  const args = { walletId: undefined, setupToken: undefined, controlPlaneUrl: undefined };
  for (let i = 0; i < argv.length; i += 1) {
    const value = argv[i + 1];
    switch (argv[i]) {
      case "--wallet":
        args.walletId = value;
        i += 1;
        break;
      case "--setup-token":
        args.setupToken = value;
        i += 1;
        break;
      case "--control-plane-url":
        args.controlPlaneUrl = value;
        i += 1;
        break;
      default:
        break;
    }
  }
  return args;
}

const { walletId, setupToken, controlPlaneUrl } = parseArgs(process.argv.slice(2));
if (!walletId || !setupToken) {
  console.error(
    "Usage: node register-agent-self-serve.mjs --wallet <walletId> --setup-token <token>",
  );
  process.exit(1);
}

const CONTROL_PLANE_URL =
  controlPlaneUrl ?? process.env.CONTROL_PLANE_URL ?? "https://counter-control-plane-api.fly.dev";

const { FileSecureKeyStore, defaultWalletKeyStorePath } = await importFromRepo(
  "packages/wallet-domain/dist/index.js",
);

const keyStorePath = process.env.COUNTER_WALLET_KEYSTORE_PATH ?? defaultWalletKeyStorePath();
let passphrase = process.env.COUNTER_WALLET_KEYSTORE_PASSPHRASE;
if (passphrase === undefined) {
  const rl = readline.createInterface({ input: process.stdin, output: process.stdout });
  passphrase = await rl.question(
    `Passphrase to protect your new key file at ${keyStorePath} (remember this — it's needed every time your AI tool connects): `,
  );
  rl.close();
}
if (passphrase.trim().length === 0) {
  throw new Error("A non-empty passphrase is required");
}

console.log("Generating a real Ed25519 signing key on this machine (never sent to Counter)...");
const keyStore = new FileSecureKeyStore(keyStorePath);
keyStore.unlockStore(passphrase);
const { keyId, publicKey } = await keyStore.generateKey("agent-signing");
const publicKeyBase64Url = Buffer.from(publicKey).toString("base64url");

console.log("Registering the public key against your wallet...");
const response = await fetch(`${CONTROL_PLANE_URL}/control/v1/wallet-users/agent-keys`, {
  method: "POST",
  headers: { "content-type": "application/json" },
  body: JSON.stringify({ setupToken, keyId, publicKeyBase64Url }),
});

if (!response.ok) {
  const body = await response.json().catch(() => undefined);
  const message = body?.error?.message ?? `HTTP ${response.status}`;
  console.error(`\nCould not register your key: ${message}`);
  if (response.status === 401) {
    console.error(
      'Your connect command may have expired (setup tokens last 15 minutes and work only once) — go back to the Counter site and click "Generate connect command" again.',
    );
  }
  process.exit(1);
}

const result = await response.json();
if (result.walletId !== walletId) {
  console.warn(
    `Note: the server registered this key under wallet ${result.walletId}, not ${walletId} — using the server's answer.`,
  );
}

console.log("\nRegistered your agent's signing key:");
console.log(`  walletId:     ${result.walletId}`);
console.log(`  agentId:      ${result.agentId}`);
console.log(`  keyId (kid):  ${result.keyId}`);
console.log(`  keyStorePath: ${keyStorePath}`);

const hasRuntimeCredential =
  typeof result.runtimeUrl === "string" && typeof result.runtimeAuthToken === "string";

console.log("\nRun your AI tool's MCP server with:");
console.log(`  COUNTER_WALLET_KEYSTORE_PASSPHRASE=<the passphrase you just chose>`);
console.log(`  COUNTER_WALLET_KEYSTORE_PATH=${keyStorePath}`);
console.log(
  `  COUNTER_AGENT_RUNTIME_URL=${hasRuntimeCredential ? result.runtimeUrl : "<ask Counter>"}`,
);
console.log(
  `  COUNTER_RUNTIME_AUTH_TOKEN=${hasRuntimeCredential ? result.runtimeAuthToken : "<ask Counter>"}`,
);
console.log(`  node apps/local-mcp/dist/main-real.js`);
if (!hasRuntimeCredential) {
  console.log(
    "\n(Your merchant-runtime connection isn't self-serve on this deployment yet — ask Counter for those two values.)",
  );
}
console.log(
  `\nWhen your AI calls a purchase tool, it should pass wallet_id=${result.walletId} and agent_id=${result.agentId}.`,
);
