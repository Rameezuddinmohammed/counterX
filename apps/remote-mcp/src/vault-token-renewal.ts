/**
 * Keeps this app's Vault token alive forever without a fixed expiry.
 *
 * The token configured via VAULT_TOKEN is a Vault PERIODIC token (created
 * with `-period=720h`, not a fixed `-ttl`): its expiry is always "period"
 * from its LAST renewal, not from creation, and carries no absolute max-age
 * ceiling as long as something renews it before each window closes. This
 * module is that something — it calls Vault's own `renew-self` endpoint on
 * a fixed interval, well inside the 30-day period, for as long as this
 * process runs.
 *
 * This is the Vault-native answer to "the signing token should never
 * silently expire": a single very-long-lived static TTL was considered and
 * rejected (see git history) because it is not actually rotation, just a
 * bigger number with the same eventual-expiry problem deferred, not solved.
 *
 * Deliberate failure behavior: a renewal failure is logged loudly (this is
 * exactly the kind of thing that must never fail silently) but does NOT
 * crash the process — a transient Vault blip should not take down the
 * entire connector. If the token genuinely expires (this process was down
 * for longer than a full period with no renewal), every subsequent Vault
 * call fails with a clear 403 from Vault itself, not a silent wrong
 * answer, and the fix is the same manual `vault token create` step
 * documented in vault-config.hcl - a rare, loud, recoverable event, not a
 * routine one.
 */

export interface VaultTokenRenewalOptions {
  readonly vaultAddr: string;
  readonly vaultToken: string;
  /** How often to attempt a renewal. Default: 6 hours - comfortably inside the 30-day period even if several attempts in a row fail. */
  readonly intervalMs?: number;
  readonly fetchImpl?: typeof fetch;
  readonly onRenewed?: (leaseDurationSeconds: number) => void;
  readonly onError?: (error: unknown) => void;
}

const DEFAULT_INTERVAL_MS = 6 * 60 * 60 * 1_000;

export interface VaultTokenRenewalHandle {
  stop: () => void;
}

/**
 * Performs one renew-self call against Vault. Exported separately so
 * callers (and tests) can trigger a single renewal without the interval
 * machinery.
 */
export async function renewVaultTokenOnce(
  vaultAddr: string,
  vaultToken: string,
  fetchImpl: typeof fetch = fetch,
): Promise<{ leaseDurationSeconds: number }> {
  const response = await fetchImpl(`${vaultAddr}/v1/auth/token/renew-self`, {
    method: "POST",
    headers: { "X-Vault-Token": vaultToken, "Content-Type": "application/json" },
    body: JSON.stringify({}),
  });

  if (!response.ok) {
    const body = await response.text().catch(() => "<unreadable body>");
    throw new Error(`Vault token renewal failed: HTTP ${response.status} — ${body}`);
  }

  const payload = (await response.json()) as {
    readonly auth?: { readonly lease_duration?: number };
  };
  const leaseDurationSeconds = payload.auth?.lease_duration;
  if (typeof leaseDurationSeconds !== "number") {
    throw new Error("Vault token renewal response had no auth.lease_duration");
  }
  return { leaseDurationSeconds };
}

/**
 * Starts the renewal loop: renews once immediately (so a fresh deploy
 * doesn't wait a full interval before proving the token is actually
 * renewable), then on the configured interval for as long as the process
 * runs. Call `stop()` on graceful shutdown so the interval doesn't keep
 * the process alive.
 */
export function startVaultTokenRenewal(options: VaultTokenRenewalOptions): VaultTokenRenewalHandle {
  const { vaultAddr, vaultToken } = options;
  const intervalMs = options.intervalMs ?? DEFAULT_INTERVAL_MS;
  const fetchImpl = options.fetchImpl ?? fetch;

  const attempt = (): void => {
    renewVaultTokenOnce(vaultAddr, vaultToken, fetchImpl)
      .then(({ leaseDurationSeconds }) => options.onRenewed?.(leaseDurationSeconds))
      .catch((error: unknown) => options.onError?.(error));
  };

  attempt();
  const timer = setInterval(attempt, intervalMs);
  timer.unref?.();

  return {
    stop: () => clearInterval(timer),
  };
}
