#!/usr/bin/env node
/**
 * Issues a signed counter.mandate.v1 envelope (client-side, using the
 * buyer's own Ed25519 key — never a server key, per ADR-0006) and durably
 * binds it into wallet.mandates, so a local-mcp purchase can actually pass
 * agent-runtime's checkMandateAuthority instead of failing with "No such
 * durable mandate".
 *
 * Split matches recurring-mandate-store.ts's confirmRegistration and
 * mandate-binding-store.ts's own header: the CLIENT builds+signs (this
 * script, standing in for apps/local-mcp, which holds the real key);
 * the SERVER independently verifies the signature against the agent's
 * REGISTERED public key and re-checks the referenced Razorpay recurring
 * mandate is active for this wallet before persisting — this script does
 * not trust its own signature, it calls the exact same MandateBindingService
 * apps/control-plane-api/src/main.ts wires into the real HTTP route.
 *
 * WHY THIS SCRIPT CALLS MandateBindingService DIRECTLY INSTEAD OF POSTing
 * to /control/v1/wallets/:walletId/mandates: that route requires an Auth0
 * wallet-owner JWT with step-up assurance, and this deployment's Auth0
 * tenant has no scripted way to mint one for a CLI-provisioned test wallet
 * (setting that up is separate, larger work — same class of gap
 * register-buyer-agent.mjs's header documents for the RBAC-gated
 * repository layer). This script constructs the exact same service-layer
 * objects (PostgresMandateRepository, PostgresCtpKeyRegistry,
 * RecurringMandateProvisioner) main.ts does, so the verification logic
 * exercised is identical to the real route — only the HTTP+Auth0 transport
 * is skipped.
 *
 * PREREQUISITES:
 *   - A wallet+agent identity already registered (register-buyer-agent.mjs)
 *   - An ACTIVE Razorpay recurring-mandate registration for that wallet
 *     (a human has completed the Razorpay Standard Checkout registration —
 *     this script cannot do that step; it only issues+binds the Counter
 *     WalletMandate against an already-active provider mandate)
 *   - `pnpm --filter @counter/data build && pnpm --filter @counter/wallet-domain build
 *      && pnpm --filter @counter/wallet-application build && pnpm --filter @counter/trust-protocol build
 *      && pnpm --filter @counter/domain build && pnpm --filter @counter/razorpay-adapter build
 *      && pnpm --filter @counter/control-plane-api build` (imports compiled dist, same
 *     convention as every other script in this directory)
 *
 * Usage:
 *   node scripts/issue-and-bind-wallet-mandate.mjs \
 *     --wallet-id ctr_wallet_... --agent-id ctr_agent_... --kid <kid> \
 *     --payment-reference-id ctr_payment-reference_... \
 *     [--principal-id ctr_actor_...] [--ceiling-minor 500000] [--valid-days 365] \
 *     [--merchant-id ctr_merchant_BwcHBwcHBwcHBwcHBwcHBw]
 *
 * SECURITY: never prints the private key. Reads DATABASE_URL / RAZORPAY_*
 * from .env, same as every other script here.
 */
import { readFileSync } from "node:fs";
import { fileURLToPath, pathToFileURL } from "node:url";
import { dirname, resolve } from "node:path";
import { randomUUID, createHash } from "node:crypto";
import readline from "node:readline/promises";

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
const walletId = args["wallet-id"];
const agentId = args["agent-id"];
const kid = args["kid"];
const paymentReferenceId = args["payment-reference-id"];
if (!walletId || !agentId || !kid || !paymentReferenceId) {
  console.error(
    "Usage: node issue-and-bind-wallet-mandate.mjs --wallet-id <id> --agent-id <id> --kid <kid> --payment-reference-id <id> [--principal-id <id>] [--ceiling-minor 500000] [--valid-days 365] [--merchant-id ctr_merchant_...]",
  );
  process.exit(1);
}
const principalId = args["principal-id"] ?? `ctr_actor_${walletId.replace(/^ctr_wallet_/, "")}`;
const ceilingMinor = BigInt(args["ceiling-minor"] ?? "500000"); // paise; PILOT.md per-transaction max = Rs 5,000
const validDays = Number(args["valid-days"] ?? "365");
const merchantId = args["merchant-id"] ?? "ctr_merchant_BwcHBwcHBwcHBwcHBwcHBw"; // apps/worker/src/boot.ts pilotMerchantId()

const databaseUrl = process.env.DATABASE_URL;
if (!databaseUrl) throw new Error("DATABASE_URL is required");
const environment = process.env.COUNTER_ENV ?? "test";
const razorpayKeyId = process.env.RAZORPAY_KEY_ID;
const razorpayKeySecret = process.env.RAZORPAY_KEY_SECRET;
if (!razorpayKeyId || !razorpayKeySecret)
  throw new Error("RAZORPAY_KEY_ID/RAZORPAY_KEY_SECRET are required");

