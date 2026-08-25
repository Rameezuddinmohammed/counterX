/**
 * Tests for device pairing and agent registration services.
 *
 * Covers:
 * - Expired pairing rejected
 * - Replay of consumed pairing rejected
 * - Invalid proof-of-possession rejected (wrong key signs challenge)
 * - Duplicate agent registration with same key rejected
 * - Pairing grants no mandate/transaction authority
 * - Registration creates valid CTP envelope
 * - Suspend/revoke changes status
 * - Wrong wallet pairing rejected
 */

import { describe, it, expect, beforeEach } from "vitest";
import * as ed from "@noble/ed25519";
import type { CounterId } from "@counter/domain";
import { CryptoIdGenerator } from "@counter/domain";
import { PairingService } from "./device-pairing.js";
import type { PairingResult } from "./device-pairing.js";
import { AgentRegistrationService } from "./agent-registration.js";
import type { StepUpSession } from "./step-up-service.js";

// ---------------------------------------------------------------------------
// Test helpers
// ---------------------------------------------------------------------------

const idGenerator = new CryptoIdGenerator();

function makeWalletId(): CounterId<"wallet"> {
  return idGenerator.generate("wallet");
}

function makePrincipalId(): CounterId<"actor"> {
  return idGenerator.generate("actor");
}

function makeValidStepUpSession(principalId: CounterId<"actor">): StepUpSession {
  const now = new Date();
  return {
    principal_id: principalId,
    method: "webauthn",
    assurance: "substantial",
    authenticated_at: now.toISOString(),
    expires_at: new Date(now.getTime() + 300_000).toISOString(),
    nonce: `nonce-${crypto.randomUUID()}`,
  };
}

async function generateTestKeyPair(): Promise<{ privateKey: Uint8Array; publicKey: Uint8Array }> {
  const privateKey = ed.utils.randomPrivateKey();
  const publicKey = await ed.getPublicKeyAsync(privateKey);
  return { privateKey, publicKey };
}

// ---------------------------------------------------------------------------
// PairingService Tests
// ---------------------------------------------------------------------------

describe("PairingService", () => {
  let service: PairingService;
  let walletId: CounterId<"wallet">;
  let principalId: CounterId<"actor">;

  beforeEach(() => {
    service = new PairingService();
    walletId = makeWalletId();
    principalId = makePrincipalId();
  });

  describe("createPairingRequest", () => {
    it("creates a pending request with a challenge", () => {
      const request = service.createPairingRequest(walletId, principalId);
      expect(request.status).toBe("pending");
      expect(request.walletId).toBe(walletId);
      expect(request.principalId).toBe(principalId);
      expect(request.challenge).toBeInstanceOf(Uint8Array);
      expect(request.challenge.byteLength).toBe(32);
      expect(request.requestId).toBeTruthy();
    });

    it("creates unique request IDs", () => {
      const r1 = service.createPairingRequest(walletId, principalId);
      const r2 = service.createPairingRequest(walletId, principalId);
      expect(r1.requestId).not.toBe(r2.requestId);
    });
  });

  describe("consumePairing", () => {
    it("succeeds with valid proof-of-possession", async () => {
      const { privateKey, publicKey } = await generateTestKeyPair();
      const request = service.createPairingRequest(walletId, principalId);

      // Sign the challenge with the device private key
      const proof = await ed.signAsync(request.challenge, privateKey);

      const result = await service.consumePairing(request.requestId, proof, publicKey);
      expect(result.ok).toBe(true);
      if (result.ok) {
        expect(result.value.walletId).toBe(walletId);
        expect(result.value.principalId).toBe(principalId);
        expect(result.value.publicKey).toEqual(publicKey);
      }
    });

    it("rejects expired pairing", async () => {
      const { privateKey, publicKey } = await generateTestKeyPair();
      // Create with 0ms TTL (immediately expired)
      const request = service.createPairingRequest(walletId, principalId, 0);

      // Wait a tiny amount to ensure expiry
      await new Promise((resolve) => setTimeout(resolve, 5));

      const proof = await ed.signAsync(request.challenge, privateKey);
      const result = await service.consumePairing(request.requestId, proof, publicKey);
      expect(result.ok).toBe(false);
      if (!result.ok) {
        expect(result.error.reason).toContain("expired");
      }
    });

    it("rejects replay of consumed pairing", async () => {
      const { privateKey, publicKey } = await generateTestKeyPair();
      const request = service.createPairingRequest(walletId, principalId);
      const proof = await ed.signAsync(request.challenge, privateKey);

      // First consume succeeds
      const first = await service.consumePairing(request.requestId, proof, publicKey);
      expect(first.ok).toBe(true);

      // Second consume rejected (replay)
      const second = await service.consumePairing(request.requestId, proof, publicKey);
      expect(second.ok).toBe(false);
      if (!second.ok) {
        expect(second.error.reason).toContain("replay");
      }
    });

    it("rejects invalid proof-of-possession (wrong key)", async () => {
      const { publicKey } = await generateTestKeyPair();
      const wrongKey = await generateTestKeyPair();
      const request = service.createPairingRequest(walletId, principalId);

      // Sign with wrong private key
      const proof = await ed.signAsync(request.challenge, wrongKey.privateKey);
      const result = await service.consumePairing(request.requestId, proof, publicKey);
      expect(result.ok).toBe(false);
      if (!result.ok) {
        expect(result.error.reason).toContain("proof-of-possession");
      }
    });

    it("rejects non-existent request", async () => {
      const { publicKey } = await generateTestKeyPair();
      const result = await service.consumePairing("non-existent-id", new Uint8Array(64), publicKey);
      expect(result.ok).toBe(false);
      if (!result.ok) {
        expect(result.error.reason).toContain("not found");
      }
    });
  });

  describe("cancelPairing", () => {
    it("cancels a pending request", () => {
      const request = service.createPairingRequest(walletId, principalId);
      const result = service.cancelPairing(request.requestId);
      expect(result.ok).toBe(true);

      // Verify status changed
      const updated = service.getRequest(request.requestId);
      expect(updated?.status).toBe("cancelled");
    });

    it("cannot consume a cancelled request", async () => {
      const { privateKey, publicKey } = await generateTestKeyPair();
      const request = service.createPairingRequest(walletId, principalId);
      service.cancelPairing(request.requestId);

      const proof = await ed.signAsync(request.challenge, privateKey);
      const result = await service.consumePairing(request.requestId, proof, publicKey);
      expect(result.ok).toBe(false);
      if (!result.ok) {
        expect(result.error.reason).toContain("cancelled");
      }
    });
  });
});

