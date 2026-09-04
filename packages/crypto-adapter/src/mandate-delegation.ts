/**
 * Mandate-ISSUANCE-time on-chain setup — a DIFFERENT moment than settlement
 * (solana-settlement-provider.ts / real-solana-port.ts). This runs ONCE when
 * a buyer authorizes an agent to spend on their behalf, wiring up the
 * on-chain `SubscriptionAuthority` + `FixedDelegation` accounts that the
 * settlement rail later reads via `FixedDelegationCoordinates`. This file is
 * NOT called by the settlement provider — it's meant to be invoked later
 * from wallet-console's mandate-issuance flow (out of scope for this
 * package to wire up; that caller just needs these two functions exported
 * cleanly).
 *
 * Builds its OWN @solana/kit client from a `SolanaAdapterConfig` and a buyer
 * `KeyPairSigner`, using the SAME construction pattern as
 * real-solana-port.ts (`createClient().use(signer(...)).use(solanaRpc(...))
 * .use(subscriptionsProgram())`) — that file's private client is not
 * exported, so this module does not import/reuse it, per this package's own
 * seam design (solana-port.ts is the only shared contract).
 *
 * VERIFICATION STATUS, stated plainly (CLAUDE.md: never claim verified from
 * inference when execution is possible): `initSubscriptionAuthority` and
 * `createFixedDelegation`, called in this exact instruction shape, were
 * directly executed against real devnet on 2026-09-04 — see
 * real-solana-port.ts's header for the shared verification record (that
 * file's transferFixed call and this file's two calls all came from the
 * same verification script). What is NOT verified: whether calling the
 * on-chain `initSubscriptionAuthority` instruction a SECOND time for an
 * already-initialized (owner, tokenMint) pair is a program-level no-op —
 * the verification run only called it once, and a repeat-call probe was not
 * performed (blocked by the same devnet faucet exhaustion noted in
 * real-solana-port.ts's header). Rather than assume undocumented on-chain
 * behavior, `initSubscriptionAuthority` below does its OWN idempotency
 * check client-side: it fetches the `subscriptionAuthority` PDA first and
 * skips sending the init instruction entirely if the account already
 * exists. This is a conservative guarantee that holds regardless of what
 * the program itself would do on a repeat call — confirm the program's own
 * behavior directly before relying on removing this guard.
 *
 * Over-cap rejection at `createFixedDelegation`/`transferFixed` time was
 * also not live-observed, for the same faucet-exhaustion reason — see
 * real-solana-port.ts's header. `createFixedDelegation` itself (creating a
 * NEW delegation, as opposed to transferring against one) was verified to
 * succeed once; a second `createFixedDelegation` call for the same
 * (subscriptionAuthority, delegator, delegatee, nonce) tuple was not
 * attempted, and per the program's own `DELEGATION_ALREADY_EXISTS` error
 * code, is NOT expected to be idempotent — callers must pass a fresh
 * `nonce` per delegation, not rely on this function to dedupe.
 */
import { createClient, devnet, address, type KeyPairSigner } from "@solana/kit";
import { solanaRpc } from "@solana/kit-plugin-rpc";
import { signer as signerPlugin } from "@solana/kit-plugin-signer";
import {
  subscriptionsProgram,
  findSubscriptionAuthorityPda,
  findFixedDelegationPda,
} from "@solana/subscriptions";
import { createCanonicalError } from "@counter/domain";
import type { SolanaAdapterConfig } from "./config.js";
import type { FixedDelegationCoordinates, SolanaAddress } from "./types.js";

// Mirrors real-solana-port.ts's own hardcoded constant (rather than pulling
// it from @solana-program/token) — same value, same reasoning: this is a
// fixed, well-known program address, not a per-deployment config value.
const TOKEN_PROGRAM_ADDRESS = address("TokenkegQfeZyiNwAJbNbGKPFXCWuBvf9Ss623VQ5DA");

function buildBuyerClient(config: SolanaAdapterConfig, buyerSigner: KeyPairSigner) {
  return createClient()
    .use(signerPlugin(buyerSigner))
    .use(
      solanaRpc({
        rpcUrl: devnet(config.rpcUrl),
        rpcSubscriptionsUrl: devnet(config.rpcSubscriptionsUrl),
      }),
    )
    .use(subscriptionsProgram());
}

// ─── initSubscriptionAuthority ────────────────────────────────────────────

export interface InitSubscriptionAuthorityParams {
  readonly config: SolanaAdapterConfig;
  readonly buyerSigner: KeyPairSigner;
  readonly tokenMint: SolanaAddress;
  /** The buyer's own associated token account for `tokenMint`. */
  readonly buyerAta: SolanaAddress;
}

export interface InitSubscriptionAuthorityResult {
  readonly subscriptionAuthorityPda: SolanaAddress;
  /** Absent when the account already existed and no transaction was sent
   * (the idempotent-no-op path — see this file's header). */
  readonly signature?: string;
}

