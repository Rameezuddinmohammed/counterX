/**
 * Hackathon-scoped merchant onboarding: "where do I receive crypto
 * payments." A merchant records ONE Solana devnet address; this store
 * checks that the address is *well-formed* before persisting it.
 *
 * VERIFIED VS. MERELY ACCEPTED, stated plainly: this proves the address
 * decodes as a structurally valid Solana address (base58, no 0/O/I/l
 * characters, decodes to exactly 32 bytes) — it does NOT prove the address
 * exists on-chain, is funded, or is owned by whoever entered it. There is
 * no Solana connector package in this repo to verify against yet (this task
 * was explicitly scoped to not build one — see migration
 * 0025-merchant-wallet-connections.up.sql's header for the full
 * disclosure). Live on-chain verification is real, tracked follow-up work,
 * not attempted here.
 *
 * SECURITY: `address` is a Solana RECEIVING address — a public value, safe
 * to store in this simple form. This store never accepts, stores, or logs
 * a private key, seed phrase, or signing credential. Unlike
 * merchant-payment-connection-store.ts's key_secret (a real, live
 * credential), there is no "encryption at rest" concern here because there
 * is no secret to protect.
 *
 * Writes go straight through parameterized SQL rather than the RBAC-gated
 * PostgresIdentityRepositories, matching every other store in this app —
 * see wallet-user-store.ts's header for the full rationale.
 */
import type { Environment } from "@counter/domain";
import type { TransactionalDatabase } from "@counter/data";

export type SolanaChain = "solana-devnet";

export interface WalletConnectionInput {
  readonly chain: SolanaChain;
  readonly address: string;
}

export interface WalletConnectionStatus {
  readonly connected: boolean;
  readonly chain?: SolanaChain;
  readonly address?: string;
  readonly connectedAt?: string;
}

/** A client-caused failure (malformed address, unsupported chain) — maps to 400. */
export class WalletConnectionError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "WalletConnectionError";
  }
}

/**
 * Structural interface for MerchantWalletConnectionStore's public surface —
 * lets routes (and tests) depend on the interface rather than the concrete
 * direct-SQL class, matching MerchantPaymentConnectionStoreLike's existing
 * separation in this app.
 */
export interface MerchantWalletConnectionStoreLike {
  /** Throws WalletConnectionError if the address is malformed, or the merchant doesn't exist. */
  connect(merchantId: string, input: WalletConnectionInput): Promise<WalletConnectionStatus>;
  getConnection(merchantId: string): Promise<WalletConnectionStatus>;
}

const SOLANA_ADDRESS_BYTE_LENGTH = 32;
const BASE58_ALPHABET = "123456789ABCDEFGHJKLMNPQRSTUVWXYZabcdefghijkmnopqrstuvwxyz";

/**
 * Minimal, hand-rolled base58 decoder (no new dependency added — this repo's
 * lockfile has no bs58/base58 package installed, confirmed by grepping
 * pnpm-lock.yaml before writing this). Standard leading-zero / big-number
 * decode algorithm: each input character multiplies the accumulator by 58
 * and adds the character's alphabet index; a run of leading '1' characters
 * (base58's representation of a leading zero byte) becomes that many
 * leading 0x00 bytes in the output.
 *
 * Returns undefined for any input containing a character outside the
 * base58 alphabet (which — by construction — excludes 0, O, I, and l, the
 * four characters base58 deliberately omits to avoid visual ambiguity).
 */
function decodeBase58(input: string): Uint8Array | undefined {
  if (input.length === 0) {
    return undefined;
  }

  const alphabetIndex = new Map<string, number>();
  for (let i = 0; i < BASE58_ALPHABET.length; i += 1) {
    alphabetIndex.set(BASE58_ALPHABET[i]!, i);
  }

  const bytes: number[] = [0];
  for (const char of input) {
    const value = alphabetIndex.get(char);
    if (value === undefined) {
      return undefined;
    }
    let carry = value;
    for (let j = 0; j < bytes.length; j += 1) {
      carry += bytes[j]! * 58;
      bytes[j] = carry & 0xff;
      carry >>= 8;
    }
    while (carry > 0) {
      bytes.push(carry & 0xff);
      carry >>= 8;
    }
  }

  // Each leading '1' in the input encodes one leading zero byte. The main
  // loop above already contributes one zero byte for an all-'1' input (its
  // `bytes = [0]` initializer never grows when every character decodes to
  // value 0), so this stops one character short of the full leading-'1'
  // run — otherwise an address of N leading '1's would decode to N+1 bytes
  // instead of N. (Verified against known 32-byte Solana addresses, not
  // just reasoned about — see merchant-wallet-connection-store.test.ts.)
  for (let i = 0; i < input.length - 1 && input[i] === "1"; i += 1) {
    bytes.push(0);
  }

  return new Uint8Array(bytes.reverse());
}

/**
 * A Solana address is structurally valid when it is non-empty base58 and
 * decodes to exactly 32 bytes (an ed25519 public key's length). This is a
 * FORMAT check only — see this file's header for what it does not prove.
 */
function isWellFormedSolanaAddress(address: string): boolean {
  const decoded = decodeBase58(address);
  return decoded !== undefined && decoded.length === SOLANA_ADDRESS_BYTE_LENGTH;
}

export class MerchantWalletConnectionStore implements MerchantWalletConnectionStoreLike {
  constructor(
    private readonly database: TransactionalDatabase,
    private readonly environment: Environment,
  ) {}

  async connect(
    merchantId: string,
    input: WalletConnectionInput,
  ): Promise<WalletConnectionStatus> {
    if (input.address.trim().length === 0) {
      throw new WalletConnectionError("address must not be empty");
    }
    if (input.chain !== "solana-devnet") {
      throw new WalletConnectionError("chain must be 'solana-devnet'");
    }
    if (!isWellFormedSolanaAddress(input.address.trim())) {
      throw new WalletConnectionError(
        "address is not a well-formed Solana address (expected base58, decoding to 32 bytes)",
      );
    }

    const merchantExists = await this.database.query(
      `SELECT 1 FROM merchant.scopes WHERE environment = $1 AND merchant_id = $2`,
      [this.environment, merchantId],
    );
    if (merchantExists.rows.length === 0) {
      throw new WalletConnectionError(`No such merchant: ${merchantId}`);
    }

    const now = new Date().toISOString();
    const address = input.address.trim();
    await this.database.query(
      `INSERT INTO merchant.wallet_connections
         (environment, merchant_id, chain, address, created_at, updated_at)
       VALUES ($1, $2, $3, $4, $5, $5)
       ON CONFLICT (environment, merchant_id) DO UPDATE
         SET chain = EXCLUDED.chain,
             address = EXCLUDED.address,
             updated_at = EXCLUDED.updated_at`,
      [this.environment, merchantId, input.chain, address, now],
    );

    return { connected: true, chain: input.chain, address, connectedAt: now };
  }

  async getConnection(merchantId: string): Promise<WalletConnectionStatus> {
    const result = await this.database.query<{
      chain: SolanaChain;
      address: string;
      updated_at: string | Date;
    }>(
      `SELECT chain, address, updated_at FROM merchant.wallet_connections
        WHERE environment = $1 AND merchant_id = $2`,
      [this.environment, merchantId],
    );
    const row = result.rows[0];
    if (row === undefined) {
      return { connected: false };
    }
    return {
      connected: true,
      chain: row.chain,
      address: row.address,
      connectedAt: new Date(row.updated_at).toISOString(),
    };
  }
}
