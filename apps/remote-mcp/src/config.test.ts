/**
 * Configuration is a security surface here, not boilerplate: a server that
 * boots without a Vault, without an Auth0 application, or without knowing its
 * own public URL would appear healthy and then fail — or worse, misbehave —
 * at request time. These tests pin the fail-loud behaviour.
 */
import { describe, expect, it } from "vitest";
import { loadConfig, stripTrailingSlash } from "./config.js";

const COMPLETE: NodeJS.ProcessEnv = {
  AUTH0_ISSUER_BASE_URL: "https://counter-test.us.auth0.com",
  AUTH0_MCP_CLIENT_ID: "fixed-app-id",
  AUTH0_MCP_CLIENT_SECRET: "fixed-app-secret",
  AUTH0_AUDIENCE: "https://api.counter.dev",
  PUBLIC_BASE_URL: "https://counter-remote-mcp.fly.dev",
  DATABASE_URL: "postgres://user:pass@host:5432/db",
  VAULT_ADDR: "http://counter-vault.internal:8200",
  VAULT_TOKEN: "vault-token",
  COUNTER_AGENT_RUNTIME_URL: "https://counter-agent-runtime.fly.dev",
};

describe("loadConfig", () => {
  it("reads a complete environment", () => {
    const config = loadConfig(COMPLETE);
    expect(config.auth0.issuerBaseUrl).toBe("https://counter-test.us.auth0.com");
    // Auth0 stamps `iss` WITH a trailing slash while its endpoints hang off
    // the base without one. Both forms are kept, deliberately.
    expect(config.auth0.tokenIssuer).toBe("https://counter-test.us.auth0.com/");
    expect(config.auth0.clientId).toBe("fixed-app-id");
    expect(config.publicBaseUrl).toBe("https://counter-remote-mcp.fly.dev");
    expect(config.vaultAddr).toBe("http://counter-vault.internal:8200");
    expect(config.controlPlaneUrl).toBeUndefined();
    expect(config.port).toBe(8080);
  });

  it("derives the issuer base URL from AUTH0_DOMAIN when the full URL is absent", () => {
    const { AUTH0_ISSUER_BASE_URL: _unused, ...rest } = COMPLETE;
    const config = loadConfig({ ...rest, AUTH0_DOMAIN: "counter-test.us.auth0.com" });
    expect(config.auth0.issuerBaseUrl).toBe("https://counter-test.us.auth0.com");
    expect(config.auth0.tokenIssuer).toBe("https://counter-test.us.auth0.com/");
  });

  it("normalises trailing slashes so URL concatenation never doubles up", () => {
    const config = loadConfig({
      ...COMPLETE,
      AUTH0_ISSUER_BASE_URL: "https://counter-test.us.auth0.com/",
      PUBLIC_BASE_URL: "https://counter-remote-mcp.fly.dev/",
      COUNTER_AGENT_RUNTIME_URL: "https://counter-agent-runtime.fly.dev/",
    });
    expect(config.auth0.issuerBaseUrl).toBe("https://counter-test.us.auth0.com");
    expect(config.publicBaseUrl).toBe("https://counter-remote-mcp.fly.dev");
    expect(config.agentRuntimeUrl).toBe("https://counter-agent-runtime.fly.dev");
    expect(stripTrailingSlash("https://x/")).toBe("https://x");
  });

  it.each([
    "AUTH0_MCP_CLIENT_ID",
    "AUTH0_MCP_CLIENT_SECRET",
    "AUTH0_AUDIENCE",
    "PUBLIC_BASE_URL",
    "DATABASE_URL",
    // Signing is core to every consequential tool: a missing Vault must fail
    // at BOOT, never degrade into a per-request surprise.
    "VAULT_ADDR",
    "VAULT_TOKEN",
    "COUNTER_AGENT_RUNTIME_URL",
  ])("throws when %s is missing", (name) => {
    const env = { ...COMPLETE };
    delete env[name];
    expect(() => loadConfig(env)).toThrow(new RegExp(`${name} is required`, "u"));
  });

  it("treats a whitespace-only value as missing", () => {
    expect(() => loadConfig({ ...COMPLETE, VAULT_TOKEN: "   " })).toThrow(
      /VAULT_TOKEN is required/u,
    );
  });

  it("throws when neither AUTH0_ISSUER_BASE_URL nor AUTH0_DOMAIN is set", () => {
    const { AUTH0_ISSUER_BASE_URL: _unused, ...rest } = COMPLETE;
    expect(() => loadConfig(rest)).toThrow(/AUTH0_DOMAIN is required/u);
  });

  it("keeps COUNTER_CONTROL_PLANE_URL optional (graceful absence, matching main-real.ts)", () => {
    const config = loadConfig({
      ...COMPLETE,
      COUNTER_CONTROL_PLANE_URL: "https://counter-control-plane-api.fly.dev/",
    });
    expect(config.controlPlaneUrl).toBe("https://counter-control-plane-api.fly.dev");
  });

  it("rejects a nonsense PORT rather than silently defaulting", () => {
    expect(() => loadConfig({ ...COMPLETE, PORT: "not-a-port" })).toThrow(/PORT/u);
    expect(() => loadConfig({ ...COMPLETE, PORT: "0" })).toThrow(/PORT/u);
    expect(() => loadConfig({ ...COMPLETE, PORT: "70000" })).toThrow(/PORT/u);
    expect(loadConfig({ ...COMPLETE, PORT: "3000" }).port).toBe(3000);
  });
});
