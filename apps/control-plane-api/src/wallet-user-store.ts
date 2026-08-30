/**
 * Direct-SQL provisioning for self-serve wallet onboarding: turns a real
 * login into a real wallet, and lets that wallet's owner register an agent's
 * signing key over HTTP instead of an operator running a script by hand.
 *
 * Writes go straight through parameterized SQL (matching the exact insert
 * shapes proven tonight by apps/local-mcp/scripts/register-buyer-agent.mjs)
 * rather than the RBAC-gated PostgresIdentityRepositories: that repository's
 * ScopedTransactionManager requires the database connection to already be
 * authenticated as a specifically restricted, non-bypassing Postgres role
 * (see packages/data/src/scoped-transaction.ts's assertRuntimeRolePosture) —
 * infrastructure this deployment doesn't have configured. Setting that up is
 * separate, larger work; every other durable write in this codebase already
 * makes the same trade-off (see PostgresQuoteStore, the migration/policy-seed
 * scripts).
 *
 * SECURITY: this endpoint's surface is now reachable over public HTTP where
 * the equivalent script was previously operator-only — a materially larger
 * attack surface on the same trust boundary. The setup-token flow (mint,
 * hash, single-use, 15-minute expiry) is the actual gate on who can
 * register a key for a given wallet; the raw token is never stored, only
 * its SHA-256 hash.
 */
import { randomBytes, createHash } from "node:crypto";
import type { Environment } from "@counter/domain";
import { createCounterId, parseCounterId } from "@counter/domain";
import type { TransactionalDatabase } from "@counter/data";

const SETUP_TOKEN_TTL_MS = 15 * 60 * 1000;

export interface ProvisionResult {
  readonly walletId: string;
  readonly walletUserActorId: string;
  readonly created: boolean;
}

export interface SetupTokenResult {
  readonly setupToken: string;
  readonly expiresAt: string;
}

export interface AgentKeyResult {
  readonly agentId: string;
  readonly keyId: string;
}

/**
 * Credentials for the ONE shared merchant-runtime M2M client
 * ("Counter Agent Runtime (M2M)") this deployment already uses for the
 * founder's own real MCP entrypoint. Reused here — not a new Auth0 app —
 * because its Credentials Exchange Action already stamps exactly the
 * merchant-scoped claims apps/agent-runtime expects.
 *
 * KNOWN LIMITATION (tracked in the onboarding plan, not silently papered
 * over): every self-serve buyer's AI gets a token from this SAME shared
 * client. purchase.execute stays individually safe (gated by each buyer's
 * own signature), but in principle any holder could call cancel/refund on
 * a transaction that isn't theirs. Acceptable for a test-mode pilot with a
 * small number of real users; scoping this down per-buyer is real follow-up
 * work, not solved here.
 */
export interface RuntimeCredentialConfig {
  readonly clientId: string;
  readonly clientSecret: string;
  readonly runtimeUrl: string;
}

export interface RuntimeCredentialResult {
  readonly runtimeUrl: string;
  readonly runtimeAuthToken: string;
  readonly expiresAt: string;
}

/**
 * Structural interface for WalletUserProvisioner's public surface — lets
 * wallet-user-routes.ts (and its tests) depend on the interface rather than
 * the concrete direct-SQL class, matching PolicyStore/TransactionReadStore's
 * existing separation in this app.
 */
export interface WalletUserProvisionerLike {
  provisionForAuth0Subject(auth0Subject: string): Promise<ProvisionResult>;
  mintSetupToken(walletId: string): Promise<SetupTokenResult>;
  redeemSetupToken(rawToken: string): Promise<string | undefined>;
  registerAgentKey(
    walletId: string,
    keyId: string,
    publicKeyBase64Url: string,
  ): Promise<AgentKeyResult>;
  /**
   * Mints a merchant-runtime access token so a freshly self-served agent can
   * actually reach a merchant, not just register a key. Throws if this
   * deployment has no runtime credential configured — callers should treat
   * that as an optional, gracefully-degradable step (see wallet-user-routes.ts).
   */
  mintRuntimeCredential(): Promise<RuntimeCredentialResult>;
}

function requireCounterId(
  kind: Parameters<typeof createCounterId>[0],
  entropy: Uint8Array,
): string {
  const result = createCounterId(kind, entropy);
  if (!result.ok) {
    throw new Error(`Failed to derive a ${kind} id: ${result.error.message}`);
  }
  return result.value as unknown as string;
}

function hashToken(rawToken: string): string {
  return createHash("sha256").update(rawToken, "utf8").digest("hex");
}

const AUTH0_TOKEN_URL = "https://dev-jzw3etjxnn3svs56.us.auth0.com/oauth/token";
const RUNTIME_AUDIENCE = "https://api.counter.dev";

export class WalletUserProvisioner implements WalletUserProvisionerLike {
  constructor(
    private readonly database: TransactionalDatabase,
    private readonly environment: Environment,
    private readonly runtimeCredentialConfig?: RuntimeCredentialConfig,
  ) {}

