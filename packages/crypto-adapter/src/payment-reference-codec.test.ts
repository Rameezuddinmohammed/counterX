import { describe, expect, it } from "vitest";
import {
  decodeSolanaPaymentReference,
  encodeSolanaPaymentReference,
  isSolanaPaymentReference,
  SOLANA_PAYMENT_REFERENCE_PREFIX,
} from "./payment-reference-codec.js";
import type { FixedDelegationCoordinates } from "./types.js";

function coordinates(): FixedDelegationCoordinates {
  return {
    subscriptionAuthorityPda: "DjmxNyCj9ahQRPD1zU4zNZmEXbafCeEpruMHFmkTzBo",
    fixedDelegationPda: "DjmxNyCj9ahQRPD1zU4zNZmEXbafCeEpruMHFmkTzBo",
    delegatorAddress: "DjmxNyCj9ahQRPD1zU4zNZmEXbafCeEpruMHFmkTzBo",
    delegatorAta: "DjmxNyCj9ahQRPD1zU4zNZmEXbafCeEpruMHFmkTzBo",
    delegateeAddress: "DjmxNyCj9ahQRPD1zU4zNZmEXbafCeEpruMHFmkTzBo",
    tokenMint: "So11111111111111111111111111111111111111112",
  };
}

describe("solana payment-reference codec", () => {
  it("round-trips coordinates through encode -> decode", () => {
    const original = coordinates();
    const reference = encodeSolanaPaymentReference(original);

    expect(reference.startsWith(SOLANA_PAYMENT_REFERENCE_PREFIX)).toBe(true);
    expect(isSolanaPaymentReference(reference)).toBe(true);

    const decoded = decodeSolanaPaymentReference(reference);
    expect(decoded).toEqual(original);
  });

  it("returns undefined for a reference with a different prefix (e.g. a recurring-mandate reference)", () => {
    expect(isSolanaPaymentReference("razorpay-recurring:abc123")).toBe(false);
    expect(decodeSolanaPaymentReference("razorpay-recurring:abc123")).toBeUndefined();
  });

  it("returns undefined, not throws, for a malformed payload after the prefix", () => {
    expect(
      decodeSolanaPaymentReference(`${SOLANA_PAYMENT_REFERENCE_PREFIX}not-valid-base64json!!!`),
    ).toBeUndefined();
  });

  it("returns undefined for valid JSON missing a required field", () => {
    const partial = { subscriptionAuthorityPda: "x" };
    const encoded = Buffer.from(JSON.stringify(partial), "utf8").toString("base64url");
    expect(
      decodeSolanaPaymentReference(`${SOLANA_PAYMENT_REFERENCE_PREFIX}${encoded}`),
    ).toBeUndefined();
  });
});