/**
 * Idempotent-safe wrapper around the real `initSubscriptionAuthority`
 * instruction (see this file's header for the exact idempotency guarantee
 * and what is/isn't verified about it).
 */
export async function initSubscriptionAuthority(
  params: InitSubscriptionAuthorityParams,
): Promise<InitSubscriptionAuthorityResult> {
  const { config, buyerSigner, tokenMint, buyerAta } = params;
  const client = buildBuyerClient(config, buyerSigner);
  const tokenMintAddress = address(tokenMint);

  const [subscriptionAuthorityPda] = await findSubscriptionAuthorityPda({
    user: buyerSigner.address,
    tokenMint: tokenMintAddress,
  });

  const existing =
    await client.subscriptions.accounts.subscriptionAuthority.fetchMaybe(subscriptionAuthorityPda);
  if (existing.exists) {
    // Client-side idempotency: this buyer/mint pair is already set up
    // on-chain, so skip sending a redundant transaction.
    return { subscriptionAuthorityPda };
  }

  const result = await client.subscriptions.instructions
    .initSubscriptionAuthority({
      tokenMint: tokenMintAddress,
      tokenProgram: TOKEN_PROGRAM_ADDRESS,
      userAta: address(buyerAta),
    })
    .sendTransaction();

  const signature = (result as { signature?: string } | undefined)?.signature;
  if (signature === undefined) {
    // The SDK returned success but no signature — do not fabricate a
    // landed-with-no-proof outcome (same convention as real-solana-port.ts).
    throw createCanonicalError("UNAVAILABLE");
  }

  return { subscriptionAuthorityPda, signature };
}

// ─── createOnChainDelegation ───────────────────────────────────────────────

export interface CreateOnChainDelegationParams {
  readonly config: SolanaAdapterConfig;
  readonly buyerSigner: KeyPairSigner;
  readonly delegateAddress: SolanaAddress;
  readonly tokenMint: SolanaAddress;
  /** The buyer's own associated token account for `tokenMint` — becomes
   * `FixedDelegationCoordinates.delegatorAta` in the returned coordinates. */
  readonly buyerAta: SolanaAddress;
  /** Smallest on-chain unit of `tokenMint` the delegate may ever move in
   * total across this delegation's lifetime. */
  readonly capAmountMinor: bigint;
  /** Unix seconds after which the delegation can no longer be used. */
  readonly expiryUnixSeconds: bigint;
  /** Caller-chosen nonce distinguishing this delegation from any other the
   * same (subscriptionAuthority, delegator, delegatee) tuple might have —
   * NOT deduplicated by this function (see this file's header:
   * `createFixedDelegation` is not expected to be idempotent). */
  readonly nonce: bigint;
}

export interface CreateOnChainDelegationResult {
  readonly coordinates: FixedDelegationCoordinates;
  readonly signature: string;
}

/**
 * Wraps the real `createFixedDelegation` instruction call. Returns the
 * public `FixedDelegationCoordinates` a later settlement call will need
 * (threaded through `CreatePaymentInstruction.metadata` via
 * `encodeSolanaMetadata` — see solana-settlement-provider.ts /
 * metadata-codec.ts), plus the transaction signature for the issuance-time
 * receipt.
 */
export async function createOnChainDelegation(
  params: CreateOnChainDelegationParams,
): Promise<CreateOnChainDelegationResult> {
  const {
    config,
    buyerSigner,
    delegateAddress,
    tokenMint,
    buyerAta,
    capAmountMinor,
    expiryUnixSeconds,
    nonce,
  } = params;
  const client = buildBuyerClient(config, buyerSigner);
  const tokenMintAddress = address(tokenMint);
  const delegateeAddressValue = address(delegateAddress);

  const [subscriptionAuthorityPda] = await findSubscriptionAuthorityPda({
    user: buyerSigner.address,
    tokenMint: tokenMintAddress,
  });
  const [fixedDelegationPda] = await findFixedDelegationPda({
    subscriptionAuthority: subscriptionAuthorityPda,
    delegator: buyerSigner.address,
    delegatee: delegateeAddressValue,
    nonce,
  });

  const result = await client.subscriptions.instructions
    .createFixedDelegation({
      delegatee: delegateeAddressValue,
      tokenMint: tokenMintAddress,
      amount: capAmountMinor,
      expiryTs: expiryUnixSeconds,
      nonce,
    })
    .sendTransaction();

  const signature = (result as { signature?: string } | undefined)?.signature;
  if (signature === undefined) {
    throw createCanonicalError("UNAVAILABLE");
  }

  const coordinates: FixedDelegationCoordinates = Object.freeze({
    subscriptionAuthorityPda,
    fixedDelegationPda,
    delegatorAddress: buyerSigner.address,
    delegatorAta: buyerAta,
    delegateeAddress: delegateAddress,
    tokenMint,
  });

  return { coordinates, signature };
}
