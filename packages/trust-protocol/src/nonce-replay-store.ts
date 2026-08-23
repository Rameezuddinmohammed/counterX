/**
 * Concurrent nonce/replay store for CTP envelope verification.
 *
 * Extends the NonceStore concept with proper concurrency handling using
 * promise-based locking for the in-memory implementation. Ensures that
 * a nonce can only be consumed once, even under concurrent access.
 */

import type { NonceStore } from "./verify.js";

// ---------------------------------------------------------------------------
// ConcurrentNonceStore Port
// ---------------------------------------------------------------------------

/**
 * Nonce store that guarantees atomic check-and-record semantics
 * under concurrent access. Extends the basic NonceStore interface.
 */
export interface ConcurrentNonceStore extends NonceStore {
  /** Check and record a nonce atomically. Returns true if new, false if replay. */
  checkAndRecord(nonce: string, envelopeId: string): Promise<boolean>;
}

// ---------------------------------------------------------------------------
// InMemoryConcurrentNonceStore
// ---------------------------------------------------------------------------

/**
 * In-memory implementation of ConcurrentNonceStore with promise-based locking.
 * Only the first concurrent caller to claim a nonce succeeds; all others
 * receive false (replay detected).
 */
export class InMemoryConcurrentNonceStore implements ConcurrentNonceStore {
  readonly #recorded: Map<string, string> = new Map();
  readonly #pending: Map<string, Promise<boolean>> = new Map();

  public async checkAndRecord(nonce: string, envelopeId: string): Promise<boolean> {
    // Fast path: already recorded
    if (this.#recorded.has(nonce)) {
      return false;
    }

    // Check if there is a pending claim for this nonce
    const existing = this.#pending.get(nonce);
    if (existing !== undefined) {
      // Wait for the pending claim to resolve, then report replay
      await existing;
      return false;
    }

    // Create the claim promise
    let resolve!: (value: boolean) => void;
    const claim = new Promise<boolean>((r) => {
      resolve = r;
    });
    this.#pending.set(nonce, claim);

    // Double-check after setting pending (should not happen in single-threaded JS
    // but ensures correctness of the pattern)
    if (this.#recorded.has(nonce)) {
      this.#pending.delete(nonce);
      resolve(false);
      return false;
    }

    // Record the nonce
    this.#recorded.set(nonce, envelopeId);
    this.#pending.delete(nonce);
    resolve(true);
    return true;
  }

  /** Returns the envelope ID that consumed the nonce, if any. */
  public getConsumer(nonce: string): string | undefined {
    return this.#recorded.get(nonce);
  }

  /** Returns the number of recorded nonces. */
  public get size(): number {
    return this.#recorded.size;
  }

  /** Clears all recorded nonces. Test utility only. */
  public clear(): void {
    this.#recorded.clear();
    this.#pending.clear();
  }
}
