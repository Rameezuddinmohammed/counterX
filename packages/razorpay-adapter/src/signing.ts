/**
 * Shared HMAC signing/verification helpers for Razorpay callback and
 * webhook signatures. Used by both RazorpayTestProvider (one-shot orders)
 * and RazorpayRecurringMandateProvider (recurring payments) so there is
 * exactly one implementation of the timing-safe comparison, not two.
 */

import { createHmac } from "node:crypto";

/** Computes HMAC_SHA256 hex signature. */
export function hmacSha256(data: string, secret: string): string {
  return createHmac("sha256", secret).update(data).digest("hex");
}

/** Constant-time string comparison to prevent timing attacks on signature verification. */
export function timingSafeEquals(a: string, b: string): boolean {
  if (a.length !== b.length) {
    return false;
  }
  const bufA = Buffer.from(a, "utf8");
  const bufB = Buffer.from(b, "utf8");
  let result = 0;
  for (let i = 0; i < bufA.length; i++) {
    result |= bufA[i]! ^ bufB[i]!;
  }
  return result === 0;
}
