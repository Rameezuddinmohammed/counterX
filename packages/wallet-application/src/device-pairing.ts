/**
 * Device pairing service for wallet agent registration.
 *
 * Pairing is a short-lived, one-time operation that binds a device to a wallet
 * via proof-of-possession. A pairing request contains a cryptographic challenge
 * that the device must sign with its Ed25519 private key to prove possession
 * of the corresponding public key.
 *
 * Security guarantees:
 * - Pairing requests are short-lived (default 5 minutes TTL)
 * - Atomic consume prevents replay (consumed requests cannot be re-consumed)
 * - Proof-of-possession is verified via Ed25519 signature verification
 * - Expired requests auto-reject on consume
 * - Pairing grants NO mandate or transaction authority (identity binding only)
 */

import * as ed from "@noble/ed25519";
import type { CounterId } from "@counter/domain";

// ---------------------------------------------------------------------------
// Pairing Request Status
// ---------------------------------------------------------------------------

export const PAIRING_STATUSES = ["pending", "consumed", "expired", "cancelled"] as const;

export type PairingStatus = (typeof PAIRING_STATUSES)[number];

// ---------------------------------------------------------------------------
// Pairing Request
// ---------------------------------------------------------------------------

export interface PairingRequest {
  readonly requestId: string;
  readonly walletId: CounterId<"wallet">;
  readonly principalId: CounterId<"actor">;
  readonly challenge: Uint8Array;
  readonly expiresAt: string;
  readonly status: PairingStatus;
  readonly createdAt: string;
  readonly deviceInfo?: string | undefined;
}

// ---------------------------------------------------------------------------
// Pairing Result (returned on successful consume)
// ---------------------------------------------------------------------------

export interface PairingResult {
  readonly requestId: string;
  readonly walletId: CounterId<"wallet">;
  readonly principalId: CounterId<"actor">;
  readonly publicKey: Uint8Array;
  readonly deviceInfo?: string | undefined;
  readonly consumedAt: string;
}

// ---------------------------------------------------------------------------
// Pairing Error
// ---------------------------------------------------------------------------

export interface PairingError {
  readonly kind: "pairing_error";
  readonly reason: string;
}

export type PairingOutcome =
  | { readonly ok: true; readonly value: PairingResult }
  | { readonly ok: false; readonly error: PairingError };

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function generateRequestId(): string {
  const bytes = new Uint8Array(16);
  crypto.getRandomValues(bytes);
  let binary = "";
  for (const b of bytes) {
    binary += String.fromCharCode(b);
  }
  return `pair-${btoa(binary).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "")}`;
}

function generateChallenge(): Uint8Array {
  const bytes = new Uint8Array(32);
  crypto.getRandomValues(bytes);
  return bytes;
}

// ---------------------------------------------------------------------------
// Default TTL
// ---------------------------------------------------------------------------

const DEFAULT_TTL_MS = 5 * 60 * 1000; // 5 minutes

// ---------------------------------------------------------------------------
// Internal mutable request entry
// ---------------------------------------------------------------------------

interface MutablePairingEntry {
  readonly requestId: string;
  readonly walletId: CounterId<"wallet">;
  readonly principalId: CounterId<"actor">;
  readonly challenge: Uint8Array;
  readonly expiresAt: string;
  mutableStatus: PairingStatus;
  readonly createdAt: string;
  readonly deviceInfo?: string | undefined;
}

// ---------------------------------------------------------------------------
// PairingService
// ---------------------------------------------------------------------------

export class PairingService {
  readonly #requests = new Map<string, MutablePairingEntry>();

  /**
   * Creates a new pairing request with a random challenge and short TTL.
   *
   * @param walletId - The wallet to pair with
   * @param principalId - The principal initiating the pairing
   * @param ttlMs - Time-to-live in milliseconds (default: 5 minutes)
   */
  createPairingRequest(
    walletId: CounterId<"wallet">,
    principalId: CounterId<"actor">,
    ttlMs: number = DEFAULT_TTL_MS,
  ): PairingRequest {
    const now = new Date();
    const expiresAt = new Date(now.getTime() + ttlMs);
    const requestId = generateRequestId();
    const challenge = generateChallenge();

    const entry: MutablePairingEntry = {
      requestId,
      walletId,
      principalId,
      challenge,
      expiresAt: expiresAt.toISOString(),
      mutableStatus: "pending",
      createdAt: now.toISOString(),
    };

    this.#requests.set(requestId, entry);

    return {
      requestId,
      walletId,
      principalId,
      challenge,
      expiresAt: expiresAt.toISOString(),
      status: "pending",
      createdAt: now.toISOString(),
    };
  }

