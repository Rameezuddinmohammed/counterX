/**
 * Authority context binds consequential commands to their authorization chain.
 * A material change to any field in the authority context requires a new command.
 */

import type { CounterId, Sha256Digest } from "@counter/domain";

export interface AuthorityContext {
  readonly mandateId: CounterId<"mandate">;
  readonly policyDecisionId: CounterId<"policy-decision">;
  readonly quoteDigest: Sha256Digest;
  readonly paymentReference: CounterId<"payment-reference">;
  readonly destination: string;
  readonly idempotencyKey: CounterId<"idempotency">;
  readonly transactionVersion: number;
}
