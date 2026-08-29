/**
 * Postgres-backed adapter for the control-plane PolicyStore interface.
 *
 * Wraps @counter/data's PostgresPolicyStore (which returns Result and stores an
 * opaque JSON config) and adapts it to the synchronous-shaped, MerchantPolicyConfig
 * typed PolicyStore contract consumed by the policy routes. Errors from the
 * durable layer are surfaced by throwing so the HTTP error mapper can turn them
 * into a canonical 5xx rather than silently losing a write.
 */
import type { Environment } from "@counter/domain";
import type { TransactionalDatabase } from "@counter/data";
import { PostgresPolicyStore } from "@counter/data";
import type { MerchantPolicyConfig, PolicyStore, PolicyStoreEntry } from "./policy-routes.js";

export function createPostgresPolicyStore(
  database: TransactionalDatabase,
  environment: Environment,
): PolicyStore {
  const store = new PostgresPolicyStore(database, environment);
  return {
    async get(merchantId: string): Promise<PolicyStoreEntry | undefined> {
      const result = await store.get(merchantId);
      if (!result.ok) {
        throw new Error(`Failed to read policy config: ${result.error.message}`);
      }
      const entry = result.value;
      if (entry === undefined) {
        return undefined;
      }
      return { config: entry.config as MerchantPolicyConfig, version: entry.version };
    },
    async set(
      merchantId: string,
      config: MerchantPolicyConfig,
      expectedVersion: number | undefined,
    ): Promise<{ readonly success: boolean; readonly currentVersion: number }> {
      const result = await store.set(merchantId, config, expectedVersion);
      if (!result.ok) {
        throw new Error(`Failed to write policy config: ${result.error.message}`);
      }
      return { success: result.value.success, currentVersion: result.value.currentVersion };
    },
  };
}
