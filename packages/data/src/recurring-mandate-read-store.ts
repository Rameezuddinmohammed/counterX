/**
 * Read-only, durable lookup of a recurring payment mandate's current state
 * (wallet.recurring_payment_mandates — created in
 * apps/control-plane-api/src/recurring-mandate-store.ts). Used by
 * apps/worker's money seam (both the policy gate and the actual charge
 * call) to independently re-verify a mandate the agent claims to be
 * drawing against — never trusting the job payload alone.
 *
 * Read-only by design: this store never writes. Registration, activation,
 * and revocation are all owned by control-plane-api's
 * RecurringMandateProvisioner.
 */
import type { Environment } from "@counter/domain";
import type { TransactionalDatabase } from "./database.js";

export interface RecurringMandateReadResult {
  readonly status: "pending" | "active" | "revoked" | "cancelled";
  readonly validUntilMs: number;
  readonly ceilingMinor: bigint;
  readonly eligibleMerchants: readonly string[];
  readonly providerCustomerId: string;
  readonly providerTokenId: string | null;
}

interface MandateRow {
  status: "pending" | "active" | "revoked" | "cancelled";
  valid_until: Date;
  ceiling_minor: string;
  eligible_merchants: readonly string[];
  provider_customer_id: string;
  provider_token_id: string | null;
}

export class PostgresRecurringMandateReadStore {
  constructor(
    private readonly database: TransactionalDatabase,
    private readonly environment: Environment,
  ) {}

  async findByReferenceId(referenceId: string): Promise<RecurringMandateReadResult | undefined> {
    const result = await this.database.query<MandateRow>(
      `SELECT status, valid_until, ceiling_minor, eligible_merchants,
              provider_customer_id, provider_token_id
         FROM wallet.recurring_payment_mandates
        WHERE environment = $1 AND reference_id = $2`,
      [this.environment, referenceId],
    );
    const row = result.rows[0];
    if (row === undefined) {
      return undefined;
    }
    return {
      status: row.status,
      validUntilMs: row.valid_until.getTime(),
      ceilingMinor: BigInt(row.ceiling_minor),
      eligibleMerchants: row.eligible_merchants,
      providerCustomerId: row.provider_customer_id,
      providerTokenId: row.provider_token_id,
    };
  }
}
