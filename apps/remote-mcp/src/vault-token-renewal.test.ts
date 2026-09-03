import { describe, expect, it, vi, beforeEach, afterEach } from "vitest";
import { renewVaultTokenOnce, startVaultTokenRenewal } from "./vault-token-renewal.js";

function jsonResponse(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "content-type": "application/json" },
  });
}

describe("renewVaultTokenOnce", () => {
  it("posts to renew-self with the token header and returns the new lease duration", async () => {
    const fetchImpl = vi.fn().mockResolvedValue(
      jsonResponse({
        auth: { client_token: "same-token", lease_duration: 2_592_000, renewable: true },
      }),
    );

    const result = await renewVaultTokenOnce("http://vault.internal:8200", "hvs.test-token", fetchImpl);

    expect(result).toEqual({ leaseDurationSeconds: 2_592_000 });
    expect(fetchImpl).toHaveBeenCalledWith(
      "http://vault.internal:8200/v1/auth/token/renew-self",
      expect.objectContaining({
        method: "POST",
        headers: expect.objectContaining({ "X-Vault-Token": "hvs.test-token" }),
      }),
    );
  });

  it("throws with the response body when Vault rejects the renewal (e.g. token already expired)", async () => {
    const fetchImpl = vi
      .fn()
      .mockResolvedValue(
        new Response(JSON.stringify({ errors: ["permission denied"] }), { status: 403 }),
      );

    await expect(renewVaultTokenOnce("http://vault.internal:8200", "hvs.expired", fetchImpl)).rejects.toThrow(
      /403/,
    );
  });

  it("throws if Vault's response has no auth.lease_duration (defensive — never silently succeed on a malformed response)", async () => {
    const fetchImpl = vi.fn().mockResolvedValue(jsonResponse({ auth: {} }));

    await expect(renewVaultTokenOnce("http://vault.internal:8200", "hvs.test-token", fetchImpl)).rejects.toThrow(
      /lease_duration/,
    );
  });
});

describe("startVaultTokenRenewal", () => {
  beforeEach(() => {
    vi.useFakeTimers();
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it("renews immediately on start, then again on each interval", async () => {
    // A Response's body can only be read once, so a fresh instance is
    // needed per call - mockResolvedValue would hand back the SAME
    // (already-consumed) Response on every renewal attempt.
    const fetchImpl = vi.fn().mockImplementation(async () => jsonResponse({ auth: { lease_duration: 2_592_000 } }));
    const onRenewed = vi.fn();

    const handle = startVaultTokenRenewal({
      vaultAddr: "http://vault.internal:8200",
      vaultToken: "hvs.test-token",
      intervalMs: 1_000,
      fetchImpl,
      onRenewed,
    });

    // Flush the microtask queue (the immediate call's fetch mock resolves as
    // a real Promise even under fake timers) without advancing the clock.
    await vi.advanceTimersByTimeAsync(0);
    expect(onRenewed).toHaveBeenCalledTimes(1);
    expect(onRenewed).toHaveBeenCalledWith(2_592_000);

    await vi.advanceTimersByTimeAsync(1_000);
    expect(onRenewed).toHaveBeenCalledTimes(2);

    await vi.advanceTimersByTimeAsync(1_000);
    expect(onRenewed).toHaveBeenCalledTimes(3);

    handle.stop();
    await vi.advanceTimersByTimeAsync(5_000);
    expect(onRenewed).toHaveBeenCalledTimes(3);
  });

  it("reports a failed renewal via onError without throwing and keeps retrying on schedule", async () => {
    const fetchImpl = vi.fn().mockResolvedValue(new Response("nope", { status: 500 }));
    const onError = vi.fn();

    const handle = startVaultTokenRenewal({
      vaultAddr: "http://vault.internal:8200",
      vaultToken: "hvs.test-token",
      intervalMs: 1_000,
      fetchImpl,
      onError,
    });

    await vi.advanceTimersByTimeAsync(0);
    expect(onError).toHaveBeenCalledTimes(1);

    await vi.advanceTimersByTimeAsync(1_000);
    expect(onError).toHaveBeenCalledTimes(2);

    handle.stop();
  });

  it("stop() clears the interval so it never keeps the process alive after shutdown", async () => {
    const fetchImpl = vi.fn().mockResolvedValue(jsonResponse({ auth: { lease_duration: 2_592_000 } }));

    const handle = startVaultTokenRenewal({
      vaultAddr: "http://vault.internal:8200",
      vaultToken: "hvs.test-token",
      intervalMs: 1_000,
      fetchImpl,
    });

    await vi.advanceTimersByTimeAsync(0);
    expect(fetchImpl).toHaveBeenCalledTimes(1);
    handle.stop();

    await vi.advanceTimersByTimeAsync(10_000);
    expect(fetchImpl).toHaveBeenCalledTimes(1);
  });
});
