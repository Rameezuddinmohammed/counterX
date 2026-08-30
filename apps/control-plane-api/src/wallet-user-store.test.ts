import { afterEach, describe, expect, it, vi } from "vitest";
import { WalletUserProvisioner } from "./wallet-user-store.js";

/**
 * Unit coverage for WalletUserProvisioner.mintRuntimeCredential() — the one
 * method that doesn't touch the database, so it doesn't need the
 * DATABASE_URL-gated integration test's real Supabase connection.
 */
describe("WalletUserProvisioner.mintRuntimeCredential", () => {
  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it("throws a clear error when no runtime credential is configured", async () => {
    const provisioner = new WalletUserProvisioner({} as never, "test");
    await expect(provisioner.mintRuntimeCredential()).rejects.toThrow(
      "No runtime credential is configured for this deployment",
    );
  });

  it("requests a client-credentials token from Auth0 and returns it", async () => {
    const fetchMock = vi.fn().mockResolvedValue({
      ok: true,
      json: async () => ({ access_token: "real-token-value", expires_in: 86400 }),
    });
    vi.stubGlobal("fetch", fetchMock);

    const provisioner = new WalletUserProvisioner({} as never, "test", {
      clientId: "the-client-id",
      clientSecret: "the-client-secret",
      runtimeUrl: "https://counter-agent-runtime.fly.dev",
    });

    const result = await provisioner.mintRuntimeCredential();

    expect(result.runtimeUrl).toBe("https://counter-agent-runtime.fly.dev");
    expect(result.runtimeAuthToken).toBe("real-token-value");
    expect(new Date(result.expiresAt).getTime()).toBeGreaterThan(Date.now());

    expect(fetchMock).toHaveBeenCalledTimes(1);
    const [url, init] = fetchMock.mock.calls[0] as [string, RequestInit];
    expect(url).toBe("https://dev-jzw3etjxnn3svs56.us.auth0.com/oauth/token");
    const sentBody = JSON.parse(init.body as string) as Record<string, unknown>;
    expect(sentBody).toEqual({
      client_id: "the-client-id",
      client_secret: "the-client-secret",
      audience: "https://api.counter.dev",
      grant_type: "client_credentials",
    });
  });

  it("throws when Auth0 rejects the token request", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn().mockResolvedValue({ ok: false, json: async () => ({ error: "invalid_client" }) }),
    );

    const provisioner = new WalletUserProvisioner({} as never, "test", {
      clientId: "bad-id",
      clientSecret: "bad-secret",
      runtimeUrl: "https://counter-agent-runtime.fly.dev",
    });

    await expect(provisioner.mintRuntimeCredential()).rejects.toThrow(
      "Could not mint a merchant-runtime credential",
    );
  });
});
