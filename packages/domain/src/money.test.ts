import { describe, expect, it } from "vitest";
import fc from "fast-check";
import {
  MAX_MONEY_AMOUNT_MINOR,
  MIN_MONEY_AMOUNT_MINOR,
  addMoney,
  compareMoney,
  createMoney,
  moneyFromJson,
  moneyToJson,
  subtractMoney,
  type Money,
  type Result,
} from "./index.js";

function unwrap<Value>(result: Result<Value>): Value {
  if (!result.ok) {
    throw new Error(`${result.error.code}: ${result.error.message}`);
  }
  return result.value;
}

function isMoneyAmount(amount: bigint): boolean {
  return amount >= MIN_MONEY_AMOUNT_MINOR && amount <= MAX_MONEY_AMOUNT_MINOR;
}

const fullAmount = fc.bigInt({ min: MIN_MONEY_AMOUNT_MINOR, max: MAX_MONEY_AMOUNT_MINOR });
const currency = fc.constantFrom("INR", "USD", "EUR", "JPY");

describe("Money", () => {
  it("round-trips the full signed-int64 domain without JSON numbers", () => {
    fc.assert(
      fc.property(fullAmount, currency, (amountMinor, currencyCode) => {
        const money = unwrap(createMoney(amountMinor, currencyCode));
        const json = moneyToJson(money);
        const reparsed = unwrap(moneyFromJson(JSON.parse(JSON.stringify(json))));

        expect(typeof json.amountMinor).toBe("string");
        expect(reparsed).toEqual(money);
      }),
    );
  });

  it("matches the bigint model for full-range addition and overflow", () => {
    fc.assert(
      fc.property(fullAmount, fullAmount, currency, (leftAmount, rightAmount, currencyCode) => {
        const left = unwrap(createMoney(leftAmount, currencyCode));
        const right = unwrap(createMoney(rightAmount, currencyCode));
        const expectedAmount = leftAmount + rightAmount;
        const result = addMoney(left, right);
        const reverse = addMoney(right, left);

        expect(result.ok).toBe(reverse.ok);
        if (isMoneyAmount(expectedAmount)) {
          expect(unwrap(result)).toEqual(unwrap(createMoney(expectedAmount, currencyCode)));
          expect(unwrap(reverse)).toEqual(unwrap(result));
          expect(unwrap(subtractMoney(unwrap(result), right))).toEqual(left);
        } else {
          expect(result.ok).toBe(false);
          if (!result.ok) {
            expect(result.error.code).toBe("OVERFLOW");
          }
        }
      }),
    );
  });

  it("matches the bigint model for full-range subtraction and overflow", () => {
    fc.assert(
      fc.property(fullAmount, fullAmount, currency, (leftAmount, rightAmount, currencyCode) => {
        const left = unwrap(createMoney(leftAmount, currencyCode));
        const right = unwrap(createMoney(rightAmount, currencyCode));
        const expectedAmount = leftAmount - rightAmount;
        const result = subtractMoney(left, right);

        if (isMoneyAmount(expectedAmount)) {
          expect(unwrap(result)).toEqual(unwrap(createMoney(expectedAmount, currencyCode)));
        } else {
          expect(result.ok).toBe(false);
          if (!result.ok) {
            expect(result.error.code).toBe("OVERFLOW");
          }
        }
      }),
    );
  });

  it("orders every same-currency pair by its bigint model", () => {
    fc.assert(
      fc.property(fullAmount, fullAmount, (leftAmount, rightAmount) => {
        const left = unwrap(createMoney(leftAmount, "INR"));
        const right = unwrap(createMoney(rightAmount, "INR"));
        const expected = leftAmount < rightAmount ? -1 : leftAmount > rightAmount ? 1 : 0;

        expect(unwrap(compareMoney(left, right))).toBe(expected);
      }),
    );
  });

  it("rejects every cross-currency arithmetic pair", () => {
    const distinctCurrencies = fc
      .tuple(currency, currency)
      .filter(([leftCurrency, rightCurrency]) => leftCurrency !== rightCurrency);

    fc.assert(
      fc.property(distinctCurrencies, fullAmount, ([leftCurrency, rightCurrency], amount) => {
        const left = unwrap(createMoney(amount, leftCurrency));
        const right = unwrap(createMoney(amount, rightCurrency));

        for (const result of [addMoney(left, right), subtractMoney(left, right)]) {
          expect(result.ok).toBe(false);
          if (!result.ok) {
            expect(result.error.code).toBe("CURRENCY_MISMATCH");
          }
        }
        const comparison = compareMoney(left, right);
        expect(comparison.ok).toBe(false);
        if (!comparison.ok) {
          expect(comparison.error.code).toBe("CURRENCY_MISMATCH");
        }
      }),
    );
  });

  it("rejects both exact signed-int64 boundary overflows", () => {
    const maximum = unwrap(createMoney(MAX_MONEY_AMOUNT_MINOR, "INR"));
    const minimum = unwrap(createMoney(MIN_MONEY_AMOUNT_MINOR, "INR"));
    const one = unwrap(createMoney(1n, "INR"));

    expect(addMoney(maximum, one)).toMatchObject({ ok: false, error: { code: "OVERFLOW" } });
    expect(subtractMoney(minimum, one)).toMatchObject({
      ok: false,
      error: { code: "OVERFLOW" },
    });
  });

  it.each([
    { amountMinor: 1, currency: "INR" },
    { amountMinor: "01", currency: "INR" },
    { amountMinor: "+1", currency: "INR" },
    { amountMinor: "-0", currency: "INR" },
    { amountMinor: "1e3", currency: "INR" },
    { amountMinor: "1", currency: "inr" },
    { amountMinor: "1", currency: "INR", extra: true },
  ])("rejects non-canonical money JSON: %j", (value) => {
    expect(moneyFromJson(value).ok).toBe(false);
  });

  it("creates immutable values", () => {
    const money: Money = unwrap(createMoney(500n, "INR"));
    expect(Object.isFrozen(money)).toBe(true);
  });
});
