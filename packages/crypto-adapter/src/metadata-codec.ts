/**
 * Encodes/decodes a `FixedDelegationCoordinates` (plus a receiver ATA) to
 * and from the flat `Record<string,string>` shape `CreatePaymentInstruction
 * .metadata` carries. All values here are public on-chain addresses — never
 * a private key — see solana-settlement-provider.ts's header for why a key
 * never travels this path.
 *
 * `encodeSolanaMetadata` is used by a LATER piece of work (real-lifecycle.ts
 * in apps/worker, not built here) to thread coordinates produced at
 * mandate-issuance time (mandate-delegation.ts) into a settlement call.
 * `decodeSolanaMetadata` is used by solana-settlement-provider.ts to read
 * them back out.
 */
import { createCanonicalError } from "@counter/domain";
import type { FixedDelegationCoordinates, SolanaAddress } from "./types.js";

const COORDINATE_METADATA_KEYS = [
  "subscriptionAuthorityPda",
  "fixedDelegationPda",
  "delegatorAddress",
  "delegatorAta",
  "delegateeAddress",
  "tokenMint",
] as const;

const RECEIVER_ATA_METADATA_KEY = "receiverAta";

export interface SolanaSettlementMetadata {
  readonly coordinates: FixedDelegationCoordinates;
  readonly receiverAta: string;
}

/** Flattens a `FixedDelegationCoordinates` + receiver ATA into the plain
 * string-record shape `CreatePaymentInstruction.metadata` requires. */
export function encodeSolanaMetadata(input: SolanaSettlementMetadata): Record<string, string> {
  return Object.freeze({
    subscriptionAuthorityPda: input.coordinates.subscriptionAuthorityPda,
    fixedDelegationPda: input.coordinates.fixedDelegationPda,
    delegatorAddress: input.coordinates.delegatorAddress,
    delegatorAta: input.coordinates.delegatorAta,
    delegateeAddress: input.coordinates.delegateeAddress,
    tokenMint: input.coordinates.tokenMint,
    [RECEIVER_ATA_METADATA_KEY]: input.receiverAta,
  });
}

function requireField(metadata: Readonly<Record<string, string>>, key: string): SolanaAddress {
  const value = metadata[key];
  if (typeof value !== "string" || value.length === 0) {
    throw createCanonicalError({
      code: "INVALID_FORMAT",
      category: "validation",
      message: `Solana settlement metadata missing/invalid field "${key}"`,
      details: { field: key },
    });
  }
  return value;
}

/**
 * Reconstructs a `FixedDelegationCoordinates` + receiver ATA from
 * `CreatePaymentInstruction.metadata`. Throws a canonical validation error
 * (never returns a partial/best-effort result) when metadata is absent or
 * any required field is missing/empty — this is a genuine caller-error
 * case, not a payment outcome, so it must never be silently coerced into a
 * declined/indeterminate payment result.
 */
export function decodeSolanaMetadata(
  metadata: Readonly<Record<string, string>> | undefined,
): SolanaSettlementMetadata {
  if (metadata === undefined) {
    throw createCanonicalError({
      code: "INVALID_FORMAT",
      category: "validation",
      message: "Solana settlement requires metadata carrying FixedDelegationCoordinates",
      details: { field: "metadata" },
    });
  }

  const coordinates: FixedDelegationCoordinates = Object.freeze({
    subscriptionAuthorityPda: requireField(metadata, COORDINATE_METADATA_KEYS[0]),
    fixedDelegationPda: requireField(metadata, COORDINATE_METADATA_KEYS[1]),
    delegatorAddress: requireField(metadata, COORDINATE_METADATA_KEYS[2]),
    delegatorAta: requireField(metadata, COORDINATE_METADATA_KEYS[3]),
    delegateeAddress: requireField(metadata, COORDINATE_METADATA_KEYS[4]),
    tokenMint: requireField(metadata, COORDINATE_METADATA_KEYS[5]),
  });
  const receiverAta = requireField(metadata, RECEIVER_ATA_METADATA_KEY);

  return Object.freeze({ coordinates, receiverAta });
}
