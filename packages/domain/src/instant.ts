import type { Brand } from "./brand.js";
import { createCanonicalError } from "./errors.js";
import { err, ok, type Result } from "./result.js";

export type Instant = Brand<number, "InstantEpochMilliseconds">;

export const MIN_INSTANT_EPOCH_MILLISECONDS = -62_167_219_200_000;
export const MAX_INSTANT_EPOCH_MILLISECONDS = 253_402_300_799_999;

const canonicalInstantPattern =
  /^\d{4}-(?:0[1-9]|1[0-2])-(?:0[1-9]|[12]\d|3[01])T(?:[01]\d|2[0-3]):[0-5]\d:[0-5]\d\.\d{3}Z$/u;

export function instantFromEpochMilliseconds(value: unknown): Result<Instant> {
  if (typeof value !== "number" || !Number.isSafeInteger(value)) {
    return err(
      createCanonicalError({
        category: "validation",
        code: "INVALID_TYPE",
        message: "Instant epoch milliseconds must be a safe integer",
        details: { field: "epochMilliseconds" },
      }),
    );
  }
  if (value < MIN_INSTANT_EPOCH_MILLISECONDS || value > MAX_INSTANT_EPOCH_MILLISECONDS) {
    return err(
      createCanonicalError({
        category: "validation",
        code: "OUT_OF_RANGE",
        message: "Instant is outside the canonical RFC 3339 range",
        details: { field: "epochMilliseconds" },
      }),
    );
  }

  return ok(value as Instant);
}

export function parseInstant(value: unknown): Result<Instant> {
  if (typeof value !== "string" || !canonicalInstantPattern.test(value)) {
    return err(
      createCanonicalError({
        category: "validation",
        code: "INVALID_FORMAT",
        message: "Instant must use canonical UTC RFC 3339 millisecond format",
        details: { field: "instant" },
      }),
    );
  }

  const epochMilliseconds = Date.parse(value);
  if (!Number.isFinite(epochMilliseconds) || new Date(epochMilliseconds).toISOString() !== value) {
    return err(
      createCanonicalError({
        category: "validation",
        code: "INVALID_FORMAT",
        message: "Instant contains an invalid calendar date",
        details: { field: "instant" },
      }),
    );
  }

  return instantFromEpochMilliseconds(epochMilliseconds);
}

export function serializeInstant(instant: Instant): string {
  return new Date(instant).toISOString();
}

export function compareInstants(left: Instant, right: Instant): -1 | 0 | 1 {
  return left < right ? -1 : left > right ? 1 : 0;
}

export function addMilliseconds(instant: Instant, milliseconds: number): Result<Instant> {
  if (!Number.isSafeInteger(milliseconds)) {
    return err(
      createCanonicalError({
        category: "validation",
        code: "INVALID_TYPE",
        message: "Instant adjustment must be a safe integer number of milliseconds",
        details: { field: "milliseconds" },
      }),
    );
  }

  const adjusted = instant + milliseconds;
  if (
    !Number.isSafeInteger(adjusted) ||
    adjusted < MIN_INSTANT_EPOCH_MILLISECONDS ||
    adjusted > MAX_INSTANT_EPOCH_MILLISECONDS
  ) {
    return err(
      createCanonicalError({
        category: "validation",
        code: "OVERFLOW",
        message: "Instant adjustment exceeds the canonical RFC 3339 range",
      }),
    );
  }

  return ok(adjusted as Instant);
}

export function millisecondsBetween(start: Instant, end: Instant): number {
  return end - start;
}
