/**
 * CTPAuthorityVerifier - concrete implementation of AuthorityVerifier.
 *
 * Performs the full verification sequence from TRUST-PROTOCOL.md section 16:
 * 1. Resolve agent from AgentRegistry
 * 2. Verify key is active at current time
 * 3. Verify envelope signature via trust-protocol verifyEnvelope
 * 4. Check nonce/replay via ConcurrentNonceStore
 * 5. Check revocation of mandate and key
 * 6. Validate issuer/subject binding, audience, environment
 * 7. Check assurance level meets requirements
 *
 * Returns VerifiedAuthority on success or typed AuthorityFailure on error.
 */

import { type Result, ok, err, type Instant } from "@counter/domain";
import {
  type NonceStore,
  type KeyRegistry,
  type KeyRecord,
  verifyEnvelope,
} from "@counter/trust-protocol";
import type { AgentRegistry } from "./agent-registry.js";
import { meetsAssuranceRequirement } from "./assurance-policy.js";
import type {
  AuthorityFailure,
  AuthorityInput,
  AuthorityVerifier,
  VerifiedAuthority,
} from "./authority-verifier.js";
import type { RevocationStore } from "./revocation-service.js";

// ---------------------------------------------------------------------------
// CTPAuthorityVerifier Dependencies
// ---------------------------------------------------------------------------

export interface CTPAuthorityVerifierDeps {
  readonly agentRegistry: AgentRegistry;
  readonly nonceStore: NonceStore;
  readonly revocationStore: RevocationStore;
  readonly expectedAudience: string;
}

// ---------------------------------------------------------------------------
// CTPAuthorityVerifier Implementation
// ---------------------------------------------------------------------------

export class CTPAuthorityVerifier implements AuthorityVerifier {
  readonly #agentRegistry: AgentRegistry;
  readonly #nonceStore: NonceStore;
  readonly #revocationStore: RevocationStore;
  readonly #expectedAudience: string;

  public constructor(deps: CTPAuthorityVerifierDeps) {
    this.#agentRegistry = deps.agentRegistry;
    this.#nonceStore = deps.nonceStore;
    this.#revocationStore = deps.revocationStore;
    this.#expectedAudience = deps.expectedAudience;
  }

