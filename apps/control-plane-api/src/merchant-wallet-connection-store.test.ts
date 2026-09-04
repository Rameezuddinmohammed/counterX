import { describe, expect, it } from "vitest";
import {
  MerchantWalletConnectionStore,
  WalletConnectionError,
} from "./merchant-wallet-connection-store.js";

const TEST_MERCHANT_ID = "ctr_merchant_AAAAAAAAAAAAAAAAAAAAAA";

// A real, well-formed Solana devnet address (base58, decodes to 32 bytes) —
// the well-known System Program id, chosen because it's public and
// unambiguous, not because it's owned by anyone relevant to this test.
const VALID_SOLANA_ADDRESS = "11111111111111111111111111111111";

function unreachableDatabase() {
  return {
    query: () => {
      throw new Error("query() should not be called — validation must short-circuit first");
    },
    transaction: () => {
      throw new Error("transaction() should not be called");
    },
  };
}

/** A minimal in-memory fake covering exactly the queries this store issues. */
class FakeDatabase {
  merchantExists = true;
  rows: Array<{ chain: string; address: string; updated_at: string }> = [];
  insertCalls = 0;

  async query(text: string, values?: readonly unknown[]) {
    if (text.includes("SELECT 1 FROM merchant.scopes")) {
      return { rows: this.merchantExists ? [{ "?column?": 1 }] : [] };
    }
    if (text.includes("INSERT INTO merchant.wallet_connections")) {
      this.insertCalls += 1;
      const chain = values?.[2] as string;
      const address = values?.[3] as string;
      const updatedAt = values?.[4] as string;
      this.rows = [{ chain, address, updated_at: updatedAt }];
      return { rows: [] };
    }
    if (text.includes("SELECT chain, address, updated_at FROM merchant.wallet_connections")) {
      return { rows: this.rows };
    }
    throw new Error(`Unexpected query in FakeDatabase: ${text}`);
  }

  transaction(): never {
    throw new Error("transaction() should not be called by this store");
  }
}

describe("MerchantWalletConnectionStore", () => {
  it("rejects an empty address before touching the database", async () => {
    const store = new MerchantWalletConnectionStore(unreachableDatabase() as never, "test");
    await expect(
      store.connect(TEST_MERCHANT_ID, { chain: "solana-devnet", address: "" }),
    ).rejects.toThrow(WalletConnectionError);
  });

  it("rejects a malformed (non-base58) address before touching the database", async () => {
    const store = new MerchantWalletConnectionStore(unreachableDatabase() as never, "test");
    await expect(
      store.connect(TEST_MERCHANT_ID, { chain: "solana-devnet", address: "not-base58-0OIl" }),
    ).rejects.toThrow(WalletConnectionError);
  });

  it("rejects a base58 string that doesn't decode to 32 bytes", async () => {
    const store = new MerchantWalletConnectionStore(unreachableDatabase() as never, "test");
    // Valid base58 alphabet, but far too short to decode to 32 bytes.
    await expect(
      store.connect(TEST_MERCHANT_ID, { chain: "solana-devnet", address: "abc" }),
    ).rejects.toThrow(/well-formed/);
  });

  it("rejects an unsupported chain before touching the database", async () => {
    const store = new MerchantWalletConnectionStore(unreachableDatabase() as never, "test");
    await expect(
      store.connect(TEST_MERCHANT_ID, {
        // @ts-expect-error deliberately testing an unsupported chain value
        chain: "ethereum-mainnet",
        address: VALID_SOLANA_ADDRESS,
      }),
    ).rejects.toThrow(WalletConnectionError);
  });

  it("rejects a nonexistent merchant", async () => {
    const database = new FakeDatabase();
    database.merchantExists = false;
    const store = new MerchantWalletConnectionStore(database as never, "test");
    await expect(
      store.connect(TEST_MERCHANT_ID, { chain: "solana-devnet", address: VALID_SOLANA_ADDRESS }),
    ).rejects.toThrow(/No such merchant/);
    expect(database.insertCalls).toBe(0);
  });

  it("persists a well-formed address and reports connected", async () => {
    const database = new FakeDatabase();
    const store = new MerchantWalletConnectionStore(database as never, "test");
    const result = await store.connect(TEST_MERCHANT_ID, {
      chain: "solana-devnet",
      address: VALID_SOLANA_ADDRESS,
    });
    expect(result.connected).toBe(true);
    expect(result.address).toBe(VALID_SOLANA_ADDRESS);
    expect(result.chain).toBe("solana-devnet");
    expect(database.insertCalls).toBe(1);

    const status = await store.getConnection(TEST_MERCHANT_ID);
    expect(status.connected).toBe(true);
    expect(status.address).toBe(VALID_SOLANA_ADDRESS);
  });

  it("reports disconnected for a merchant with no stored connection", async () => {
    const database = new FakeDatabase();
    const store = new MerchantWalletConnectionStore(database as never, "test");
    const status = await store.getConnection(TEST_MERCHANT_ID);
    expect(status.connected).toBe(false);
  });
});
