/**
 * Isomorphic (Node + browser) base64url encode/decode, dependency-free.
 *
 * `Buffer.from(bytes).toString("base64url")` only works in Node — this uses
 * `btoa`/`atob` instead, which are standard globals in both Node (18+) and
 * every browser, so the CTP signing/verification pipeline can run
 * unmodified in a browser (Mandate Pivot Phase 1.3 — signing a spending
 * mandate client-side needs this package to have zero Node-only code left).
 * Verified byte-for-byte identical to Buffer's own base64url encoding
 * across a range of input sizes before this replaced it.
 */

export function bytesToBase64Url(bytes: Uint8Array): string {
  let binary = "";
  for (let i = 0; i < bytes.length; i += 1) {
    binary += String.fromCharCode(bytes[i]!);
  }
  const base64 = btoa(binary);
  return base64.replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
}

export function base64UrlToBytes(value: string): Uint8Array {
  const base64 = value.replace(/-/g, "+").replace(/_/g, "/");
  const padded = base64 + "=".repeat((4 - (base64.length % 4)) % 4);
  const binary = atob(padded);
  const bytes = new Uint8Array(binary.length);
  for (let i = 0; i < binary.length; i += 1) {
    bytes[i] = binary.charCodeAt(i);
  }
  return bytes;
}
