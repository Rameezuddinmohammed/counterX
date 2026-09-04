import { describe, expect, it } from "vitest";
import { deriveAssociatedTokenAddress } from "./associated-token.js";

describe("deriveAssociatedTokenAddress", () => {
  it("is deterministic — the same owner + mint always derives the same ATA", async () => {
    // A real, previously-verified devnet address (from this session's live
    // getAccountInfo checks) — not hand-typed, to avoid a malformed base58
    // string silently having the wrong byte length.
    const owner = "DjmxNyCj9ahQRPD1zU4zNZmEXbafCeEpruMHFmkTzBo";
    const mint = "So11111111111111111111111111111111111111112"; // native SOL mint (wSOL)

    const first = await deriveAssociatedTokenAddress(owner, mint);
    const second = await deriveAssociatedTokenAddress(owner, mint);

    expect(first).toBe(second);
    expect(typeof first).toBe("string");
    expect(first.length).toBeGreaterThan(0);
  });

  it("derives a DIFFERENT address for a different mint, same owner", async () => {
    const owner = "DjmxNyCj9ahQRPD1zU4zNZmEXbafCeEpruMHFmkTzBo";
    const mintA = "So11111111111111111111111111111111111111112";
    const mintB = "EPjFWdd5AufqSSqeM2qN1xzybapC8G4wEGGkZwyTDt1v"; // devnet/mainnet USDC mint

    const ataA = await deriveAssociatedTokenAddress(owner, mintA);
    const ataB = await deriveAssociatedTokenAddress(owner, mintB);

    expect(ataA).not.toBe(ataB);
  });
});
