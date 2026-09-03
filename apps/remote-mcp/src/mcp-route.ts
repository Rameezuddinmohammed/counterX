/**
 * The actual MCP endpoint: Streamable HTTP transport at /mcp.
 *
 * ---------------------------------------------------------------------------
 * What guards this route
 * ---------------------------------------------------------------------------
 * NOT the MCP SDK's bearerAuth middleware. The access tokens our OAuth
 * provider hands out are genuine Auth0-issued tokens for Counter's own API
 * audience (that is the whole point of the two-legged proxy — see
 * oauth/provider.ts), so this repo's existing, already-tested guards work
 * unchanged:
 *
 *   authPlugin            verifies the RS256 JWT against Auth0's JWKS
 *   actorExtractionPlugin turns its https://counter.dev/ claims into an
 *                         ActorContext
 *   scopeEnforcementPlugin deny-by-default permission check
 *
 * On top of those, this route enforces the thing they cannot know: an MCP
 * session belongs to exactly one WALLET. A merchant_user or platform token is
 * rejected outright, and a session id may only ever be presented by the
 * wallet it was opened for.
 *
 * ---------------------------------------------------------------------------
 * Session model
 * ---------------------------------------------------------------------------
 * Standard stateful pattern: an `initialize` POST mints a session id, later
 * requests carry it in `mcp-session-id`, and the transport's `onclose`
 * removes the map entry. Each session gets its OWN McpServer and its OWN
 * VaultSecureKeyStore bound to that wallet — nothing is shared between
 * sessions except the process.
 *
 * Same single-machine caveat as the OAuth provider's ephemeral maps: sessions
 * live in this process. Running more than one machine requires sticky routing
 * on `mcp-session-id`, or a shared session store. Not built now; the seam is
 * this one Map.
 */
import { randomUUID } from "node:crypto";
import type { ServerResponse } from "node:http";
import type { FastifyInstance, FastifyReply, FastifyRequest } from "fastify";
import { StreamableHTTPServerTransport } from "@modelcontextprotocol/sdk/server/streamableHttp.js";
import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import type { Transport } from "@modelcontextprotocol/sdk/shared/transport.js";
import { isInitializeRequest } from "@modelcontextprotocol/sdk/types.js";
import { getActorContext, registerRoutePermission } from "@counter/http-api-kit";
import { HttpMerchantRuntimeClient, InMemoryRevocationStore } from "@counter/wallet-application";
import { createMcpServer, HttpWalletRuntimeClient } from "@counter/local-mcp";
import type { Environment } from "@counter/domain";
import { createCanonicalError } from "@counter/domain";
import type { WalletKeyStoreFactory } from "./key-store-factory.js";

const MCP_SESSION_HEADER = "mcp-session-id";

export interface McpRouteOptions {
  readonly keyStoreFactory: WalletKeyStoreFactory;
  /** Base URL of the deployed agent-runtime, e.g. https://counter-agent-runtime.fly.dev */
  readonly agentRuntimeUrl: string;
  /**
   * Base URL of control-plane-api. Optional, matching
   * apps/local-mcp/src/main-real.ts's graceful-absence idiom: without it the
   * wallet-scoped read tools (notifications.list / invoices.get) report
   * themselves unavailable instead of the whole server failing.
   */
  readonly controlPlaneUrl?: string | undefined;
  /** Defaults to "/mcp". */
  readonly path?: string | undefined;
}

interface McpSession {
  readonly transport: StreamableHTTPServerTransport;
  readonly server: McpServer;
  /** The one wallet this session was opened for. Never changes. */
  readonly walletId: string;
}

function headerValue(raw: string | string[] | undefined): string | undefined {
  if (typeof raw === "string" && raw.length > 0) return raw;
  if (Array.isArray(raw) && typeof raw[0] === "string" && raw[0].length > 0) return raw[0];
  return undefined;
}

function bearerToken(request: FastifyRequest): string | undefined {
  const authorization = request.headers.authorization;
  if (typeof authorization !== "string" || !authorization.startsWith("Bearer ")) {
    return undefined;
  }
  return authorization.slice(7);
}

/**
 * @fastify/express installs its own `headersSent` getter on the raw response
 * (it reports whether ITS Express-compatible `res.send` shim was used, which
 * is always false for us). The MCP transport writes to the raw Node response
 * directly and must see Node's real `headersSent`. The override is defined
 * `configurable: true`, so deleting the own property restores the genuine
 * prototype getter.
 *
 * Safe to call unconditionally: with no override present this is a no-op.
 */
export function restoreRawHeadersSent(raw: ServerResponse): void {
  if (Object.prototype.hasOwnProperty.call(raw, "headersSent")) {
    delete (raw as unknown as Record<string, unknown>)["headersSent"];
  }
}

function forbidden(reply: FastifyReply): unknown {
  const error = createCanonicalError("UNAUTHORIZED");
  return reply.status(403).send({ error: { code: error.code, message: error.message } });
}

/**
 * Existence-hiding 404. Same literal shape every other route in this repo
 * uses (see apps/control-plane-api/src/*-routes.ts) — "NOT_FOUND" is not a
 * @counter/domain canonical error code, it is the HTTP-surface convention.
 */
function notFound(reply: FastifyReply): unknown {
  return reply
    .status(404)
    .send({ error: { code: "NOT_FOUND", message: "The requested resource was not found" } });
}