// ---------------------------------------------------------------------------
// AgentRegistrationService Tests
// ---------------------------------------------------------------------------

describe("AgentRegistrationService", () => {
  let pairingService: PairingService;
  let registrationService: AgentRegistrationService;
  let walletId: CounterId<"wallet">;
  let principalId: CounterId<"actor">;

  beforeEach(() => {
    pairingService = new PairingService();
    registrationService = new AgentRegistrationService();
    walletId = makeWalletId();
    principalId = makePrincipalId();
  });

  async function completePairing(): Promise<PairingResult> {
    const { privateKey, publicKey } = await generateTestKeyPair();
    const request = pairingService.createPairingRequest(walletId, principalId);
    const proof = await ed.signAsync(request.challenge, privateKey);
    const result = await pairingService.consumePairing(request.requestId, proof, publicKey);
    if (!result.ok) throw new Error("Pairing failed in test setup");
    return result.value;
  }

  describe("register", () => {
    it("creates a valid agent registration with CTP envelope", async () => {
      const pairingResult = await completePairing();
      const stepUp = makeValidStepUpSession(principalId);

      const result = registrationService.register(
        walletId,
        pairingResult,
        pairingResult.publicKey,
        "test-device",
        stepUp,
      );

      expect(result.ok).toBe(true);
      if (result.ok) {
        expect(result.value.agentId).toBeTruthy();
        expect(result.value.walletId).toBe(walletId);
        expect(result.value.publicKeyDescriptor.algorithm).toBe("Ed25519");
        expect(result.value.publicKeyDescriptor.status).toBe("active");
        expect(result.value.status).toBe("active");
        expect(result.value.registrationCertificateDigest).toBeTruthy();
        expect(result.value.deviceId).toBeTruthy();
      }
    });

    it("rejects wrong wallet ID in pairing", async () => {
      const pairingResult = await completePairing();
      const stepUp = makeValidStepUpSession(principalId);
      const differentWallet = makeWalletId();

      const result = registrationService.register(
        differentWallet,
        pairingResult,
        pairingResult.publicKey,
        undefined,
        stepUp,
      );

      expect(result.ok).toBe(false);
      if (!result.ok) {
        expect(result.error.reason).toContain("Wallet ID mismatch");
      }
    });

    it("rejects expired step-up session", async () => {
      const pairingResult = await completePairing();
      const expiredSession: StepUpSession = {
        principal_id: principalId,
        method: "webauthn",
        assurance: "substantial",
        authenticated_at: new Date(Date.now() - 600_000).toISOString(),
        expires_at: new Date(Date.now() - 300_000).toISOString(),
        nonce: `nonce-${crypto.randomUUID()}`,
      };

      const result = registrationService.register(
        walletId,
        pairingResult,
        pairingResult.publicKey,
        undefined,
        expiredSession,
      );

      expect(result.ok).toBe(false);
      if (!result.ok) {
        expect(result.error.reason).toContain("Step-up validation failed");
      }
    });

    it("rejects duplicate registration with same public key", async () => {
      const pairingResult = await completePairing();
      const stepUp1 = makeValidStepUpSession(principalId);

      const first = registrationService.register(
        walletId,
        pairingResult,
        pairingResult.publicKey,
        "device-1",
        stepUp1,
      );
      expect(first.ok).toBe(true);

      // Try to register the same public key again
      const stepUp2 = makeValidStepUpSession(principalId);
      const second = registrationService.register(
        walletId,
        pairingResult,
        pairingResult.publicKey,
        "device-2",
        stepUp2,
      );

      expect(second.ok).toBe(false);
      if (!second.ok) {
        expect(second.error.reason).toContain("already registered");
      }
    });

    it("pairing grants no mandate or transaction authority", async () => {
      const pairingResult = await completePairing();
      const stepUp = makeValidStepUpSession(principalId);

      const result = registrationService.register(
        walletId,
        pairingResult,
        pairingResult.publicKey,
        "device",
        stepUp,
      );

      expect(result.ok).toBe(true);
      if (result.ok) {
        // Registration only binds identity, no mandate fields
        const reg = registrationService.getRegistration(result.value.agentId);
        expect(reg).toBeDefined();
        // No mandate, no transaction authority - just identity binding
        expect(reg!.status).toBe("active");
        expect(reg!.publicKeyDescriptor.status).toBe("active");
        // The registration object has no mandate fields
        expect("mandate" in reg!).toBe(false);
        expect("transactionAuthority" in reg!).toBe(false);
      }
    });
  });

  describe("suspend", () => {
    it("changes status to suspended", async () => {
      const pairingResult = await completePairing();
      const stepUp = makeValidStepUpSession(principalId);
      const regResult = registrationService.register(
        walletId,
        pairingResult,
        pairingResult.publicKey,
        "device",
        stepUp,
      );
      expect(regResult.ok).toBe(true);
      if (!regResult.ok) return;

      const suspendResult = registrationService.suspend(regResult.value.agentId);
      expect(suspendResult.ok).toBe(true);
      if (suspendResult.ok) {
        expect(suspendResult.value.status).toBe("suspended");
      }

      const reg = registrationService.getRegistration(regResult.value.agentId);
      expect(reg?.status).toBe("suspended");
    });
  });

  describe("revoke", () => {
    it("changes status to revoked", async () => {
      const pairingResult = await completePairing();
      const stepUp = makeValidStepUpSession(principalId);
      const regResult = registrationService.register(
        walletId,
        pairingResult,
        pairingResult.publicKey,
        "device",
        stepUp,
      );
      expect(regResult.ok).toBe(true);
      if (!regResult.ok) return;

      const revokeResult = registrationService.revoke(regResult.value.agentId);
      expect(revokeResult.ok).toBe(true);
      if (revokeResult.ok) {
        expect(revokeResult.value.status).toBe("revoked");
        expect(revokeResult.value.publicKeyDescriptor.status).toBe("revoked");
      }

      const reg = registrationService.getRegistration(regResult.value.agentId);
      expect(reg?.status).toBe("revoked");
    });

    it("cannot suspend a revoked agent", async () => {
      const pairingResult = await completePairing();
      const stepUp = makeValidStepUpSession(principalId);
      const regResult = registrationService.register(
        walletId,
        pairingResult,
        pairingResult.publicKey,
        "device",
        stepUp,
      );
      expect(regResult.ok).toBe(true);
      if (!regResult.ok) return;

      registrationService.revoke(regResult.value.agentId);
      const suspendResult = registrationService.suspend(regResult.value.agentId);
      expect(suspendResult.ok).toBe(false);
      if (!suspendResult.ok) {
        expect(suspendResult.error.reason).toContain("revoked");
      }
    });
  });

  describe("getRegistration", () => {
    it("returns undefined for unknown agent", () => {
      const fakeId = idGenerator.generate("agent");
      const reg = registrationService.getRegistration(fakeId);
      expect(reg).toBeUndefined();
    });
  });
});
