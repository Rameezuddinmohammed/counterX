import { createCanonicalError } from "./errors.js";
import { err, ok, type Result } from "./result.js";

export const COUNTER_ENVIRONMENTS = ["local", "test", "sandbox", "pilot", "production"] as const;

export type Environment = (typeof COUNTER_ENVIRONMENTS)[number];
export type LocalEnvironment = Extract<Environment, "local" | "test">;

const environmentSet: ReadonlySet<string> = new Set(COUNTER_ENVIRONMENTS);

export function isEnvironment(value: unknown): value is Environment {
  return typeof value === "string" && environmentSet.has(value);
}

export function parseEnvironment(value: unknown): Result<Environment> {
  if (!isEnvironment(value)) {
    return err(
      createCanonicalError({
        category: "validation",
        code: "UNSUPPORTED_VALUE",
        message: "Environment must be a supported Counter environment",
        details: { field: "environment" },
      }),
    );
  }

  return ok(value);
}

export function environmentsEqual(left: Environment, right: Environment): boolean {
  return left === right;
}

/**
 * Resolves the durable-data partition environment (the value bound into
 * every `runtime.*` / `platform.*` query, matching the `platform.
 * counter_environment` enum) from a raw `COUNTER_ENV` value.
 *
 * `COUNTER_ENV` is the only source of truth here. `NODE_ENV` values such as
 * "development" are a DIFFERENT, incompatible vocabulary (framework/mock-
 * eligibility signaling, not a Counter environment) and must never be used
 * as the resolved partition value — every deployed service already computes
 * its own "is this a production-like deployment" boolean from COUNTER_ENV
 * falling back to NODE_ENV for THAT narrower purpose; pass it in as
 * `isProdLike` here rather than recomputing it.
 *
 * - `COUNTER_ENV` set to a valid {@link Environment} → used as-is.
 * - `COUNTER_ENV` absent/invalid AND `isProdLike` → fails closed (a
 *   misconfigured production-like deployment must not silently write to the
 *   wrong partition, or default to one).
 * - `COUNTER_ENV` absent/invalid AND NOT `isProdLike` → defaults to
 *   `"local"`, the safe default for local development.
 */
export function resolveCounterEnvironment(
  counterEnvRaw: string | undefined,
  isProdLike: boolean,
): Result<Environment> {
  if (counterEnvRaw !== undefined && isEnvironment(counterEnvRaw)) {
    return ok(counterEnvRaw);
  }
  if (isProdLike) {
    return err(
      createCanonicalError({
        category: "validation",
        code: "UNSUPPORTED_VALUE",
        message: `COUNTER_ENV must be set to one of ${COUNTER_ENVIRONMENTS.join("/")} in a production-like deployment; got ${counterEnvRaw ?? "(unset)"}`,
        details: { field: "COUNTER_ENV" },
      }),
    );
  }
  return ok("local");
}
