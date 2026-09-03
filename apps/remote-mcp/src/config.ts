/**
 * Environment configuration for apps/remote-mcp.
 *
 * Everything here is CORE to the app, not optional: the OAuth authorization
 * server cannot function without a real upstream Auth0 application, and the
 * MCP tools cannot sign anything without a real Vault. So every required
 * value uses the same fail-loud `requireEnv` idiom as
 * apps/local-mcp/src/main-real.ts — a missing value throws at boot rather
 * than degrading into a silently-broken deployment.
 *
 * The single OPTIONAL value is COUNTER_CONTROL_PLANE_URL, matching
 * main-real.ts's graceful-absence idiom: without it the wallet-scoped read
 * tools (notifications.list / invoices.get) stay honestly "unavailable"
 * rather than failing the whole server.
 */

function requireEnv(env: NodeJS.ProcessEnv, name: string): string {
  const value = env[name];
  if (value === undefined || value.trim().length === 0) {
    throw new Error(`${name} is required to run @counter/remote-mcp`);
  }
  return value.trim();
}

function optionalEnv(env: NodeJS.ProcessEnv, name: string): string | undefined {
  const value = env[name];
  if (value === undefined || value.trim().length === 0) {
    return undefined;
  }
  return value.trim();
}

/** Strips a single trailing slash so `${base}/path` never doubles up. */
export function stripTrailingSlash(value: string): string {
  return value.endsWith("/") ? value.slice(0, -1) : value;
}

export interface Auth0Config {
  /** e.g. "https://dev-xxxx.us.auth0.com" — no trailing slash. */
  readonly issuerBaseUrl: string;
  /**
   * The issuer as it appears in a token's `iss` claim. Auth0 issues tokens
   * with a TRAILING slash, while its /authorize and /oauth/token endpoints
   * hang off the non-slashed base — hence two separate fields rather than
   * one that silently means both.
   */
  readonly tokenIssuer: string;
  /**
   * The ONE fixed, human-pre-registered, confidential Auth0 application this
   * server proxies through. Downstream MCP clients register dynamically with
   * US; they never reach Auth0 with an identity of their own.
   */
  readonly clientId: string;
  readonly clientSecret: string;
  /** Counter's existing API audience, e.g. "https://api.counter.dev". */
  readonly audience: string;
}

export interface RemoteMcpConfig {
  readonly auth0: Auth0Config;
  /** This app's own public https origin, e.g. "https://counter-remote-mcp.fly.dev". */
  readonly publicBaseUrl: string;
  readonly databaseUrl: string;
  readonly vaultAddr: string;
  readonly vaultToken: string;
  readonly agentRuntimeUrl: string;
  readonly controlPlaneUrl: string | undefined;
  readonly port: number;
}

/**
 * Reads and validates the full runtime configuration. Throws on the first
 * missing/invalid value.
 */
export function loadConfig(env: NodeJS.ProcessEnv = process.env): RemoteMcpConfig {
  const issuerBaseUrl = stripTrailingSlash(
    env["AUTH0_ISSUER_BASE_URL"] !== undefined && env["AUTH0_ISSUER_BASE_URL"].trim().length > 0
      ? requireEnv(env, "AUTH0_ISSUER_BASE_URL")
      : `https://${requireEnv(env, "AUTH0_DOMAIN")}`,
  );

  const publicBaseUrl = stripTrailingSlash(requireEnv(env, "PUBLIC_BASE_URL"));
  const controlPlaneUrl = optionalEnv(env, "COUNTER_CONTROL_PLANE_URL");

  const portRaw = env["PORT"] ?? "8080";
  const port = Number.parseInt(portRaw, 10);
  if (!Number.isInteger(port) || port <= 0 || port > 65_535) {
    throw new Error(`PORT must be a valid TCP port, got '${portRaw}'`);
  }

  return {
    auth0: {
      issuerBaseUrl,
      tokenIssuer: `${issuerBaseUrl}/`,
      clientId: requireEnv(env, "AUTH0_MCP_CLIENT_ID"),
      clientSecret: requireEnv(env, "AUTH0_MCP_CLIENT_SECRET"),
      audience: requireEnv(env, "AUTH0_AUDIENCE"),
    },
    publicBaseUrl,
    databaseUrl: requireEnv(env, "DATABASE_URL"),
    // Signing is core to every consequential tool this server exposes, so a
    // missing Vault is a boot-time failure — NOT a graceful degradation that
    // would surface as a confusing per-request error later.
    vaultAddr: requireEnv(env, "VAULT_ADDR"),
    vaultToken: requireEnv(env, "VAULT_TOKEN"),
    agentRuntimeUrl: stripTrailingSlash(requireEnv(env, "COUNTER_AGENT_RUNTIME_URL")),
    ...(controlPlaneUrl !== undefined
      ? { controlPlaneUrl: stripTrailingSlash(controlPlaneUrl) }
      : { controlPlaneUrl: undefined }),
    port,
  };
}
