/**
 * Durable, Postgres-backed MandateRepository
 * (packages/wallet-domain/src/mandate.ts's port) — backs both the wallet/
 * agent mandate cascade in WalletRevocationService's #cascadeRevocation AND
 * the real write path: apps/control-plane-api/src/mandate-binding-store.ts's
 * MandateBindingService.bind() durably persists a WalletMandate here once
 * it has verified a client-signed counter.mandate.v1 envelope against an
 * active, human-authorized Razorpay recurring mandate. Also consumed
 * read-side by apps/agent-runtime's checkMandateAuthority before a
 * transaction.lifecycle job is ever enqueued, and by apps/worker's
 * durable revocation re-check before the external payment effect.
 */
import type { CounterId, Environment } from "@counter/domain";
import type { MandateRepository, MandateStatus, WalletMandate } from "@counter/wallet-domain";
import type { BuyerPolicyConstraints } from "@counter/wallet-domain";
import type { TransactionalDatabase } from "./database.js";

/**
 * The wire shape of BuyerPolicyConstraints as it round-trips through the
 * jsonb `constraints` column: the four bigint minor-unit fields (see
 * bigintSafeReplacer) come back as JSON strings, not bigints — pg parses
 * jsonb into plain JS values, and JSON has no bigint type.
 */
interface StoredBuyerPolicyConstraints
  extends Omit<BuyerPolicyConstraints, "amountLimits" | "approvalThreshold"> {
  readonly amountLimits: Omit<
    BuyerPolicyConstraints["amountLimits"],
    "perTransactionMaxPaise" | "rollingMaxPaise" | "aggregateMaxPaise"
  > & {
    readonly perTransactionMaxPaise: string;
    readonly rollingMaxPaise?: string | undefined;
    readonly aggregateMaxPaise?: string | undefined;
  };
  readonly approvalThreshold: { readonly thresholdPaise: string };
}

/** JSON.stringify replacer for constraints, which carries bigint minor-unit fields. */
function bigintSafeReplacer(_key: string, value: unknown): unknown {
  return typeof value === "bigint" ? value.toString() : value;
}

/** Reverses bigintSafeReplacer: restores the bigint minor-unit fields after jsonb round-trip. */
function toConstraints(stored: StoredBuyerPolicyConstraints): BuyerPolicyConstraints {
  return {
    ...stored,
    amountLimits: {
      rollingPeriodMs: stored.amountLimits.rollingPeriodMs,
      perTransactionMaxPaise: BigInt(stored.amountLimits.perTransactionMaxPaise),
      rollingMaxPaise:
        stored.amountLimits.rollingMaxPaise !== undefined
          ? BigInt(stored.amountLimits.rollingMaxPaise)
          : undefined,
      aggregateMaxPaise:
        stored.amountLimits.aggregateMaxPaise !== undefined
          ? BigInt(stored.amountLimits.aggregateMaxPaise)
          : undefined,
    },
    approvalThreshold: {
      thresholdPaise: BigInt(stored.approvalThreshold.thresholdPaise),
    },
  };
}

interface MandateRow {
  mandate_id: string;
  wallet_id: string;
  principal_id: string;
  agent_id: string;
  kid: string;
  constraints: StoredBuyerPolicyConstraints;
  payment_reference_id: string;
  valid_from: Date;
  valid_until: Date;
  issued_at: Date;
  consent_attestation_digest: string;
  status: MandateStatus;
  revocation_locator: string;
  policy_version_id: string;
}

const MANDATE_ROW_COLUMNS = `mandate_id, wallet_id, principal_id, agent_id, kid, constraints,
       payment_reference_id, valid_from, valid_until, issued_at,
       consent_attestation_digest, status, revocation_locator, policy_version_id`;

function toMandate(row: MandateRow): WalletMandate {
  return {
    mandateId: row.mandate_id as CounterId<"mandate">,
    walletId: row.wallet_id as CounterId<"wallet">,
    principalId: row.principal_id as CounterId<"actor">,
    agentId: row.agent_id as CounterId<"agent">,
    kid: row.kid,
    constraints: toConstraints(row.constraints),
    paymentReferenceId: row.payment_reference_id,
    validFrom: row.valid_from.toISOString(),
    validUntil: row.valid_until.toISOString(),
    issuedAt: row.issued_at.toISOString(),
    consentAttestationDigest: row.consent_attestation_digest,
    status: row.status,
    revocationLocator: row.revocation_locator,
    policyVersionId: row.policy_version_id,
  };
}