  /** Idempotent: a repeat login for the same Auth0 subject returns the same wallet. */
  async provisionForAuth0Subject(auth0Subject: string): Promise<ProvisionResult> {
    const existing = await this.database.query<{ wallet_id: string; wallet_user_actor_id: string }>(
      `SELECT wallet_id, wallet_user_actor_id FROM identity.wallet_users
        WHERE environment = $1 AND auth0_subject = $2`,
      [this.environment, auth0Subject],
    );
    const row = existing.rows[0];
    if (row !== undefined) {
      return {
        walletId: row.wallet_id,
        walletUserActorId: row.wallet_user_actor_id,
        created: false,
      };
    }

    const walletId = requireCounterId("wallet", randomBytes(16));
    const walletUserActorId = requireCounterId("wallet-user", randomBytes(16));
    const now = new Date().toISOString();

    await this.database.transaction(async (session) => {
      await session.query(
        `INSERT INTO identity.scope_registry (environment, scope_kind, scope_id, created_at)
         VALUES ($1, 'wallet', $2, $3)`,
        [this.environment, walletId, now],
      );
      await session.query(
        `INSERT INTO wallet.scopes (environment, scope_kind, wallet_id, created_at)
         VALUES ($1, 'wallet', $2, $3)`,
        [this.environment, walletId, now],
      );
      await session.query(
        `INSERT INTO identity.actors (
           environment, actor_kind, actor_id, owner_scope_kind, owner_scope_id, status, created_at
         ) VALUES ($1, 'wallet_user', $2, 'wallet', $3, 'active', $4)`,
        [this.environment, walletUserActorId, walletId, now],
      );
      await session.query(
        `INSERT INTO identity.wallet_users (
           environment, auth0_subject, wallet_id, wallet_user_actor_id, created_at
         ) VALUES ($1, $2, $3, $4, $5)`,
        [this.environment, auth0Subject, walletId, walletUserActorId, now],
      );
    });

    return { walletId, walletUserActorId, created: true };
  }

  /** Mints a short-lived, single-use token the caller's local setup script exchanges for key registration. */
  async mintSetupToken(walletId: string): Promise<SetupTokenResult> {
    const rawToken = randomBytes(32).toString("base64url");
    const tokenHash = hashToken(rawToken);
    const now = new Date();
    const expiresAt = new Date(now.getTime() + SETUP_TOKEN_TTL_MS);

    await this.database.query(
      `INSERT INTO identity.wallet_setup_tokens (environment, token_hash, wallet_id, created_at, expires_at)
       VALUES ($1, $2, $3, $4, $5)`,
      [this.environment, tokenHash, walletId, now.toISOString(), expiresAt.toISOString()],
    );

    return { setupToken: rawToken, expiresAt: expiresAt.toISOString() };
  }

  /** Redeems a setup token exactly once. Returns the wallet id, or undefined if invalid/expired/already used. */
  async redeemSetupToken(rawToken: string): Promise<string | undefined> {
    const tokenHash = hashToken(rawToken);
    return this.database.transaction(async (session) => {
      const result = await session.query<{ wallet_id: string }>(
        `UPDATE identity.wallet_setup_tokens
            SET used_at = clock_timestamp()
          WHERE environment = $1
            AND token_hash = $2
            AND used_at IS NULL
            AND expires_at > clock_timestamp()
        RETURNING wallet_id`,
        [this.environment, tokenHash],
      );
      return result.rows[0]?.wallet_id;
    });
  }

  /**
   * Registers a new agent signing key for an already-provisioned wallet.
   *
   * keyId is supplied by the caller, not generated here: it must be the same
   * id the local signing script's key store already assigned the private
   * key (FileSecureKeyStore.generateKey), because that id is what future
   * sign() calls use as the CTP envelope's "kid" — the server verifies a
   * purchase signature by looking up this exact key_id. Generating our own
   * id here would silently break every purchase this agent ever tries to
   * sign.
   */
  async registerAgentKey(
    walletId: string,
    keyId: string,
    publicKeyBase64Url: string,
  ): Promise<AgentKeyResult> {
    const walletExists = await this.database.query(
      `SELECT 1 FROM wallet.scopes WHERE environment = $1 AND wallet_id = $2`,
      [this.environment, walletId],
    );
    if (walletExists.rows.length === 0) {
      throw new Error(`No such wallet: ${walletId}`);
    }

    const parsedKeyId = parseCounterId(keyId, "key");
    if (!parsedKeyId.ok) {
      throw new Error(`Invalid keyId: ${parsedKeyId.error.message}`);
    }

    const agentId = requireCounterId("agent", randomBytes(16));
    const now = new Date().toISOString();

    await this.database.transaction(async (session) => {
      await session.query(
        `INSERT INTO identity.actors (
           environment, actor_kind, actor_id, owner_scope_kind, owner_scope_id, status, created_at
         ) VALUES ($1, 'registered_agent', $2, 'wallet', $3, 'active', $4)`,
        [this.environment, agentId, walletId, now],
      );
      await session.query(
        `INSERT INTO identity.agent_public_keys (
           environment, owner_scope_kind, owner_scope_id, key_id, actor_kind,
           agent_id, algorithm, public_key_base64url, created_at, not_before
         ) VALUES ($1, 'wallet', $2, $3, 'registered_agent', $4, 'Ed25519', $5, $6, $6)`,
        [this.environment, walletId, keyId, agentId, publicKeyBase64Url, now],
      );
    });

    return { agentId, keyId };
  }

  /** See RuntimeCredentialConfig's docs for the shared-credential trade-off this makes. */
  async mintRuntimeCredential(): Promise<RuntimeCredentialResult> {
    if (this.runtimeCredentialConfig === undefined) {
      throw new Error("No runtime credential is configured for this deployment");
    }
    const { clientId, clientSecret, runtimeUrl } = this.runtimeCredentialConfig;

    const response = await fetch(AUTH0_TOKEN_URL, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        client_id: clientId,
        client_secret: clientSecret,
        audience: RUNTIME_AUDIENCE,
        grant_type: "client_credentials",
      }),
    });
    if (!response.ok) {
      throw new Error("Could not mint a merchant-runtime credential");
    }

    const body = (await response.json()) as { access_token: string; expires_in: number };
    const expiresAt = new Date(Date.now() + body.expires_in * 1000).toISOString();
    return { runtimeUrl, runtimeAuthToken: body.access_token, expiresAt };
  }
}
