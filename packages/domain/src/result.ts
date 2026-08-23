import type { CanonicalError } from "./errors.js";

export type Result<Value, ErrorValue = CanonicalError> =
  | { readonly ok: true; readonly value: Value }
  | { readonly ok: false; readonly error: ErrorValue };

export function ok<Value>(value: Value): Result<Value, never> {
  return { ok: true, value };
}

export function err<ErrorValue>(error: ErrorValue): Result<never, ErrorValue> {
  return { ok: false, error };
}

export function mapResult<Value, NextValue, ErrorValue>(
  result: Result<Value, ErrorValue>,
  mapper: (value: Value) => NextValue,
): Result<NextValue, ErrorValue> {
  return result.ok ? ok(mapper(result.value)) : result;
}

export function flatMapResult<Value, NextValue, ErrorValue, NextError>(
  result: Result<Value, ErrorValue>,
  mapper: (value: Value) => Result<NextValue, NextError>,
): Result<NextValue, ErrorValue | NextError> {
  return result.ok ? mapper(result.value) : result;
}

export function mapResultError<Value, ErrorValue, NextError>(
  result: Result<Value, ErrorValue>,
  mapper: (error: ErrorValue) => NextError,
): Result<Value, NextError> {
  return result.ok ? result : err(mapper(result.error));
}

export function resultOrElse<Value, ErrorValue>(
  result: Result<Value, ErrorValue>,
  fallback: (error: ErrorValue) => Value,
): Value {
  return result.ok ? result.value : fallback(result.error);
}
