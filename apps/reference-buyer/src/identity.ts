/**
 * Deterministic test identity for the reference buyer.
 *
 * Uses seeded Ed25519 keypair from @counter/trust-protocol for reproducibility.
 * All IDs are generated deterministically so tests are snapshot-stable.
 */

import type { AgentId, MerchantId, WalletId } from "@counter/domain";
import { CryptoIdGenerator } from "@counter/domain";
import type { Signer } from "@counter/trust-protocol";
import { createTestSignerA, TEST_KID_A } from "@counter/trust-protocol";

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export interface TestBuyerIdentity {
  readonly walletId: WalletId;
  readonly agentId: AgentId;
  readonly merchantId: MerchantId;
  readonly signer: Signer;
  readonly kid: string;
}

// ---------------------------------------------------------------------------
// Deterministic seed-based random source for reproducible IDs
// ---------------------------------------------------------------------------

/**
 * Creates a deterministic random byte source from a numeric seed.
 * Uses a simple PRNG (xorshift128+) seeded from the input for reproducibility.
 */
function createSeededRandomSource(seed: number): (length: number) => Uint8Array {
  // Simple splitmix32 for seeding
  let s0 = ((seed + 0x9e3779b9) | 0) >>> 0;
  let s1 = ((seed + 0x6a09e667) | 0) >>> 0;

  function next(): number {
    let t = s0;
    const s = s1;
    s0 = s;
    t ^= t << 23;
    t ^= t >>> 17;
    t ^= s;
    t ^= s >>> 26;
    s1 = t;
    return (s + t) >>> 0;
  }

  return (length: number): Uint8Array => {
    const bytes = new Uint8Array(length);
    for (let i = 0; i < length; i++) {
      bytes[i] = next() & 0xff;
    }
    return bytes;
  };
}

// ---------------------------------------------------------------------------
// Identity Factory
// ---------------------------------------------------------------------------

/** Deterministic seed used for all test buyer identity generation. */
const BUYER_IDENTITY_SEED = 0xc0_07_e8_42;

/**
 * Creates a deterministic test buyer identity.
 *
 * The identity is always the same across runs, enabling reproducible
 * scenario testing without dependency on external state.
 */
export function createTestBuyerIdentity(): TestBuyerIdentity {
  const randomSource = createSeededRandomSource(BUYER_IDENTITY_SEED);
  const idGenerator = new CryptoIdGenerator(randomSource);

  const walletId = idGenerator.generate("wallet");
  const agentId = idGenerator.generate("agent");
  const merchantId = idGenerator.generate("merchant");
  const signer = createTestSignerA();

  return Object.freeze({
    walletId,
    agentId,
    merchantId,
    signer,
    kid: TEST_KID_A,
  });
}
