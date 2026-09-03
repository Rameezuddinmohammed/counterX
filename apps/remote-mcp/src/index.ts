/**
 * apps/remote-mcp
 *
 * Counter's MCP tool surface over a REMOTE Streamable HTTP transport, gated
 * by a real OAuth 2.1 authorization server this app implements itself.
 *
 * ---------------------------------------------------------------------------
 * The problem this app solves
 * ---------------------------------------------------------------------------
 * MCP hosts (Claude.ai and friends) can only connect to a remote MCP server
 * if they can register themselves with its authorization server via RFC 7591
 * Dynamic Client Registration. Counter's Auth0 tenant does not support DCR,
 * and an Auth0 application's callback URLs are a fixed, human-configured
 * allowlist — it cannot accept a different redirect_uri per MCP client.
 *
 * So this app IS the authorization server the MCP client registers with, and
 * it two-leg proxies Auth0 behind a single fixed, pre-registered Auth0
 * application. The tokens it hands out are genuine Auth0 tokens for Counter's
 * own API audience, which is what lets /mcp be guarded by the repo's existing
 * authPlugin/actorExtractionPlugin with no changes at all. See
 * oauth/provider.ts for the full flow and for why the MCP SDK's stock
 * ProxyOAuthServerProvider cannot be used.
 *
 * ---------------------------------------------------------------------------
 * Route map
 * ---------------------------------------------------------------------------
 *   PUBLIC (skipAuthRoutes — these ARE the unauthenticated OAuth dance):
 *     GET/POST /authorize                             SDK handler
 *     POST     /token                                 SDK handler
 *     POST     /register                              SDK handler (DCR)
 *     POST     /revoke                                SDK handler
 *     GET      /.well-known/oauth-authorization-server    RFC 8414
 *     GET      /.well-known/oauth-protected-resource/mcp  RFC 9728
 *     GET      /oauth/callback                        ours (Auth0 -> us)
 *
 *   AUTHENTICATED (behind authPlugin + actorExtraction + scope enforcement):
 *     POST/GET/DELETE /mcp                            Streamable HTTP
 */
import type { FastifyInstance } from "fastify";
import type { JWTVerifyGetKey } from "jose";
import {
  createHttpServer,
  attachGracefulShutdown,
  type ServerFactoryOptions,
} from "@counter/http-api-kit";
import type { Auth0Config } from "./config.js";
import { CounterOAuthServerProvider } from "./oauth/provider.js";
import { OAUTH_PUBLIC_ROUTES, registerOAuthRoutes } from "./oauth/oauth-router.js";
import type { RemoteMcpClientRepository } from "./oauth/client-repository.js";
import { registerMcpRoute } from "./mcp-route.js";
import type { WalletKeyStoreFactory } from "./key-store-factory.js";
import { createAuth0TokenVerifier } from "./token-verifier.js";

export const APP_NAME = "@counter/remote-mcp";
export const MCP_PATH = "/mcp";

const DEFAULT_VERSION = "0.1.0";
const DEFAULT_ENVIRONMENT = "local";

export interface CreateServerOptions {
  readonly auth0: Auth0Config;
  readonly publicBaseUrl: string;
  readonly clients: RemoteMcpClientRepository;
  readonly keyStoreFactory: WalletKeyStoreFactory;
  readonly agentRuntimeUrl: string;
  readonly controlPlaneUrl?: string | undefined;
  readonly version?: string | undefined;
  readonly environment?: string | undefined;
  /** Injectable key source so tests never reach Auth0's JWKS endpoint. */
  readonly jwks?: JWTVerifyGetKey | string | undefined;
  readonly logger?: boolean | undefined;
  /** Injectable for tests (fake Auth0 HTTP layer). */
  readonly fetchImpl?: typeof fetch | undefined;
}

export interface RemoteMcpServer {
  readonly server: FastifyInstance;
  readonly provider: CounterOAuthServerProvider;
}

/**
 * Builds the app. Async because @fastify/express must be registered (and
 * awaited) before `fastify.use()` can mount the SDK's Express routers — see
 * oauth/oauth-router.ts.
 */
export async function createServer(options: CreateServerOptions): Promise<RemoteMcpServer> {
  const version = options.version ?? DEFAULT_VERSION;
  const environment = options.environment ?? DEFAULT_ENVIRONMENT;

  const provider = new CounterOAuthServerProvider({
    auth0: options.auth0,
    publicBaseUrl: options.publicBaseUrl,
    clients: options.clients,
    verifyAccessToken: createAuth0TokenVerifier({
      auth0: options.auth0,
      ...(typeof options.jwks === "object" && options.jwks !== null ? { jwks: options.jwks } : {}),
    }),
    ...(options.fetchImpl !== undefined ? { fetchImpl: options.fetchImpl } : {}),
  });

  const serverOptions: ServerFactoryOptions = {
    name: APP_NAME,
    version,
    environment,
    auth: {
      // Auth0 stamps `iss` WITH a trailing slash; the endpoints hang off the
      // base without one. config.ts keeps both, deliberately.
      issuer: options.auth0.tokenIssuer,
      audience: options.auth0.audience,
      jwks: options.jwks ?? `${options.auth0.issuerBaseUrl}/.well-known/jwks.json`,
      // Lets a 401 from /mcp carry a WWW-Authenticate header pointing an MCP
      // client's discovery flow at this exact resource's metadata document
      // (RFC 9728) - without it, discovery has nothing to follow and a
      // client falls back to asking a human to configure the connector by
      // hand. Same path the SDK's own mcpAuthMetadataRouter serves this at
      // (see oauth-router.ts) - confirmed by pointing a real Claude.ai
      // Connector at the deployed server and finding the gap.
      resourceMetadataUrl: `${options.publicBaseUrl}/.well-known/oauth-protected-resource${MCP_PATH}`,
    },
    // Every path the OAuth dance itself lives on. A client calling these has
    // no token yet by definition — requiring one would make the flow
    // impossible to start. /mcp is deliberately NOT in this list.
    skipAuthRoutes: [...OAUTH_PUBLIC_ROUTES],
    logger: options.logger ?? false,
  };

  const server = createHttpServer(serverOptions);

  await registerOAuthRoutes(server, {
    provider,
    publicBaseUrl: options.publicBaseUrl,
    mcpPath: MCP_PATH,
  });

  registerMcpRoute(server, {
    keyStoreFactory: options.keyStoreFactory,
    agentRuntimeUrl: options.agentRuntimeUrl,
    controlPlaneUrl: options.controlPlaneUrl,
    path: MCP_PATH,
  });

  provider.startSweeping();
  server.addHook("onClose", async () => {
    provider.stopSweeping();
  });

  return { server, provider };
}

export async function startServer(options: CreateServerOptions): Promise<RemoteMcpServer> {
  const built = await createServer(options);
  attachGracefulShutdown(built.server);
  return built;
}

export { CounterOAuthServerProvider } from "./oauth/provider.js";
export {
  PostgresRemoteMcpClientRepository,
  InMemoryRemoteMcpClientRepository,
} from "./oauth/client-repository.js";
export type {
  RemoteMcpClientRepository,
  RemoteMcpClientRecord,
} from "./oauth/client-repository.js";
export { createVaultKeyStoreFactory } from "./key-store-factory.js";
export type { WalletKeyStoreFactory } from "./key-store-factory.js";
export { loadConfig } from "./config.js";
export type { RemoteMcpConfig, Auth0Config } from "./config.js";
