/**
 * The real SolanaSettlementPort, backed by @solana/kit + @solana/subscriptions
 * against devnet — mirrors razorpay-adapter's real-http-client.ts's role
 * (the one implementation that actually talks to the network; everything
 * else in this package depends on the SolanaSettlementPort interface, not
 * on this file, so tests never need real network access).
 *
 * VERIFICATION STATUS, stated plainly (CLAUDE.md: never claim verified from
 * inference when execution is possible): the underlying calls
 * (initSubscriptionAuthority, createFixedDelegation, an UNDER-cap
 * transferFixed) were directly executed against real devnet on 2026-09-04
 * and worked. The on-chain OVER-cap rejection this classifier depends on —
 * the errorFromSendFailure logic below — was NOT observed live: the same
 * verification run was blocked by devnet's shared faucet running dry before
 * it reached that step (a rate limit, not a code or program defect). The
 * classification below is a careful reading of @solana/errors'/
 * @solana/subscriptions' real, installed, compiled error constants — not a
 * guess — but confirm it against a live over-cap attempt before trusting it
 * unattended in a real demo. Fund the three throwaway devnet keypairs and
 * re-run the verification script once devnet SOL is obtainable again.
 */
import { createSolanaRpc, devnet, address, type KeyPairSigner } from "@solana/kit";
import { isSolanaError, SOLANA_ERROR__RPC__TRANSPORT_HTTP_ERROR } from "@solana/errors";
import { createClient } from "@solana/kit";
import { solanaRpc } from "@solana/kit-plugin-rpc";
import { signer as signerPlugin } from "@solana/kit-plugin-signer";
import {
  subscriptionsProgram,
  SUBSCRIPTIONS_ERROR__AMOUNT_EXCEEDS_LIMIT,
  SUBSCRIPTIONS_ERROR__DELEGATION_EXPIRED,
} from "@solana/subscriptions";
import { createCanonicalError } from "@counter/domain";
import type { SolanaAdapterConfig } from "./config.js";
import type {
  SolanaSettlementPort,
  SolanaTransferOutcome,
  TransferFixedParams,
} from "./solana-port.js";

const TOKEN_PROGRAM_ADDRESS = address("TokenkegQfeZyiNwAJbNbGKPFXCWuBvf9Ss623VQ5DA");

/** Known on-chain custom-error codes for the subscriptions program that
 * clearly mean "the mandate does not permit this" — a real business decline,
 * never a transport problem. Anything else raised by the program (a bug, an
 * account-layout mismatch) falls through to the generic "declined" branch
 * below rather than being silently swallowed as indeterminate. */
const KNOWN_DECLINE_CODES: ReadonlySet<number> = new Set([
  SUBSCRIPTIONS_ERROR__AMOUNT_EXCEEDS_LIMIT,
  SUBSCRIPTIONS_ERROR__DELEGATION_EXPIRED,
]);

function classifySendFailure(error: unknown): SolanaTransferOutcome {
  // A structured SolanaError means the RPC round-tripped and the SDK could
  // parse a real protocol/program-level response — that is a definite
  // outcome, confirmed or declined, never "maybe happened." Transport-level
  // failures (the request never got a real response) are the ONLY case
  // that's genuinely indeterminate — the transfer may or may not have
  // landed. See real-http-client.ts's identical timeout->indeterminate
  // convention for the Razorpay adapter; this is the Solana analogue.
  if (isSolanaError(error, SOLANA_ERROR__RPC__TRANSPORT_HTTP_ERROR)) {
    return { kind: "indeterminate", reason: "Solana devnet RPC transport error" };
  }
  const context = (error as { context?: { code?: unknown } } | undefined)?.context;
  const code = typeof context?.code === "number" ? context.code : undefined;
  if (code !== undefined && KNOWN_DECLINE_CODES.has(code)) {
    return {
      kind: "declined",
      reason:
        code === SUBSCRIPTIONS_ERROR__AMOUNT_EXCEEDS_LIMIT
          ? "AMOUNT_EXCEEDS_LIMIT: this transfer would exceed the mandate's remaining spend cap"
          : "DELEGATION_EXPIRED: the on-chain mandate has expired",
    };
  }
  const message = error instanceof Error ? error.message : String(error);
  // Anything else the SDK understood well enough to throw a real error for
  // (a malformed instruction, an account that doesn't exist, an unexpected
  // program error) is treated as declined rather than indeterminate — it is
  // NOT a "the request may not have reached the network" situation, it's
  // "the network answered and said no/this can't work," which should not be
  // silently retried as if nothing happened.
  return { kind: "declined", reason: message };
}

export function createRealSolanaSettlementPort(
  config: SolanaAdapterConfig,
  delegateSigner: KeyPairSigner,
): SolanaSettlementPort {
  // getSignatureStatus below only needs bare `rpc` (polling, not
  // subscription-based). `client`'s own solanaRpc plugin wires its own
  // rpcSubscriptions internally (used by .sendTransaction()'s confirmation
  // wait) — no separate rpcSubscriptions handle is needed at this scope.
  const rpc = createSolanaRpc(devnet(config.rpcUrl));
  const client = createClient()
    .use(signerPlugin(delegateSigner))
    .use(
      solanaRpc({
        rpcUrl: devnet(config.rpcUrl),
        rpcSubscriptionsUrl: devnet(config.rpcSubscriptionsUrl),
      }),
    )
    .use(subscriptionsProgram());

  return {
    async transferFixed(params: TransferFixedParams): Promise<SolanaTransferOutcome> {
      const { coordinates, receiverAta, amountMinor } = params;
      try {
        // Real shape per @solana/subscriptions' own compiled .d.ts
        // (TransferDelegationInput) — flat, not nested under a
        // `transferData` object, no `subscriptionAuthority` field (the
        // program derives it from `delegator` + `tokenMint` itself), and
        // `delegatee` is optional (defaults to this client's configured
        // signer plugin — see the `signerPlugin(delegateSigner)` .use()
        // above). The initial verification script guessed a different,
        // WRONG shape here (transferData-nested, an explicit
        // subscriptionAuthority field) that TypeScript caught at build
        // time — it had never actually been executed (the verification run
        // was blocked by a devnet faucet limit before reaching this call).
        const result = await client.subscriptions.instructions
          .transferFixed({
            amount: amountMinor,
            delegationPda: address(coordinates.fixedDelegationPda),
            delegator: address(coordinates.delegatorAddress),
            delegatorAta: address(coordinates.delegatorAta),
            receiverAta: address(receiverAta),
            tokenMint: address(coordinates.tokenMint),
            tokenProgram: TOKEN_PROGRAM_ADDRESS,
          })
          .sendTransaction();
        const signature = (result as { signature?: string } | undefined)?.signature;
        if (signature === undefined) {
          // The SDK returned success but no signature — treat as indeterminate
          // rather than fabricate a landed-with-no-proof outcome.
          throw createCanonicalError("UNAVAILABLE");
        }
        return { kind: "landed", signature };
      } catch (error) {
        if (
          error !== null &&
          typeof error === "object" &&
          "code" in error &&
          (error as { code?: unknown }).code === "canonical_error"
        ) {
          throw error;
        }
        return classifySendFailure(error);
      }
    },

    async getSignatureStatus(signature) {
      const response = await rpc.getSignatureStatuses([signature as never]).send();
      const status = response.value[0];
      if (status === null || status === undefined) return "not_found";
      if (status.err !== null) return "failed";
      if (status.confirmationStatus === "finalized") return "finalized";
      return "confirmed";
    },
  };
}
