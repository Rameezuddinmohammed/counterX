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