const keyStorePath = process.env.COUNTER_WALLET_KEYSTORE_PATH;
let passphrase = process.env.COUNTER_WALLET_KEYSTORE_PASSPHRASE;
if (passphrase === undefined) {
  const rl = readline.createInterface({ input: process.stdin, output: process.stdout });
  passphrase = await rl.question("Passphrase for the wallet's key file: ");
  rl.close();
}
if (!passphrase || passphrase.trim().length === 0)
  throw new Error("A non-empty passphrase is required");

const { PostgresDatabase } = await importFromRepo("packages/data/dist/database.js");
const { PostgresMandateRepository } = await importFromRepo(
  "packages/data/dist/mandate-repository.js",
);
const { PostgresCtpKeyRegistry } = await importFromRepo("packages/data/dist/ctp-key-registry.js");
const { FileSecureKeyStore, defaultWalletKeyStorePath, InMemoryMandateRepository } =
  await importFromRepo("packages/wallet-domain/dist/index.js");
const { MandateService } = await importFromRepo(
  "packages/wallet-application/dist/mandate-service.js",
);
const { ConsentAttestationBuilder } = await importFromRepo(
  "packages/wallet-application/dist/consent-attestation.js",
);
const { signEnvelope } = await importFromRepo("packages/trust-protocol/dist/sign.js");
const { createRealRazorpayRecurringMandateProvider } = await importFromRepo(
  "packages/razorpay-adapter/dist/real-provider-factory.js",
);
const { RecurringMandateProvisioner } = await importFromRepo(
  "apps/control-plane-api/dist/recurring-mandate-store.js",
);
const { MandateBindingService } = await importFromRepo(
  "apps/control-plane-api/dist/mandate-binding-store.js",
);

const database = new PostgresDatabase(databaseUrl);