export class PostgresMandateRepository implements MandateRepository {
  constructor(
    private readonly database: TransactionalDatabase,
    private readonly environment: Environment,
  ) {}

  async findById(mandateId: CounterId<"mandate">): Promise<WalletMandate | undefined> {
    const result = await this.database.query<MandateRow>(
      `SELECT ${MANDATE_ROW_COLUMNS} FROM wallet.mandates
        WHERE environment = $1 AND mandate_id = $2`,
      [this.environment, mandateId],
    );
    const row = result.rows[0];
    return row === undefined ? undefined : toMandate(row);
  }

  async findByWallet(walletId: CounterId<"wallet">): Promise<readonly WalletMandate[]> {
    const result = await this.database.query<MandateRow>(
      `SELECT ${MANDATE_ROW_COLUMNS} FROM wallet.mandates
        WHERE environment = $1 AND wallet_id = $2
        ORDER BY issued_at ASC`,
      [this.environment, walletId],
    );
    return result.rows.map(toMandate);
  }

  async findByAgent(agentId: CounterId<"agent">): Promise<readonly WalletMandate[]> {
    const result = await this.database.query<MandateRow>(
      `SELECT ${MANDATE_ROW_COLUMNS} FROM wallet.mandates
        WHERE environment = $1 AND agent_id = $2
        ORDER BY issued_at ASC`,
      [this.environment, agentId],
    );
    return result.rows.map(toMandate);
  }

  async findActive(walletId: CounterId<"wallet">): Promise<readonly WalletMandate[]> {
    const result = await this.database.query<MandateRow>(
      `SELECT ${MANDATE_ROW_COLUMNS} FROM wallet.mandates
        WHERE environment = $1 AND wallet_id = $2 AND status = 'active'
        ORDER BY issued_at ASC`,
      [this.environment, walletId],
    );
    return result.rows.map(toMandate);
  }

  async findByPaymentReference(paymentReferenceId: string): Promise<readonly WalletMandate[]> {
    const result = await this.database.query<MandateRow>(
      `SELECT ${MANDATE_ROW_COLUMNS} FROM wallet.mandates
        WHERE environment = $1 AND payment_reference_id = $2
        ORDER BY issued_at ASC`,
      [this.environment, paymentReferenceId],
    );
    return result.rows.map(toMandate);
  }

  async save(mandate: WalletMandate): Promise<void> {
    await this.database.query(
      `INSERT INTO wallet.mandates
         (environment, mandate_id, wallet_id, principal_id, agent_id, kid, constraints,
          payment_reference_id, valid_from, valid_until, issued_at,
          consent_attestation_digest, status, revocation_locator, policy_version_id,
          created_at, updated_at)
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, $14, $15, $16, $16)
       ON CONFLICT (environment, mandate_id) DO UPDATE
         SET status = EXCLUDED.status,
             updated_at = EXCLUDED.updated_at`,
      [
        this.environment,
        mandate.mandateId,
        mandate.walletId,
        mandate.principalId,
        mandate.agentId,
        mandate.kid,
        JSON.stringify(mandate.constraints, bigintSafeReplacer),
        mandate.paymentReferenceId,
        mandate.validFrom,
        mandate.validUntil,
        mandate.issuedAt,
        mandate.consentAttestationDigest,
        mandate.status,
        mandate.revocationLocator,
        mandate.policyVersionId,
        new Date().toISOString(),
      ],
    );
  }

  async updateStatus(mandateId: CounterId<"mandate">, status: MandateStatus): Promise<void> {
    await this.database.query(
      `UPDATE wallet.mandates SET status = $1, updated_at = $2
        WHERE environment = $3 AND mandate_id = $4`,
      [status, new Date().toISOString(), this.environment, mandateId],
    );
  }
}
