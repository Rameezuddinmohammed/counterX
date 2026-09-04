/**
 * Guards the real deployed worker entrypoint's DurableStores wiring.
 *
 * main.ts is a self-executing boot script (`main().catch(...)` runs
 * immediately at module scope, no exported testable function, connects to
 * real Postgres/Shopify/Razorpay from the environment) — it cannot be
 * safely `import`ed in a unit test the way boot.ts's `selectPaymentAuthorizationPort`
 * can. selectPaymentAuthorizationPort's OWN unit tests (boot.test.ts,
 * real-lifecycle.test.ts) already prove the walletBalanceStore mechanism
 * works correctly once wired in — they inject a store directly and don't
 * touch main.ts at all, so they can't catch main.ts itself failing to
 * construct and pass one.
 *
 * This test closes exactly that gap: it reads main.ts's own source and
 * asserts the real deployed worker constructs a PostgresWalletBalanceStore
 * and passes it into selectPaymentAuthorizationPort's stores argument —
 * catching a regression where the store exists and is fully wired inside
 * real-lifecycle.ts/boot.ts but the real deployment simply never builds one
 * (exactly the gap this test was added to close after a review caught it
 * missing from the initial implementation).
 */
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, resolve } from "node:path";
import { describe, expect, it } from "vitest";

const mainTsPath = resolve(dirname(fileURLToPath(import.meta.url)), "main.ts");

describe("apps/worker/src/main.ts — DurableStores wiring", () => {
  const source = readFileSync(mainTsPath, "utf8");

  it("imports PostgresWalletBalanceStore from @counter/data", () => {
    expect(source).toMatch(/PostgresWalletBalanceStore/);
  });

  it("constructs a PostgresWalletBalanceStore bound to the real database + runtime environment", () => {
    expect(source).toMatch(
      /new PostgresWalletBalanceStore\(\s*database\s*,\s*runtimeEnvironment\s*\)/,
    );
  });

  it("passes walletBalanceStore into the SAME selectPaymentAuthorizationPort call as the other durable stores", () => {
    const selectionCallStart = source.indexOf("selectPaymentAuthorizationPort(process.env");
    expect(selectionCallStart).toBeGreaterThan(-1);
    const selectionCallEnd = source.indexOf("});", selectionCallStart);
    const selectionCall = source.slice(selectionCallStart, selectionCallEnd);

    // Same call already wires these — proves walletBalanceStore sits
    // alongside them, not off in some other, never-reached construction.
    expect(selectionCall).toMatch(/stepLedger:\s*new PostgresStepLedger/);
    expect(selectionCall).toMatch(/revocationStore:\s*new PostgresRevocationStore/);
    expect(selectionCall).toMatch(
      /walletBalanceStore:\s*new PostgresWalletBalanceStore\(database, runtimeEnvironment\)/,
    );
  });
});