  /**
   * Atomically consumes a pairing request.
   *
   * Validates:
   * - Request exists
   * - Request is still pending (not consumed, expired, or cancelled)
   * - Request has not expired
   * - Proof-of-possession is valid (challenge was signed by the public key)
   *
   * @param requestId - The pairing request to consume
   * @param proofOfPossession - Ed25519 signature of the challenge by the device key
   * @param publicKey - The device's public key (to verify proof-of-possession)
   * @param deviceInfo - Optional device information string
   */
  async consumePairing(
    requestId: string,
    proofOfPossession: Uint8Array,
    publicKey: Uint8Array,
    deviceInfo?: string,
  ): Promise<PairingOutcome> {
    const request = this.#requests.get(requestId);

    if (!request) {
      return {
        ok: false,
        error: { kind: "pairing_error", reason: "Pairing request not found" },
      };
    }

    // Check if already consumed (replay protection)
    if (request.mutableStatus === "consumed") {
      return {
        ok: false,
        error: {
          kind: "pairing_error",
          reason: "Pairing request already consumed (replay rejected)",
        },
      };
    }

    // Check if cancelled
    if (request.mutableStatus === "cancelled") {
      return {
        ok: false,
        error: { kind: "pairing_error", reason: "Pairing request has been cancelled" },
      };
    }

    // Check expiry
    const now = Date.now();
    const expiresAt = new Date(request.expiresAt).getTime();
    if (now >= expiresAt) {
      request.mutableStatus = "expired";
      return {
        ok: false,
        error: { kind: "pairing_error", reason: "Pairing request has expired" },
      };
    }

    // Verify proof-of-possession: the signature of the challenge with the provided public key
    const valid = await ed.verifyAsync(proofOfPossession, request.challenge, publicKey);
    if (!valid) {
      return {
        ok: false,
        error: {
          kind: "pairing_error",
          reason: "Invalid proof-of-possession (signature verification failed)",
        },
      };
    }

    // Atomically consume
    request.mutableStatus = "consumed";

    const result: PairingResult = {
      requestId,
      walletId: request.walletId,
      principalId: request.principalId,
      publicKey,
      consumedAt: new Date().toISOString(),
      ...(deviceInfo !== undefined ? { deviceInfo } : {}),
    };

    return { ok: true, value: result };
  }

  /**
   * Cancels a pending pairing request.
   */
  cancelPairing(requestId: string): PairingOutcome {
    const request = this.#requests.get(requestId);

    if (!request) {
      return {
        ok: false,
        error: { kind: "pairing_error", reason: "Pairing request not found" },
      };
    }

    if (request.mutableStatus !== "pending") {
      return {
        ok: false,
        error: {
          kind: "pairing_error",
          reason: `Cannot cancel pairing in status '${request.mutableStatus}'`,
        },
      };
    }

    request.mutableStatus = "cancelled";

    return {
      ok: true,
      value: {
        requestId,
        walletId: request.walletId,
        principalId: request.principalId,
        publicKey: new Uint8Array(0),
        consumedAt: new Date().toISOString(),
      },
    };
  }

  /**
   * Gets the current status of a pairing request (for testing/diagnostics).
   */
  getRequest(requestId: string): PairingRequest | undefined {
    const request = this.#requests.get(requestId);
    if (!request) return undefined;
    return {
      requestId: request.requestId,
      walletId: request.walletId,
      principalId: request.principalId,
      challenge: request.challenge,
      expiresAt: request.expiresAt,
      status: request.mutableStatus,
      createdAt: request.createdAt,
      ...(request.deviceInfo !== undefined ? { deviceInfo: request.deviceInfo } : {}),
    };
  }
}
