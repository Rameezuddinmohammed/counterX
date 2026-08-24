/**
 * Configures @noble/ed25519 to use Node.js crypto for SHA-512.
 *
 * @noble/ed25519 v2.2.3 requires sha512Sync to be set for synchronous
 * operations (getPublicKey) and sha512Async for async operations (sign, verify).
 * In Node.js 22, we use the built-in crypto module.
 *
 * This module MUST be imported before any ed25519 operations.
 */

import { createHash } from "node:crypto";
import { etc } from "@noble/ed25519";

if (!etc.sha512Sync) {
  etc.sha512Sync = (...messages: Uint8Array[]): Uint8Array => {
    const h = createHash("sha512");
    for (const m of messages) h.update(m);
    return new Uint8Array(h.digest());
  };
}

if (!etc.sha512Async) {
  etc.sha512Async = async (...messages: Uint8Array[]): Promise<Uint8Array> => {
    const h = createHash("sha512");
    for (const m of messages) h.update(m);
    return new Uint8Array(h.digest());
  };
}
