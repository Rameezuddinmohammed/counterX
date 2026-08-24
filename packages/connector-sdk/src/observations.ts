/**
 * Source observation types.
 *
 * Observations represent what was read from an external source, when,
 * from where, and with what version. The `raw` field is typed as `never`
 * to enforce that raw data is not accessible through this boundary -
 * connectors must parse and type data before exposing it.
 */

import type { ExternalReference, Instant, Sha256Digest } from "@counter/domain";

// ─── Observation Methods ──────────────────────────────────────────────────────

export const OBSERVATION_METHODS = [
  "api_query",
  "verified_webhook",
  "connector_read",
  "polling",
] as const;
export type ObservationMethod = (typeof OBSERVATION_METHODS)[number];

const observationMethodSet: ReadonlySet<string> = new Set(OBSERVATION_METHODS);

export function isObservationMethod(value: unknown): value is ObservationMethod {
  return typeof value === "string" && observationMethodSet.has(value);
}

// ─── Source Observation ───────────────────────────────────────────────────────

export interface SourceObservation {
  readonly observationId: string;
  readonly source: ExternalReference;
  readonly observedAt: Instant;
  readonly sourceVersion: string;
  readonly observationMethod: ObservationMethod;
  readonly dataDigest: Sha256Digest;
  /**
   * Raw data is not accessible through this boundary.
   * Connectors must parse and return typed data only.
   */
  readonly raw: never;
}

// ─── Observation Window ───────────────────────────────────────────────────────

export interface ObservationWindow {
  readonly from: Instant;
  readonly to: Instant;
  readonly observations: readonly SourceObservation[];
}

// ─── Observation Verification ─────────────────────────────────────────────────

export interface ObservationVerification {
  readonly signatureValid: boolean;
  readonly sourceAuthenticated: boolean;
  readonly deduplicationKey: string;
  readonly sequencePosition: number | undefined;
}