  public async verify(input: AuthorityInput): Promise<Result<VerifiedAuthority, AuthorityFailure>> {
    const {
      envelope,
      agentId,
      kid,
      merchantId,
      environment,
      currentTime,
      nonce,
      requiredAssurance,
    } = input;

    // Step 1: Resolve agent
    const agent = await this.#agentRegistry.resolve(agentId, environment);
    if (agent === undefined) {
      return err(this.#failure("agent_not_found", "Agent not found in registry"));
    }

    // Check if agent is revoked
    if (agent.status === "revoked") {
      return err(this.#failure("agent_revoked", "Agent has been revoked"));
    }

    // Step 2: Verify key is active at current time
    const keyActive = await this.#agentRegistry.isKeyActive(agentId, kid, currentTime);
    if (!keyActive) {
      return err(this.#failure("key_revoked", "Key is not active at the current time"));
    }

    // Step 3: Verify envelope signature
    // Build a KeyRegistry adapter for the agent's key
    const keyRecord = this.#findKeyRecord(agent, kid);
    if (keyRecord === undefined) {
      return err(this.#failure("key_not_found", "Key not found in agent key history"));
    }

    const keyRegistry = new AgentKeyRegistryAdapter(keyRecord);
    const currentTimeIso = new Date(currentTime).toISOString();

    const verifyResult = await verifyEnvelope(envelope, {
      keyRegistry,
      currentTime: currentTimeIso,
      expectedAudience: this.#expectedAudience,
      expectedEnvironment: environment,
    });

    if (!verifyResult.ok) {
      // Map the error to an appropriate failure reason
      const errorMessage = verifyResult.error.message;
      if (errorMessage.includes("signature")) {
        return err(this.#failure("signature_invalid", "Envelope signature verification failed"));
      }
      if (errorMessage.includes("audience")) {
        return err(this.#failure("audience_mismatch", "Verifier is not in the envelope audience"));
      }
      if (errorMessage.includes("environment") || errorMessage.includes("Environment")) {
        return err(this.#failure("environment_mismatch", "Envelope environment does not match"));
      }
      if (errorMessage.includes("expired") || errorMessage.includes("not yet valid")) {
        return err(this.#failure("validity_window", "Envelope is outside its validity window"));
      }
      return err(
        this.#failure("signature_invalid", `Envelope verification failed: ${errorMessage}`),
      );
    }

    // Step 4: Check nonce/replay
    const nonceNew = await this.#nonceStore.checkAndRecord(nonce, envelope.id);
    if (!nonceNew) {
      return err(this.#failure("nonce_replay", "Nonce has already been used (replay detected)"));
    }

    // Step 5: Check revocation of mandate
    const payload = envelope.payload;
    const mandateRevoked = await this.#revocationStore.isRevoked(
      "mandate",
      payload.mandate_id,
      currentTime,
    );
    if (mandateRevoked) {
      return err(this.#failure("mandate_revoked", "Mandate has been revoked"));
    }

    // Check revocation of key
    const keyRevoked = await this.#revocationStore.isRevoked("key", kid, currentTime);
    if (keyRevoked) {
      return err(this.#failure("key_revoked", "Key has been revoked"));
    }

    // Step 6: Validate issuer/subject binding
    // The issuer should correspond to the agent
    if (envelope.subject !== agentId && envelope.issuer !== agentId) {
      return err(
        this.#failure("binding_mismatch", "Envelope issuer/subject does not match agent identity"),
      );
    }

    // Validate merchant is in allowed merchants
    if (payload.allowed_merchants.length > 0 && !payload.allowed_merchants.includes(merchantId)) {
      return err(
        this.#failure("audience_mismatch", "Merchant is not in mandate allowed merchants"),
      );
    }

    // Step 7: Check validity window of the mandate payload
    const validityStart = Date.parse(payload.validity_start);
    const validityEnd = Date.parse(payload.validity_end);
    if (currentTime < validityStart || currentTime > validityEnd) {
      return err(this.#failure("mandate_expired", "Mandate is outside its validity window"));
    }

    // Step 8: Check assurance level
    const agentAssurance = agent.assuranceLevel;
    if (requiredAssurance !== undefined) {
      if (!meetsAssuranceRequirement(agentAssurance, requiredAssurance)) {
        return err(
          this.#failure(
            "assurance_insufficient",
            `Agent assurance '${agentAssurance}' does not meet required '${requiredAssurance}'`,
          ),
        );
      }
    }

    // Build VerifiedAuthority
    const validUntilMs = Math.min(validityEnd, Date.parse(envelope.expires_at));
    const verified: VerifiedAuthority = Object.freeze({
      mandateId: payload.mandate_id,
      agentId,
      kid,
      merchantId,
      environment,
      assuranceLevel: agentAssurance,
      allowedOperations: Object.freeze([...payload.allowed_operations]),
      allowedMerchants: Object.freeze([...payload.allowed_merchants]),
      currencies: Object.freeze([...payload.currencies]),
      perTransactionLimit: Object.freeze({ ...payload.per_transaction_limit }),
      validUntil: validUntilMs as Instant,
    });

    return ok(verified);
  }

  #failure(reason: AuthorityFailure["reason"], message: string): AuthorityFailure {
    return Object.freeze({ reason, message });
  }

  #findKeyRecord(
    agent: { readonly keyHistory: readonly { readonly kid: string; readonly publicKey: string }[] },
    kid: string,
  ): KeyRecord | undefined {
    const entry = agent.keyHistory.find((k) => k.kid === kid);
    if (entry === undefined) {
      return undefined;
    }
    return {
      kid: entry.kid,
      use: "sign",
      alg: "EdDSA",
      publicKey: entry.publicKey,
      status: "active",
      validFrom: "2000-01-01T00:00:00.000Z",
      validUntil: "2099-12-31T23:59:59.999Z",
      issuer: "counter://agent",
    };
  }
}

// ---------------------------------------------------------------------------
// Internal KeyRegistry adapter
// ---------------------------------------------------------------------------

class AgentKeyRegistryAdapter implements KeyRegistry {
  readonly #record: KeyRecord;

  public constructor(record: KeyRecord) {
    this.#record = record;
  }

  public async resolve(kid: string): Promise<KeyRecord | undefined> {
    if (kid === this.#record.kid) {
      return this.#record;
    }
    return undefined;
  }
}
