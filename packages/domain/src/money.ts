import { parseIsoCurrencyCode, type IsoCurrencyCode } from "./currency.js";
import { createCanonicalError } from "./errors.js";
import { err, ok, type Result } from "./result.js";

export const MIN_MONEY_AMOUNT_MINOR = -(1n << 63n);
export const MAX_MONEY_AMOUNT_MINOR = (1n << 63n) - 1n;

const canonicalIntegerPattern = /^(?:0|[1-9]\d*|-[1-9]\d*)$/u;

export interface Money {
  readonly amountMinor: bigint;
  readonly currency: IsoCurrencyCode;
}

export interface MoneyJson {
  readonly amountMinor: string;
  readonly currency: string;
}

function amountInRange(amountMinor: bigint): boolean {
  return amountMinor >= MIN_MONEY_AMOUNT_MINOR && amountMinor <= MAX_MONEY_AMOUNT_MINOR;
}

function moneyValue(amountMinor: bigint, currency: IsoCurrencyCode): Money {
  return Object.freeze({ amountMinor, currency });
}

function currencyMismatch(left: Money, right: Money): Result<never> {
  return err(
    createCanonicalError({
      category: "validation",
      code: "CURRENCY_MISMATCH",
      message: "Money arithmetic requires matching currencies",
      details: { leftCurrency: left.currency, rightCurrency: right.currency },
    }),
  );
}

function arithmeticResult(amountMinor: bigint, currency: IsoCurrencyCode): Result<Money> {
  if (!amountInRange(amountMinor)) {
    return err(
      createCanonicalError({
        category: "validation",
        code: "OVERFLOW",
        message: "Money arithmetic exceeds the signed 64-bit minor-unit range",
      }),
    );
  }
  return ok(moneyValue(amountMinor, currency));
}

export function createMoney(amountMinor: unknown, currency: unknown): Result<Money> {
  if (typeof amountMinor !== "bigint") {
    return err(
      createCanonicalError({
        category: "validation",
        code: "INVALID_TYPE",
        message: "Money amountMinor must be a bigint",
        details: { field: "amountMinor" },
      }),
    );
  }
  if (!amountInRange(amountMinor)) {
    return err(
      createCanonicalError({
        category: "validation",
        code: "OUT_OF_RANGE",
        message: "Money amountMinor must fit the signed 64-bit minor-unit range",
        details: { field: "amountMinor" },
      }),
    );
  }

  const parsedCurrency = parseIsoCurrencyCode(currency);
  if (!parsedCurrency.ok) {
    return parsedCurrency;
  }

  return ok(moneyValue(amountMinor, parsedCurrency.value));
}

export function moneyFromJson(value: unknown): Result<Money> {
  if (typeof value !== "object" || value === null || Array.isArray(value)) {
    return err(
      createCanonicalError({
        category: "validation",
        code: "INVALID_TYPE",
        message: "Money JSON must be an object",
        details: { field: "money" },
      }),
    );
  }

  const record = value as Readonly<Record<string, unknown>>;
  const keys = Object.keys(record);
  if (
    keys.length !== 2 ||
    !Object.prototype.hasOwnProperty.call(record, "amountMinor") ||
    !Object.prototype.hasOwnProperty.call(record, "currency")
  ) {
    return err(
      createCanonicalError({
        category: "validation",
        code: "INVALID_FORMAT",
        message: "Money JSON must contain only amountMinor and currency",
        details: { field: "money" },
      }),
    );
  }

  const rawAmount = record["amountMinor"];
  if (typeof rawAmount !== "string" || !canonicalIntegerPattern.test(rawAmount)) {
    return err(
      createCanonicalError({
        category: "validation",
        code: "INVALID_FORMAT",
        message: "Money amountMinor must be a canonical base-10 integer string",
        details: { field: "amountMinor" },
      }),
    );
  }

  return createMoney(BigInt(rawAmount), record["currency"]);
}

export function moneyToJson(money: Money): MoneyJson {
  return { amountMinor: money.amountMinor.toString(10), currency: money.currency };
}

export function addMoney(left: Money, right: Money): Result<Money> {
  if (left.currency !== right.currency) {
    return currencyMismatch(left, right);
  }
  return arithmeticResult(left.amountMinor + right.amountMinor, left.currency);
}

export function subtractMoney(left: Money, right: Money): Result<Money> {
  if (left.currency !== right.currency) {
    return currencyMismatch(left, right);
  }
  return arithmeticResult(left.amountMinor - right.amountMinor, left.currency);
}

export function compareMoney(left: Money, right: Money): Result<-1 | 0 | 1> {
  if (left.currency !== right.currency) {
    return currencyMismatch(left, right);
  }
  return ok(
    left.amountMinor < right.amountMinor ? -1 : left.amountMinor > right.amountMinor ? 1 : 0,
  );
}

export function moneyEquals(left: Money, right: Money): boolean {
  return left.currency === right.currency && left.amountMinor === right.amountMinor;
}
