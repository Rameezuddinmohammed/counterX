/**
 * Durable registry of dynamically-registered (RFC 7591 DCR) MCP clients.
 *
 * WHY THIS EXISTS: MCP hosts (Claude.ai and friends) require Dynamic Client
 * Registration; Counter's Auth0 tenant does not support it. So THIS server is
 * the authorization server the MCP client registers with, and this table is
 * that server's client registry. The single upstream Auth0 application is
 * fixed and human-registered (see config.ts) and never appears here.
 *
 * WHY IT LIVES IN THE APP, NOT packages/data: `platform.remote_mcp_clients`
 * is read and written by exactly one deployable (this one), and its rows are
 * meaningless to every other app in the monorepo. packages/data holds stores
 * with more than one consumer (the outbox, the spend ledger, wallet
 * balances). Keeping it here matches how apps/control-plane-api owns its own
 * mandate-binding-store.ts / merchant-webhook-endpoint-store.ts rather than
 * pushing single-consumer tables into the shared package. The MIGRATION is
 * still in packages/data/migrations (migrations are global and append-only).
 *
 * SECURITY: every client registered here is a PUBLIC client — PKCE-only,
 * `token_endpoint_auth_method: "none"`. There is deliberately no
 * client_secret column: a browser-based or desktop MCP host cannot keep a
 * secret, and inventing one would be security theatre that also has to be
 * stored. PKCE (verified by the SDK's own token handler against the
 * challenge our provider recorded) is the actual binding between the
 * authorization request and the token request.
 */
import { randomBytes } from "node:crypto";
import type { Environment } from "@counter/domain";
import type { TransactionalDatabase } from "@counter/data";

export interface RemoteMcpClientRecord {
  readonly clientId: string;
  readonly redirectUris: readonly string[];
  readonly clientName: string | undefined;
  readonly createdAt: Date;
}

export interface RemoteMcpClientInput {
  readonly clientId: string;
  readonly redirectUris: readonly string[];
  readonly clientName: string | undefined;
}

export interface RemoteMcpClientRepository {
  /**
   * Returns the client, or `undefined` when it does not exist. Never throws
   * for a not-found client: callers turn this into the OAuth-standard
   * `invalid_client` response, and an unknown client_id must be
   * indistinguishable from one registered in a different environment.
   */
  findById(clientId: string): Promise<RemoteMcpClientRecord | undefined>;
  create(input: RemoteMcpClientInput): Promise<RemoteMcpClientRecord>;
}

/**
 * Generates an opaque client_id.
 *
 * NOT a `createCounterId` value: packages/domain's reviewed id vocabulary
 * (COUNTER_ID_KINDS) has no kind for "an OAuth client some third-party MCP
 * host registered with us", and adding one would widen a shared, reviewed
 * domain vocabulary for a value that never crosses into the domain model —
 * it only ever travels back out to the client as an opaque OAuth
 * `client_id`. 256 bits of entropy, base64url, prefixed for greppability.
 */
export function generateMcpClientId(): string {
  return `mcpc_${randomBytes(32).toString("base64url")}`;
}

interface RemoteMcpClientRow {
  client_id: string;
  redirect_uris: string[];
  client_name: string | null;
  created_at: Date;
}

function toRecord(row: RemoteMcpClientRow): RemoteMcpClientRecord {
  return {
    clientId: row.client_id,
    redirectUris: row.redirect_uris,
    clientName: row.client_name ?? undefined,
    createdAt: row.created_at,
  };
}

export class PostgresRemoteMcpClientRepository implements RemoteMcpClientRepository {
  constructor(
    private readonly database: TransactionalDatabase,
    private readonly environment: Environment,
  ) {}

  async findById(clientId: string): Promise<RemoteMcpClientRecord | undefined> {
    const result = await this.database.query<RemoteMcpClientRow>(
      `SELECT client_id, redirect_uris, client_name, created_at
         FROM platform.remote_mcp_clients
        WHERE environment = $1 AND client_id = $2`,
      [this.environment, clientId],
    );
    const row = result.rows[0];
    return row === undefined ? undefined : toRecord(row);
  }

  async create(input: RemoteMcpClientInput): Promise<RemoteMcpClientRecord> {
    const result = await this.database.query<RemoteMcpClientRow>(
      `INSERT INTO platform.remote_mcp_clients
         (environment, client_id, redirect_uris, client_name)
       VALUES ($1, $2, $3, $4)
       RETURNING client_id, redirect_uris, client_name, created_at`,
      [this.environment, input.clientId, [...input.redirectUris], input.clientName ?? null],
    );
    const row = result.rows[0];
    if (row === undefined) {
      // Unreachable for a successful INSERT ... RETURNING, but this codebase
      // does not guess a write into success.
      throw new Error("remote_mcp_clients insert returned no row");
    }
    return toRecord(row);
  }
}

/**
 * In-memory repository for unit tests and local runs without a database.
 * Deliberately exported from the app (not test-only) so the OAuth provider's
 * tests can exercise the real provider against a real repository
 * implementation rather than a hand-rolled mock per test file.
 */
export class InMemoryRemoteMcpClientRepository implements RemoteMcpClientRepository {
  readonly #rows = new Map<string, RemoteMcpClientRecord>();

  async findById(clientId: string): Promise<RemoteMcpClientRecord | undefined> {
    return this.#rows.get(clientId);
  }

  async create(input: RemoteMcpClientInput): Promise<RemoteMcpClientRecord> {
    const record: RemoteMcpClientRecord = {
      clientId: input.clientId,
      redirectUris: [...input.redirectUris],
      clientName: input.clientName,
      createdAt: new Date(),
    };
    this.#rows.set(record.clientId, record);
    return record;
  }
}
