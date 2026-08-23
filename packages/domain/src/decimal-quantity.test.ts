import { describe, expect, it } from "vitest";
import fc from "fast-check";
import {
  addDecimalQuantities,
  compareDecimalQuantities,
  createDecimalQuantity,
  decimalQuantityFromJson,
  decimalQuantityToJson,
  subtractDecimalQuantities,
  type DecimalQuantity,
  type Result,
} from "./index.js";

const QUANTITY_SCALE = 18;
const MAX_QUANTITY_COEFFICIENT = 10n ** 38n - 1n;

function unwrap<Value>(result: Result<Value>): Value {
  if (!result.ok) {
    throw new Error(`${result.error.code}: ${result.error.message}`);
  }
  return result.value;
}

function canonicalDecimal(coefficient: bigint, scale: number): string {
  if (coefficient === 0n) {
    return "0";
  }

  let normalized = coefficient;
  let normalizedScale = scale;
  while (normalizedScale > 0 && normalized % 10n === 0n) {
    normalized /= 10n;
    normalizedScale -= 1;
  }

  const digits = normalized.toString(10);
  if (normalizedScale === 0) {
    return digits;
  }
  if (digits.length <= normalizedScale) {
    return `0.${"0".repeat(normalizedScale - digits.length)}${digits}`;
  }
  return `${digits.slice(0, digits.length - normalizedScale)}.${digits.slice(
    digits.length - normalizedScale,
  )}`;
}

const fullCoefficient = fc.bigInt({ min: 0n, max: MAX_QUANTITY_COEFFICIENT });
const fullQuantityValue = fullCoefficient.map((coefficient) =>
  canonicalDecimal(coefficient, QUANTITY_SCALE),
);
const unit = fc.constantFrom("each", "kg", "mL");

describe("DecimalQuantity", () => {
  it("round-trips the full numeric(38,18) domain and explicit units", () => {
    fc.assert(
      fc.property(fullQuantityValue, unit, (value, quantityUnit) => {
        const quantity = unwrap(createDecimalQuantity(value, quantityUnit));
        const json = decimalQuantityToJson(quantity);
        const reparsed = unwrap(decimalQuantityFromJson(JSON.parse(JSON.stringify(json))));

        expect(reparsed).toEqual(quantity);
      }),
    );
  });

  it("matches the coefficient model for full-range addition and overflow", () => {
    fc.assert(
      fc.property(fullCoefficient, fullCoefficient, (leftCoefficient, rightCoefficient) => {
        const left = unwrap(
          createDecimalQuantity(canonicalDecimal(leftCoefficient, QUANTITY_SCALE), "each"),
        );
        const right = unwrap(
          createDecimalQuantity(canonicalDecimal(rightCoefficient, QUANTITY_SCALE), "each"),
        );
        const expectedCoefficient = leftCoefficient + rightCoefficient;
        const result = addDecimalQuantities(left, right);
        const reverse = addDecimalQuantities(right, left);

        expect(result.ok).toBe(reverse.ok);
        if (expectedCoefficient <= MAX_QUANTITY_COEFFICIENT) {
          expect(unwrap(result).value).toBe(canonicalDecimal(expectedCoefficient, QUANTITY_SCALE));
          expect(unwrap(reverse)).toEqual(unwrap(result));
        } else {
          expect(result).toMatchObject({ ok: false, error: { code: "OVERFLOW" } });
        }
      }),
    );
  });

  it("matches the coefficient model for subtraction and comparison", () => {
    fc.assert(
      fc.property(fullCoefficient, fullCoefficient, (leftCoefficient, rightCoefficient) => {
        const left = unwrap(
          createDecimalQuantity(canonicalDecimal(leftCoefficient, QUANTITY_SCALE), "kg"),
        );
        const right = unwrap(
          createDecimalQuantity(canonicalDecimal(rightCoefficient, QUANTITY_SCALE), "kg"),
        );
        const expectedComparison =
          leftCoefficient < rightCoefficient ? -1 : leftCoefficient > rightCoefficient ? 1 : 0;

        expect(unwrap(compareDecimalQuantities(left, right))).toBe(expectedComparison);
        const difference = subtractDecimalQuantities(left, right);
        if (leftCoefficient >= rightCoefficient) {
          expect(unwrap(difference).value).toBe(
            canonicalDecimal(leftCoefficient - rightCoefficient, QUANTITY_SCALE),
          );
        } else {
          expect(difference).toMatchObject({ ok: false, error: { code: "OUT_OF_RANGE" } });
        }
      }),
    );
  });

  it("adds exactly without binary floating-point drift", () => {
    const oneTenth = unwrap(createDecimalQuantity("0.1", "kg"));
    const twoTenths = unwrap(createDecimalQuantity("0.2", "kg"));

    expect(unwrap(addDecimalQuantities(oneTenth, twoTenths)).value).toBe("0.3");
  });

  it("rejects unit mismatches for every arithmetic operation", () => {
    const kilograms = unwrap(createDecimalQuantity("1", "kg"));
    const each = unwrap(createDecimalQuantity("1", "each"));

    for (const result of [
      addDecimalQuantities(kilograms, each),
      subtractDecimalQuantities(kilograms, each),
      compareDecimalQuantities(kilograms, each),
    ]) {
      expect(result.ok).toBe(false);
      if (!result.ok) {
        expect(result.error.code).toBe("UNIT_MISMATCH");
      }
    }
  });

  it("rejects exact range overflow and negative subtraction", () => {
    const maximum = unwrap(
      createDecimalQuantity(canonicalDecimal(MAX_QUANTITY_COEFFICIENT, 18), "kg"),
    );
    const smallest = unwrap(createDecimalQuantity("0.000000000000000001", "kg"));

    expect(addDecimalQuantities(maximum, smallest)).toMatchObject({
      ok: false,
      error: { code: "OVERFLOW" },
    });
    expect(subtractDecimalQuantities(smallest, maximum)).toMatchObject({
      ok: false,
      error: { code: "OUT_OF_RANGE" },
    });
  });

  it.each([
    "-1",
    "+1",
    "01",
    "1.0",
    "0.0",
    ".1",
    "1.",
    "1e3",
    "NaN",
    "Infinity",
    "0.0000000000000000001",
    "100000000000000000000",
  ])("rejects non-canonical or out-of-range decimal %s", (value) => {
    expect(createDecimalQuantity(value, "each").ok).toBe(false);
  });

  it("creates immutable values", () => {
    const quantity: DecimalQuantity = unwrap(createDecimalQuantity("1.5", "kg"));
    expect(Object.isFrozen(quantity)).toBe(true);
  });
});
