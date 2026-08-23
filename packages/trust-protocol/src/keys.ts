/**
 * CTP Key Record management.
 *
 * JWKS-compatible key records with kid, use, algorithm, status, validity,
 * and rotation metadata (per TRUST-PROTOCOL.md section 4).
 */

import { createCanonicalError, type Result, ok, err } from "@counter/domain";

// ---------------------------------------------------------------------------
// Key Status
// ---------------------------------------------------------------------------

export const KEY_STATUSES = ["active", "rotated", "revoked", "expired"] as const;

export type KeyStatus = (typeof KEY_STATUSES)[number];

const keyStatusSet: ReadonlySet<string> = new Set(KEY_STATUSES);

export function isKeyStatus(value: unknown): value is KeyStatus {
  return typeof value === "string" && keyStatusSet.has(value);
}

// ---------------------------------------------------------------------------
// Key Use
// ---------------------------------------------------------------------------

export const KEY_USES = ["sign", "verify"] as const;

export type KeyUse = (typeof KEY_USES)[number];

// ---------------------------------------------------------------------------
// Key Record
// ---------------------------------------------------------------------------

export interface KeyRecord {
  /** Key identifier. */
  readonly kid: string;
  /** Key usage: sign or verify. */
  readonly use: KeyUse;
  /** Algorithm identifier (always "EdDSA" for CTP 0.1). */
  readonly alg: "EdDSA";
  /** Base64url-encoded (no padding) Ed25519 public key (32 bytes). */
  readonly publicKey: string;
  /** Current key status. */
  readonly status: KeyStatus;
  /** Validity start (RFC 3339 UTC). */
  readonly validFrom: string;
  /** Validity end (RFC 3339 UTC). */
  readonly validUntil: string;
  /** kid of the key this one rotated from, if any. */
  readonly rotatedFrom?: string;
  /** kid of the key this one was rotated to, if any. */
  readonly rotatedTo?: string;
  /** Issuer/owner of this key. */
  readonly issuer: string;
}

// ---------------------------------------------------------------------------
// Key Registry Port
// ---------------------------------------------------------------------------

/**
 * Port for resolving key records by kid.
 * Implementations may be in-memory (tests), backed by JWKS endpoints, or
 * database-backed (production).
 */
export interface KeyRegistry {
  resolve(kid: string): Promise<KeyRecord | undefined>;
}

// ---------------------------------------------------------------------------
// In-Memory Key Registry (for tests and fixtures)
// ---------------------------------------------------------------------------

export class InMemoryKeyRegistry implements KeyRegistry {
  readonly #records: Map<string, KeyRecord>;

  public constructor(records: readonly KeyRecord[] = []) {
    this.#records = new Map(records.map((r) => [r.kid, r]));
  }

  public async resolve(kid: string): Promise<KeyRecord | undefined> {
    return this.#records.get(kid);
  }

  public add(record: KeyRecord): void {
    this.#records.set(record.kid, record);
  }
}

// ---------------------------------------------------------------------------
// Key Validation
// ---------------------------------------------------------------------------

/**
 * Validates a key record is suitable for verifying a signature at a given time.
 * Checks: status is active, algorithm is EdDSA, current time is within validity.
 */
export function validateKeyForVerification(
  record: KeyRecord,
  currentTimeIso: string,
): Result<KeyRecord> {
  if (record.alg !== "EdDSA") {
    return err(
      createCanonicalError({
        category: "validation",
        code: "UNSUPPORTED_VALUE",
        message: "Key algorithm must be EdDSA for CTP 0.1",
      }),
    );
  }

  if (record.status !== "active") {
    return err(
      createCanonicalError({
        category: "authentication",
        code: "UNAUTHENTICATED",
        message: `Key status is '${record.status}', expected 'active'`,
      }),
    );
  }

  const currentMs = Date.parse(currentTimeIso);
  const validFromMs = Date.parse(record.validFrom);
  const validUntilMs = Date.parse(record.validUntil);

  if (Number.isNaN(currentMs) || Number.isNaN(validFromMs) || Number.isNaN(validUntilMs)) {
    return err(
      createCanonicalError({
        category: "validation",
        code: "INVALID_FORMAT",
        message: "Key validity timestamps must be valid RFC 3339",
      }),
    );
  }

  if (currentMs < validFromMs) {
    return err(
      createCanonicalError({
        category: "authentication",
        code: "UNAUTHENTICATED",
        message: "Key is not yet valid",
      }),
    );
  }

  if (currentMs > validUntilMs) {
    return err(
      createCanonicalError({
        category: "authentication",
        code: "UNAUTHENTICATED",
        message: "Key has expired",
      }),
    );
  }

  return ok(record);
}
