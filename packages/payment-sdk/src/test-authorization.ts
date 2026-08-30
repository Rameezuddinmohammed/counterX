import type {
  AgentId,
  Environment,
  Instant,
  IsoCurrencyCode,
  MerchantId,
  WalletId,
} from "@counter/domain";
import { createCanonicalError, instantFromEpochMilliseconds } from "@counter/domain";
import type { PaymentAuthorization } from "./authorization.js";

export interface TestAuthorizationConfig {
  readonly walletId: WalletId;
  readonly agentId: AgentId;
  readonly merchantId: MerchantId;
  readonly amountCeiling: bigint;
  readonly currency: IsoCurrencyCode;
  readonly principalId?: string;
  readonly referenceId?: string;
  readonly validFrom?: Instant;
  readonly validUntil?: Instant;
}

/**
 * Returns true only for 'local' and 'test' environments.
 */
export function isTestEnvironment(env: Environment): boolean {
  return env === "local" || env === "test";
}

/**
 * Throws a CanonicalError with code ENVIRONMENT_MISMATCH if the environment
 * is not a test environment (local or test).
 */
export function assertTestEnvironment(env: Environment): void {
  if (!isTestEnvironment(env)) {
    throw createCanonicalError({
      code: "ENVIRONMENT_MISMATCH",
      category: "validation",
      message: "Operation requires a test environment (local or test)",
    });
  }
}

/**
 * Throws a CanonicalError with code ENVIRONMENT_MISMATCH if auth.testOnly is
 * true and the environment is not local or test.
 */
export function rejectTestAuthorizationInLive(auth: PaymentAuthorization, env: Environment): void {
  if (auth.testOnly && !isTestEnvironment(env)) {
    throw createCanonicalError({
      code: "ENVIRONMENT_MISMATCH",
      category: "validation",
      message: "Test-only authorization cannot be used in a live environment",
    });
  }
}

const DEFAULT_VALIDITY_MS = 3_600_000; // 1 hour

/**
 * Creates a PaymentAuthorization scoped to test environments with testOnly=true.
 */
export function createCounterTestAuthorization(
  config: TestAuthorizationConfig,
): PaymentAuthorization {
  const now = Date.now();
  const validFromResult =
    config.validFrom !== undefined
      ? { ok: true as const, value: config.validFrom }
      : instantFromEpochMilliseconds(now);
  const validUntilResult =
    config.validUntil !== undefined
      ? { ok: true as const, value: config.validUntil }
      : instantFromEpochMilliseconds(now + DEFAULT_VALIDITY_MS);

  if (!validFromResult.ok) {
    throw new TypeError("Failed to compute validFrom instant");
  }
  if (!validUntilResult.ok) {
    throw new TypeError("Failed to compute validUntil instant");
  }

  return Object.freeze({
    referenceId: config.referenceId ?? `test-auth-${Date.now()}`,
    adapter: "counter-test",
    provider: undefined,
    environment: "test" as Environment,
    walletId: config.walletId,
    principalId: config.principalId ?? "test-principal",
    permittedAgents: Object.freeze([config.agentId]),
    permittedMerchants: Object.freeze([config.merchantId]),
    methodClass: undefined,
    currency: config.currency,
    maxAmountMinor: config.amountCeiling,
    validFrom: validFromResult.value,
    validUntil: validUntilResult.value,
    testOnly: true,
  });
}
