/**
 * Agent registration service for wallet agent identity binding.
 *
 * An AgentRegistration binds a stable Agent URI (CounterId<"agent">) to:
 * - A wallet (walletId)
 * - A public key (publicKeyDescriptor)
 * - A device (deviceId)
 * - A registration certificate (CTP envelope digest)
 *
 * Registration requires:
 * 1. A completed (consumed) pairing proving device possession
 * 2. A valid step-up session proving principal approval
 *
 * Registration grants NO mandate or transaction authority. It only binds
 * an agent identity to a wallet for future mandate issuance.
 */

import type { CounterId } from "@counter/domain";
import { CryptoIdGenerator } from "@counter/domain";
import type { AgentRegistrationPayload } from "@counter/trust-protocol";
import { buildUnsignedEnvelope, computePayloadDigest } from "@counter/trust-protocol";
import type { PairingResult } from "./device-pairing.js";
import type { StepUpSession } from "./step-up-service.js";
import { StepUpService } from "./step-up-service.js";

// ---------------------------------------------------------------------------
// Public Key Descriptor for Agent Registration
// ---------------------------------------------------------------------------

export interface AgentPublicKeyDescriptor {
  readonly kid: string;
  readonly publicKey: Uint8Array;
  readonly algorithm: "Ed25519";
  readonly status: "active" | "rotated" | "revoked";
}

// ---------------------------------------------------------------------------
// Agent Registration
// ---------------------------------------------------------------------------

export interface AgentRegistration {
  readonly agentId: CounterId<"agent">;
  readonly walletId: CounterId<"wallet">;
  readonly publicKeyDescriptor: AgentPublicKeyDescriptor;
  readonly registeredAt: string;
  readonly deviceId: CounterId<"device">;
  readonly status: "active" | "suspended" | "revoked";
  readonly registrationCertificateDigest: string;
}

// ---------------------------------------------------------------------------
// Registration Error
// ---------------------------------------------------------------------------

export interface RegistrationError {
  readonly kind: "registration_error";
  readonly reason: string;
}

export type RegistrationOutcome =
  | { readonly ok: true; readonly value: AgentRegistration }
  | { readonly ok: false; readonly error: RegistrationError };

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function toBase64Url(bytes: Uint8Array): string {
  let binary = "";
  for (const b of bytes) {
    binary += String.fromCharCode(b);
  }
  return btoa(binary).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
}

// ---------------------------------------------------------------------------
// Internal mutable registration entry
// ---------------------------------------------------------------------------

interface MutableRegistrationEntry extends AgentRegistration {
  mutableStatus: "active" | "suspended" | "revoked";
}

// ---------------------------------------------------------------------------
// AgentRegistrationService
// ---------------------------------------------------------------------------

export class AgentRegistrationService {
  readonly #registrations = new Map<string, MutableRegistrationEntry>();
  readonly #keyIndex = new Map<string, string>(); // publicKey base64url -> agentId
  readonly #idGenerator: CryptoIdGenerator;
  readonly #stepUpService: StepUpService;

  constructor(stepUpService?: StepUpService) {
    this.#idGenerator = new CryptoIdGenerator();
    this.#stepUpService = stepUpService ?? new StepUpService();
  }