export function registerMcpRoute(server: FastifyInstance, options: McpRouteOptions): void {
  const path = options.path ?? "/mcp";
  const sessions = new Map<string, McpSession>();

  // scopeEnforcementPlugin is deny-by-default: a route with an actor context
  // and no registered permission is refused with 403. Opening an MCP session
  // is a "read your own scope" act — every consequential thing a tool then
  // does (a purchase, a mandate) is gated separately and more strictly by the
  // wallet's own policy/mandate machinery inside @counter/local-mcp's write
  // tools, not by this HTTP-level permission. Same permission the
  // agent-runtime status route uses, and one a `wallet.owner` genuinely holds.
  for (const method of ["POST", "GET", "DELETE"] as const) {
    registerRoutePermission(`${method}:${path}`, { permission: "identity.scope.read" });
  }

  const handler = async (request: FastifyRequest, reply: FastifyReply): Promise<unknown> => {
    const actorContext = getActorContext(request);
    if (actorContext === undefined || actorContext.scope.kind !== "wallet") {
      // A merchant_user or platform token is authenticated but has no
      // business on a buyer's wallet MCP session. 403, not 404: the route
      // itself is not a tenant-scoped resource, so there is nothing to hide.
      return forbidden(reply);
    }
    const walletId: string = actorContext.scope.walletId;
    const environment: Environment = actorContext.scope.environment;

    const sessionId = headerValue(request.headers[MCP_SESSION_HEADER]);
    let session: McpSession;

    if (sessionId !== undefined) {
      const existing = sessions.get(sessionId);
      // Existence-hiding on a cross-tenant lookup: a session belonging to
      // another wallet is reported exactly like one that does not exist, so a
      // caller cannot probe for other wallets' live session ids.
      if (existing === undefined || existing.walletId !== walletId) {
        return notFound(reply);
      }
      session = existing;
    } else {
      if (request.method !== "POST" || !isInitializeRequest(request.body)) {
        return reply.status(400).send({
          jsonrpc: "2.0",
          error: {
            code: -32000,
            message: "Bad Request: no valid session ID provided",
          },
          id: null,
        });
      }
      session = await createSession({
        walletId,
        environment,
        request,
        options,
        sessions,
      });
    }

    // From here the raw Node response is owned by the transport: Fastify must
    // not also try to send a reply. `hijack()` is what stops it.
    restoreRawHeadersSent(reply.raw);
    reply.hijack();
    await session.transport.handleRequest(request.raw, reply.raw, request.body);
    return reply;
  };

  server.post(path, handler);
  // GET opens the standalone SSE stream; DELETE terminates a session. Both
  // are part of the Streamable HTTP transport and both go through the same
  // authentication, wallet gating and session lookup.
  server.get(path, handler);
  server.delete(path, handler);

  server.addHook("onClose", async () => {
    for (const session of sessions.values()) {
      await session.transport.close();
    }
    sessions.clear();
  });
}

async function createSession(input: {
  walletId: string;
  environment: Environment;
  request: FastifyRequest;
  options: McpRouteOptions;
  sessions: Map<string, McpSession>;
}): Promise<McpSession> {
  const { walletId, environment, request, options, sessions } = input;

  // The request's OWN verified bearer token is the identity this session
  // acts with when it calls the merchant runtime and control plane. Not a
  // separately-configured static service token: that would detach the
  // downstream calls from the human who actually authorized this session.
  const token = bearerToken(request);
  if (token === undefined) {
    // Unreachable behind authPlugin, which rejects a request with no Bearer
    // token before any handler runs. Thrown rather than defaulted because a
    // session with no caller identity must never be constructed.
    throw new Error("MCP session requires the caller's bearer token");
  }

  const keyStore = options.keyStoreFactory.create({ walletId, environment });
  const merchantClient = new HttpMerchantRuntimeClient(options.agentRuntimeUrl, token, new Map(), {
    environment,
  });
  const revocationStore = new InMemoryRevocationStore();

  const walletClient =
    options.controlPlaneUrl !== undefined && options.controlPlaneUrl.length > 0
      ? new HttpWalletRuntimeClient(options.controlPlaneUrl, token)
      : undefined;

  // createMcpServer is imported UNCHANGED from @counter/local-mcp — the tool
  // surface, the denylist and the write-tool policy prechecks are the same
  // code the local transport runs. Only the transport and the key custody
  // differ between local and remote.
  const server = createMcpServer({ keyStore, merchantClient, revocationStore }, walletClient);

  const transport = new StreamableHTTPServerTransport({
    sessionIdGenerator: () => randomUUID(),
    onsessioninitialized: (sessionId: string) => {
      sessions.set(sessionId, { transport, server, walletId });
    },
  });

  transport.onclose = () => {
    const id = transport.sessionId;
    if (id !== undefined) {
      sessions.delete(id);
    }
  };

  // Awaited, not fire-and-forget: connect() is what installs the transport's
  // message handlers. Calling handleRequest before it resolves would drop the
  // very `initialize` message that created this session.
  //
  // The cast works around an SDK typing defect, not a real mismatch:
  // StreamableHTTPServerTransport exposes `onclose` as a getter/setter typed
  // `(() => void) | undefined`, while the Transport interface declares it as
  // an optional property `onclose?: () => void`. Under this repo's
  // `exactOptionalPropertyTypes: true` those are not mutually assignable even
  // though they describe the same contract. Narrowed to this one line rather
  // than relaxing the compiler option for the whole app.
  await server.connect(transport as unknown as Transport);

  return { transport, server, walletId };
}
