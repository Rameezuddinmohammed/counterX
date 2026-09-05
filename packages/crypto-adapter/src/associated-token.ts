/**
 * Derives a Solana Associated Token Account (ATA) address for a given owner
 * + token mint — a pure, deterministic PDA derivation, no network call, no
 * signing. Used at charge time to turn a merchant's stored RECEIVING
 * address (a plain wallet address, e.g. from merchant.wallet_connections —
 * see apps/control-plane-api/src/merchant-wallet-connection-store.ts) into
 * the actual token-account address a `transferFixed` call needs to send to
 * — SPL token transfers move tokens between token accounts, not between
 * raw wallet addresses directly.
 */
import { address, type Address } from "@solana/kit";
import { findAssociatedTokenPda } from "@solana-program/token";
import type { SolanaAddress } from "./types.js";

const TOKEN_PROGRAM_ADDRESS: Address = address("TokenkegQfeZyiNwAJbNbGKPFXCWuBvf9Ss623VQ5DA");

/** Deterministic — the same (owner, mint) pair always derives the same ATA. */
export async function deriveAssociatedTokenAddress(
  ownerAddress: SolanaAddress,
  tokenMint: SolanaAddress,
): Promise<SolanaAddress> {
  const [pda] = await findAssociatedTokenPda({
    owner: address(ownerAddress),
    tokenProgram: TOKEN_PROGRAM_ADDRESS,
    mint: address(tokenMint),
  });
  return pda;
}
