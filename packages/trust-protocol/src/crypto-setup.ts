/**
 * Configures @noble/ed25519 to use @noble/hashes for SHA-512.
 *
 * @noble/ed25519 v2.2.3 requires sha512Sync to be set for synchronous
 * operations (getPublicKey) and sha512Async for async operations (sign,
 * verify). @noble/hashes is a pure-JS, isomorphic implementation — unlike
 * node:crypto (this file's previous source), it also works unmodified in a
 * browser bundle. Mandate Pivot Phase 1.3 needs that: signing a spending
 * mandate happens client-side, in the buyer's browser.
 *
 * This module MUST be imported before any ed25519 operations.
 */

import { sha512 } from "@noble/hashes/sha2.js";
import { etc } from "@noble/ed25519";

if (!etc.sha512Sync) {
  etc.sha512Sync = (...messages: Uint8Array[]): Uint8Array => {
    return sha512(etc.concatBytes(...messages));
  };
}

if (!etc.sha512Async) {
  etc.sha512Async = async (...messages: Uint8Array[]): Promise<Uint8Array> => {
    return sha512(etc.concatBytes(...messages));
  };
}
