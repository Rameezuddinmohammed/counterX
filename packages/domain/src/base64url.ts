/**
 * Isomorphic (Node + browser) base64url encode/decode, dependency-free.
 *
 * `Buffer.from(bytes).toString("base64url")` only works in Node — this uses
 * `btoa`/`atob` instead, which are standard globals in both Node (18+) and
 * every browser. Mirrors @counter/trust-protocol/src/base64url.ts exactly
 * (domain can't depend on trust-protocol — wrong dependency direction — so
 * this is a small, deliberate duplication rather than a shared import).
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
