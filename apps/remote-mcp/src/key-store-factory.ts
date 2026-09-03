/**
 * Per-session signing-key custody for the remote MCP transport.
 *
 * apps/local-mcp runs as ONE process for ONE buyer, so it can hold a single
 * FileSecureKeyStore for the whole process lifetime. This server holds
 * sessions for MANY buyers at once, so "which buyer's key" has to be resolved
 * per authenticated session — and the resolution must be a hard boundary, not
 * a convention.
 *
 * VaultSecureKeyStore is constructed with a fixed `tenantId` and refuses to
 * sign, describe or revoke any key that the durable ownership index
 * (wallet.vault_keys, migration 0023) does not record as belonging to that
 * tenant. So the tenant binding happens ONCE, here, from the verified JWT's
 * own wallet scope — a session can never be talked into signing with another
 * wallet's key, even given its exact key id.
 *
 * The factory is a port rather than a direct construction so the /mcp route's
 * tests can inject a fake and still exercise the real gating logic.
 */
import { VaultSecureKeyStore, type SecureKeyStore } from "@counter/wallet-domain";
import { PostgresVaultKeyRepository, type TransactionalDatabase } from "@counter/data";
import type { Environment } from "@counter/domain";

export interface WalletKeyStoreRequest {
  readonly walletId: string;
  readonly environment: Environment;
}

export interface WalletKeyStoreFactory {
  create(request: WalletKeyStoreRequest): SecureKeyStore;
}

export interface VaultKeyStoreFactoryOptions {
  readonly vaultAddr: string;
  readonly vaultToken: string;
  readonly database: TransactionalDatabase;
}

export function createVaultKeyStoreFactory(
  options: VaultKeyStoreFactoryOptions,
): WalletKeyStoreFactory {
  return {
    create(request: WalletKeyStoreRequest): SecureKeyStore {
      return new VaultSecureKeyStore({
        vaultAddr: options.vaultAddr,
        vaultToken: options.vaultToken,
        // The ONLY tenant this store may ever act for, taken from the
        // verified token's wallet scope — never from anything the caller
        // supplies in a request body.
        tenantId: request.walletId,
        repository: new PostgresVaultKeyRepository(options.database, request.environment),
      });
    },
  };
}
