import { createHash, timingSafeEqual } from "node:crypto";
import type { Brand } from "./brand.js";
import { createCanonicalError } from "./errors.js";
import { err, ok, type Result } from "./result.js";

export const SHA256_ALGORITHM = "sha-256";
export const SHA256_DIGEST_BYTES = 32;

const sha256DigestPattern = /^sha256:([0-9a-f]{64})$/u;

export type Sha256Digest = Brand<string, "Sha256Digest">;

export function sha256Digest(bytes: Uint8Array): Sha256Digest {
  const hexadecimal = createHash("sha256").update(bytes).digest("hex");
  return `sha256:${hexadecimal}` as Sha256Digest;
}

export function parseSha256Digest(value: unknown): Result<Sha256Digest> {
  if (typeof value !== "string" || !sha256DigestPattern.test(value)) {
    return err(
      createCanonicalError({
        category: "validation",
        code: "INVALID_FORMAT",
        message: "SHA-256 digest must use canonical algorithm-tagged lowercase hexadecimal",
        details: { field: "digest" },
      }),
    );
  }

  return ok(value as Sha256Digest);
}

export function serializeSha256Digest(digest: Sha256Digest): string {
  return digest;
}

export function sha256DigestsEqual(left: Sha256Digest, right: Sha256Digest): boolean {
  const leftMatch = sha256DigestPattern.exec(left);
  const rightMatch = sha256DigestPattern.exec(right);
  const leftHex = leftMatch?.[1];
  const rightHex = rightMatch?.[1];
  if (leftHex === undefined || rightHex === undefined) {
    return false;
  }

  return timingSafeEqual(Buffer.from(leftHex, "hex"), Buffer.from(rightHex, "hex"));
}
