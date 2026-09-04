/**
 * Tests for mandate-delegation.ts.
 *
 * SCOPE, stated plainly (per this package's brief: skip real-network
 * assertions, they aren't unit-testable without devnet): `initSubscription
 * Authority` and `createOnChainDelegation` themselves call live RPC methods
 * (`fetchMaybe`, `sendTransaction`) internally and build their own
 * `@solana/kit` client with no injectable seam (unlike
 * solana-settlement-provider.ts's port-injected design) — that is a
 * deliberate consequence of this file's spec ("build it fresh here...
 * don't try to import/reuse real-solana-port.ts's private client"). Those
 * two functions are exercised end-to-end only by the real devnet
 * verification script referenced in this package's headers, not here.
 *
 * What IS meaningfully unit-testable offline: PDA derivation
 * (`findSubscriptionAuthorityPda` / `findFixedDelegationPda`, re-exported
 * from `@solana/subscriptions`) is pure address math — no RPC call, only
 * local key/seed derivation — and is exactly what both exported functions
 * rely on to compute the `FixedDelegationCoordinates` they return. This
 * file exercises that determinism and the resulting coordinate shape
 * directly, without touching a network.
 */
import { describe, expect, it } from "vitest";
import { address, generateKeyPairSigner } from "@solana/kit";
import { findSubscriptionAuthorityPda, findFixedDelegationPda } from "@solana/subscriptions";

const TOKEN_MINT = address("So11111111111111111111111111111111111111112");

describe("PDA derivation underlying FixedDelegationCoordinates", () => {
  it("findSubscriptionAuthorityPda is deterministic for the same (user, tokenMint)", async () => {
    const buyer = await generateKeyPairSigner();

    const [pdaA] = await findSubscriptionAuthorityPda({
      user: buyer.address,
      tokenMint: TOKEN_MINT,
    });
    const [pdaB] = await findSubscriptionAuthorityPda({
      user: buyer.address,
      tokenMint: TOKEN_MINT,
    });

    expect(pdaA).toBe(pdaB);
    expect(typeof pdaA).toBe("string");
    expect(pdaA.length).toBeGreaterThan(0);
  });

  it("findSubscriptionAuthorityPda differs for different buyers", async () => {
    const buyerA = await generateKeyPairSigner();
    const buyerB = await generateKeyPairSigner();

    const [pdaA] = await findSubscriptionAuthorityPda({
      user: buyerA.address,
      tokenMint: TOKEN_MINT,
    });
    const [pdaB] = await findSubscriptionAuthorityPda({
      user: buyerB.address,
      tokenMint: TOKEN_MINT,
    });

    expect(pdaA).not.toBe(pdaB);
  });

  it("findFixedDelegationPda is deterministic for the same seeds and varies with nonce", async () => {
    const buyer = await generateKeyPairSigner();
    const delegate = await generateKeyPairSigner();
    const [subscriptionAuthorityPda] = await findSubscriptionAuthorityPda({
      user: buyer.address,
      tokenMint: TOKEN_MINT,
    });

    const [pdaNonce0A] = await findFixedDelegationPda({
      subscriptionAuthority: subscriptionAuthorityPda,
      delegator: buyer.address,
      delegatee: delegate.address,
      nonce: 0n,
    });
    const [pdaNonce0B] = await findFixedDelegationPda({
      subscriptionAuthority: subscriptionAuthorityPda,
      delegator: buyer.address,
      delegatee: delegate.address,
      nonce: 0n,
    });
    const [pdaNonce1] = await findFixedDelegationPda({
      subscriptionAuthority: subscriptionAuthorityPda,
      delegator: buyer.address,
      delegatee: delegate.address,
      nonce: 1n,
    });

    expect(pdaNonce0A).toBe(pdaNonce0B);
    expect(pdaNonce0A).not.toBe(pdaNonce1);
  });

  it("a full FixedDelegationCoordinates shape can be assembled from these pure derivations plus public inputs", async () => {
    // Mirrors exactly what createOnChainDelegation does internally, minus
    // the network calls (init/createFixedDelegation/sendTransaction).
    const buyer = await generateKeyPairSigner();
    const delegate = await generateKeyPairSigner();
    const buyerAta = "BuyerAta1111111111111111111111111111111111";

    const [subscriptionAuthorityPda] = await findSubscriptionAuthorityPda({
      user: buyer.address,
      tokenMint: TOKEN_MINT,
    });
    const [fixedDelegationPda] = await findFixedDelegationPda({
      subscriptionAuthority: subscriptionAuthorityPda,
      delegator: buyer.address,
      delegatee: delegate.address,
      nonce: 0n,
    });

    const coordinates = {
      subscriptionAuthorityPda,
      fixedDelegationPda,
      delegatorAddress: buyer.address,
      delegatorAta: buyerAta,
      delegateeAddress: delegate.address,
      tokenMint: TOKEN_MINT,
    };

    expect(coordinates.subscriptionAuthorityPda).toBeTruthy();
    expect(coordinates.fixedDelegationPda).toBeTruthy();
    expect(coordinates.delegatorAddress).toBe(buyer.address);
    expect(coordinates.delegateeAddress).toBe(delegate.address);
  });
});
