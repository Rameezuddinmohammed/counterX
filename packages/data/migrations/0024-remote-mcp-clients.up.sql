-- Phase 3 of the remote-MCP plan: the OAuth 2.1 client registry for
-- apps/remote-mcp.
--
-- WHY THIS TABLE EXISTS AT ALL: MCP hosts (Claude.ai and friends) discover a
-- remote MCP server's authorization server via RFC 8414 metadata and then
-- REGISTER THEMSELVES with it via RFC 7591 Dynamic Client Registration. They
-- have no pre-shared client_id and no way to obtain one out of band. Counter's
-- Auth0 tenant does not support DCR, and an Auth0 application's callback URLs
-- are a fixed, human-configured allowlist — it cannot accept a different
-- redirect_uri per MCP client.
--
-- So apps/remote-mcp is itself a real authorization server that two-leg
-- proxies Auth0: MCP clients register HERE (this table), while exactly ONE
-- fixed, human-registered Auth0 application — never stored in the database —
-- is used for every upstream call. See apps/remote-mcp/src/oauth/provider.ts
-- for the full flow.
--
-- NO CLIENT SECRET COLUMN, DELIBERATELY. Every row here is a PUBLIC client
-- (`token_endpoint_auth_method: "none"`, PKCE-only), which is what a browser-
-- based or desktop MCP host actually is. Issuing a secret to a client that
-- provably cannot keep one would be security theatre AND would create a real
-- credential to protect at rest. The binding between an authorization request
-- and its token request is PKCE (S256), verified by the MCP SDK's own token
-- handler against the code_challenge the provider recorded — see
-- CounterOAuthServerProvider.challengeForAuthorizationCode.
--
-- Rows here confer NO authority by themselves. Registering only lets a client
-- START an OAuth flow; the access token it eventually receives is a genuine
-- Auth0-issued token for a real human buyer who signed in, and every
-- authorization decision downstream is made from THAT token's claims
-- (apps/remote-mcp's /mcp route re-checks the actor scope on every request).
--
-- client_id is an opaque 256-bit random string, NOT a createCounterId value:
-- packages/domain's reviewed id vocabulary has no kind for "an OAuth client a
-- third-party MCP host registered with us", and this value never enters the
-- domain model — it only travels back out as an opaque OAuth client_id.
--
-- Partitioned by environment like every other Counter table, so a client
-- registered against the sandbox deployment is invisible to production. A
-- lookup that misses returns not-found, never "wrong environment".
--
-- RLS is enabled and forced with NO policies, matching every other
-- direct-SQL-written table in this repo (wallet.vault_keys, migration 0023;
-- merchant.webhook_endpoints, migration 0022; merchant.shopify_connections,
-- migration 0013 — see 0013's header for the full rationale): written
-- exclusively via parameterized SQL from a role that bypasses RLS. No
-- policies means any future non-bypassing role is denied by default until
-- real RBAC policies are added.

CREATE TABLE platform.remote_mcp_clients (
  environment platform.counter_environment NOT NULL,
  client_id text NOT NULL,
  redirect_uris text[] NOT NULL,
  client_name text,
  created_at timestamptz NOT NULL DEFAULT clock_timestamp(),
  PRIMARY KEY (environment, client_id),
  CONSTRAINT remote_mcp_clients_client_id_not_empty CHECK (char_length(client_id) > 0),
  -- A client with zero redirect URIs could never complete a flow, and the
  -- authorize handler's "fall back to the single registered URI" branch
  -- depends on this array being non-empty.
  -- COALESCE because array_length() of an empty array is NULL, and a NULL
  -- CHECK expression passes.
  CONSTRAINT remote_mcp_clients_redirect_uris_present
    CHECK (COALESCE(array_length(redirect_uris, 1), 0) >= 1),
  -- Absolute http(s) URIs only, for EVERY element. A CHECK constraint cannot
  -- contain a subquery, so the array is joined on a space — a character no
  -- valid URI may contain unencoded — and matched as a whole. The application
  -- additionally rejects fragments and non-http(s) schemes at registration
  -- time (isAcceptableRedirectUri); this is the durable backstop that keeps a
  -- malformed row from ever becoming an open redirect if that code path is
  -- later changed. Verified against PostgreSQL 17.4: accepts
  -- {https://claude.ai/api/mcp/auth_callback} and a two-element
  -- https+http-loopback array; rejects {}, {javascript:alert(1)}, and an
  -- array mixing a good https URI with ftp://.
  CONSTRAINT remote_mcp_clients_redirect_uris_absolute
    CHECK (array_to_string(redirect_uris, ' ') ~ '^https?://\S*( https?://\S*)*$')
);

ALTER TABLE platform.remote_mcp_clients ENABLE ROW LEVEL SECURITY;
ALTER TABLE platform.remote_mcp_clients FORCE ROW LEVEL SECURITY;