try {
  // --- 1. Load the agent's real key from the local FileSecureKeyStore ---
  const keyStore = new FileSecureKeyStore(keyStorePath ?? defaultWalletKeyStorePath());
  keyStore.unlockStore(passphrase);
  const descriptor = await keyStore.getPublicDescriptor(kid);
  if (!descriptor) {
    throw new Error(
      `No key '${kid}' found in the local key store — run register-buyer-agent.mjs first`,
    );
  }

  const now = new Date();
  const nowIso = now.toISOString();
  const validUntil = new Date(now.getTime() + validDays * 24 * 60 * 60 * 1000).toISOString();
  const attestationExpiry = new Date(now.getTime() + 5 * 60 * 1000).toISOString();

  // --- 2. Buyer policy constraints, clamped to sane pilot defaults; the
  // server independently re-clamps these to never exceed the underlying
  // Razorpay recurring mandate's own ceiling/merchants/operations/validity
  // (mandate-binding-store.ts's EXCEEDS_PROVIDER_MANDATE checks). ---
  const constraints = {
    merchantAllowlist: { allowedMerchantIds: [merchantId], allowedDomains: [] },
    geography: { allowedMerchantCountries: ["IN"], allowedDeliveryCountries: ["IN"] },
    category: { allowedCategories: [] },
    currency: { allowedCurrencies: ["INR"] },
    amountLimits: { perTransactionMaxPaise: ceilingMinor },
    countLimits: {},
    operations: { allowedOperations: ["purchase"] },
    timeConstraints: { expiresAt: validUntil },
    approvalThreshold: { thresholdPaise: ceilingMinor },
    paymentReferences: { allowedReferenceIds: [paymentReferenceId] },
  };

  // --- 3. Consent attestation: stands in for the human's actual consent
  // click, which apps/local-mcp / a wallet-console UI would collect in a
  // real deployment. Digest is what MandateService.issue() validates. ---
  const constraintsDigest = `sha256:${createHash("sha256")
    .update(
      JSON.stringify({
        paymentReferenceId,
        ceilingMinor: ceilingMinor.toString(),
        merchantId,
        validUntil,
      }),
    )
    .digest("hex")}`;

  const consentBuilder = new ConsentAttestationBuilder();
  const consentResult = consentBuilder.build({
    principal_id: principalId,
    wallet_id: walletId,
    object_type: "wallet_mandate_constraints",
    object_id: paymentReferenceId,
    object_digest: constraintsDigest,
    consent_operation: "mandate_creation",
    consent_variables: {
      merchant: merchantId,
      currency: "INR",
      amount: (Number(ceilingMinor) / 100).toFixed(2),
    },
    auth_provider: "counterx-cli",
    auth_method: "pilot_password",
    auth_assurance: "substantial",
    auth_timestamp: nowIso,
    audience: [`counter://wallet/${walletId}`, `counter://agent/${agentId}`],
    expiry: attestationExpiry,
    nonce: randomUUID(),
    environment: "pilot",
    kid,
    correlation_id: randomUUID(),
  });
  if (!consentResult.ok) {
    throw new Error(`Consent attestation failed: ${consentResult.error.reason}`);
  }
  const consentAttestationDigest = consentResult.value.payload_digest;

  // --- 4. Step-up session: stands in for the human's fresh strong-auth
  // step-up, same gap as above (see StepUpService's own docs — this
  // deployment has no wired step-up-auth UI yet). mandate_consent requires
  // 'substantial' assurance minimum. ---
  const stepUpSession = {
    principal_id: principalId,
    method: "pilot_password",
    assurance: "substantial",
    authenticated_at: nowIso,
    expires_at: attestationExpiry,
    nonce: randomUUID(),
  };

  // --- 5. Agent lookup: this deployment's AgentRegistrationService is
  // in-memory and register-buyer-agent.mjs writes identity.actors directly
  // (documented gap in that script's own header) — so there is no durable
  // AgentRegistration to query yet. Construct one reflecting exactly what
  // register-buyer-agent.mjs wrote (verified by getPublicDescriptor above),
  // since MandateService.issue() only reads .status/.publicKeyDescriptor.kid/.walletId. ---
  const agentLookup = (id) =>
    id === agentId
      ? {
          agentId,
          walletId,
          publicKeyDescriptor: {
            kid,
            publicKey: descriptor.publicKey,
            algorithm: "Ed25519",
            status: "active",
          },
          registeredAt: nowIso,
          deviceId: "ctr_device_cliProvisioned00000000000",
          status: "active",
          registrationCertificateDigest: "sha256:cli-provisioned",
        }
      : undefined;

  const mandateService = new MandateService(
    new InMemoryMandateRepository(), // throwaway sink — the real durable write is MandateBindingService.bind() below
    agentLookup,
    (digest) => digest === consentAttestationDigest,
  );

  const issueResult = await mandateService.issue({
    walletId,
    principalId,
    agentId,
    kid,
    constraints,
    paymentReferenceId,
    validFrom: nowIso,
    validUntil,
    consentAttestationDigest,
    policyVersionId: "cli-v1",
    stepUpSession,
    correlationId: randomUUID(),
  });
  if (!issueResult.ok) {
    throw new Error(`Mandate issuance failed: ${issueResult.error.reason}`);
  }

  // --- 6. Sign the envelope with the buyer's REAL key (never a test fixture) ---
  const signer = {
    kid,
    async sign(message) {
      return keyStore.sign(kid, message);
    },
  };
  const signedResult = await signEnvelope(issueResult.value.envelope, signer);
  if (!signedResult.ok) {
    throw new Error(`Envelope signing failed: ${signedResult.error.message}`);
  }

  console.log(
    `Issued + signed mandate ${issueResult.value.mandate.mandateId} for wallet ${walletId}`,
  );

  // --- 7. Bind: same service-layer objects the real HTTP route uses ---
  const mandateRepo = new PostgresMandateRepository(database, environment);
  const keyRegistry = new PostgresCtpKeyRegistry(database, environment);
  const razorpayRecurringProvider = createRealRazorpayRecurringMandateProvider({
    keyId: razorpayKeyId,
    keySecret: razorpayKeySecret,
    webhookSecret: process.env.RAZORPAY_WEBHOOK_SECRET || "",
    baseUrl: process.env.RAZORPAY_BASE_URL || "https://api.razorpay.com",
  });
  const recurringMandateProvisioner = new RecurringMandateProvisioner(
    database,
    environment,
    razorpayRecurringProvider,
  );
  const mandateBindingService = new MandateBindingService(
    mandateRepo,
    keyRegistry,
    recurringMandateProvisioner,
  );

  const bindResult = await mandateBindingService.bind(walletId, signedResult.value, new Date());
  if (!bindResult.ok) {
    throw new Error(
      `Mandate binding failed [${bindResult.error.code}]: ${bindResult.error.message}`,
    );
  }

  console.log("\nDurably bound WalletMandate:");
  console.log(`  mandateId:          ${bindResult.value.mandateId}`);
  console.log(`  walletId:           ${bindResult.value.walletId}`);
  console.log(`  agentId:            ${bindResult.value.agentId}`);
  console.log(`  paymentReferenceId: ${bindResult.value.paymentReferenceId}`);
  console.log(`  status:             ${bindResult.value.status}`);
  console.log(`  validFrom:          ${bindResult.value.validFrom}`);
  console.log(`  validUntil:         ${bindResult.value.validUntil}`);
} finally {
  await database.close();
}