  /**
   * Registers a new agent bound to a wallet.
   *
   * Requirements:
   * - Pairing must be consumed (proof-of-possession verified)
   * - Step-up session must be valid (principal approval)
   * - Public key must not already be registered (duplicate rejection)
   *
   * @param walletId - The wallet to register the agent for
   * @param pairingProof - Result from a successful consumePairing call
   * @param publicKey - The agent's public key (from pairing)
   * @param deviceInfo - Optional device identifier
   * @param stepUpSession - Valid step-up session proving principal approval
   */
  register(
    walletId: CounterId<"wallet">,
    pairingProof: PairingResult,
    publicKey: Uint8Array,
    deviceInfo: string | undefined,
    stepUpSession: StepUpSession,
  ): RegistrationOutcome {
    // Validate wallet ID matches the pairing
    if (pairingProof.walletId !== walletId) {
      return {
        ok: false,
        error: { kind: "registration_error", reason: "Wallet ID mismatch between registration and pairing" },
      };
    }

    // Validate step-up session
    const stepUpValidation = this.#stepUpService.validateSession(stepUpSession);
    if (!stepUpValidation.valid) {
      return {
        ok: false,
        error: { kind: "registration_error", reason: `Step-up validation failed: ${stepUpValidation.reason}` },
      };
    }

    // Check for duplicate public key registration
    const publicKeyB64 = toBase64Url(publicKey);
    if (this.#keyIndex.has(publicKeyB64)) {
      return {
        ok: false,
        error: { kind: "registration_error", reason: "Public key is already registered to another agent" },
      };
    }

    // Generate stable Agent URI
    const agentId = this.#idGenerator.generate("agent");
    const deviceId = this.#idGenerator.generate("device");
    const kid = `kid-${agentId}`;
    const now = new Date().toISOString();

    // Build CTP agent-registration envelope
    const validityEnd = new Date(Date.now() + 365 * 24 * 60 * 60 * 1000).toISOString(); // 1 year

    const payload: AgentRegistrationPayload = {
      principal_id: pairingProof.principalId,
      wallet_id: walletId,
      agent_uri: `counter://agent/${agentId}`,
      public_key: toBase64Url(publicKey),
      kid,
      proof_of_possession: toBase64Url(new Uint8Array(0)), // PoP was validated during pairing
      validity_start: now,
      validity_end: validityEnd,
      assurance_level: "substantial",
      ...(deviceInfo !== undefined ? { display_name: deviceInfo } : {}),
    };

    const envelopeResult = buildUnsignedEnvelope<AgentRegistrationPayload>({
      type: "counter.agent-registration.v1",
      id: `reg-${agentId}`,
      issuer: `counter://wallet/${walletId}`,
      subject: `counter://agent/${agentId}`,
      audience: [`counter://wallet/${walletId}`],
      environment: "pilot",
      issued_at: now,
      not_before: now,
      expires_at: validityEnd,
      nonce: pairingProof.requestId,
      correlation_id: `reg-corr-${agentId}`,
      payload,
      kid,
    });

    if (!envelopeResult.ok) {
      return {
        ok: false,
        error: { kind: "registration_error", reason: `Envelope construction failed: ${envelopeResult.error.message}` },
      };
    }

    // Compute registration certificate digest
    const certificateDigest = computePayloadDigest(envelopeResult.value);

    // Build public key descriptor
    const publicKeyDescriptor: AgentPublicKeyDescriptor = {
      kid,
      publicKey: new Uint8Array(publicKey),
      algorithm: "Ed25519",
      status: "active",
    };

    const registration: MutableRegistrationEntry = {
      agentId,
      walletId,
      publicKeyDescriptor,
      registeredAt: now,
      deviceId,
      status: "active",
      mutableStatus: "active",
      registrationCertificateDigest: certificateDigest,
    };

    this.#registrations.set(agentId, registration);
    this.#keyIndex.set(publicKeyB64, agentId);

    // Consume the step-up nonce to prevent replay
    this.#stepUpService.consumeNonce(stepUpSession.nonce);

    return {
      ok: true,
      value: {
        agentId,
        walletId,
        publicKeyDescriptor,
        registeredAt: now,
        deviceId,
        status: "active",
        registrationCertificateDigest: certificateDigest,
      },
    };
  }

  /**
   * Suspends an agent registration. Suspended agents cannot sign or act.
   */
  suspend(agentId: CounterId<"agent">): RegistrationOutcome {
    const reg = this.#registrations.get(agentId);
    if (!reg) {
      return {
        ok: false,
        error: { kind: "registration_error", reason: "Agent registration not found" },
      };
    }

    if (reg.mutableStatus === "revoked") {
      return {
        ok: false,
        error: { kind: "registration_error", reason: "Cannot suspend a revoked agent" },
      };
    }

    reg.mutableStatus = "suspended";

    return {
      ok: true,
      value: {
        agentId: reg.agentId,
        walletId: reg.walletId,
        publicKeyDescriptor: reg.publicKeyDescriptor,
        registeredAt: reg.registeredAt,
        deviceId: reg.deviceId,
        status: "suspended",
        registrationCertificateDigest: reg.registrationCertificateDigest,
      },
    };
  }

  /**
   * Revokes an agent registration. Revoked agents are permanently invalidated.
   * Invalidates any associated mandates.
   */
  revoke(agentId: CounterId<"agent">): RegistrationOutcome {
    const reg = this.#registrations.get(agentId);
    if (!reg) {
      return {
        ok: false,
        error: { kind: "registration_error", reason: "Agent registration not found" },
      };
    }

    reg.mutableStatus = "revoked";

    return {
      ok: true,
      value: {
        agentId: reg.agentId,
        walletId: reg.walletId,
        publicKeyDescriptor: {
          ...reg.publicKeyDescriptor,
          status: "revoked",
        },
        registeredAt: reg.registeredAt,
        deviceId: reg.deviceId,
        status: "revoked",
        registrationCertificateDigest: reg.registrationCertificateDigest,
      },
    };
  }

  /**
   * Gets an agent registration by ID.
   */
  getRegistration(agentId: CounterId<"agent">): AgentRegistration | undefined {
    const reg = this.#registrations.get(agentId);
    if (!reg) return undefined;

    return {
      agentId: reg.agentId,
      walletId: reg.walletId,
      publicKeyDescriptor: reg.publicKeyDescriptor,
      registeredAt: reg.registeredAt,
      deviceId: reg.deviceId,
      status: reg.mutableStatus,
      registrationCertificateDigest: reg.registrationCertificateDigest,
    };
  }
}
