import type { Brand } from "./brand.js";
import { createCanonicalError } from "./errors.js";
import { err, ok, type Result } from "./result.js";

export const MAX_QUANTITY_INTEGER_DIGITS = 20;
export const MAX_QUANTITY_SCALE = 18;
export const MAX_QUANTITY_PRECISION = 38;

const canonicalDecimalPattern = /^(0|[1-9]\d*)(?:\.(\d*[1-9]))?$/u;
const quantityUnitPattern = /^[A-Za-z][A-Za-z0-9._/-]{0,31}$/u;

export type QuantityUnit = Brand<string, "QuantityUnit">;

export interface DecimalQuantity {
  readonly value: string;
  readonly unit: QuantityUnit;
}

export interface DecimalQuantityJson {
  readonly value: string;
  readonly unit: string;
}

interface DecimalParts {
  readonly coefficient: bigint;
  readonly scale: number;
}

function parseCanonicalDecimal(value: unknown): Result<DecimalParts> {
  if (typeof value !== "string") {
    return err(
      createCanonicalError({
        category: "validation",
        code: "INVALID_TYPE",
        message: "Quantity value must be a decimal string",
        details: { field: "value" },
      }),
    );
  }

  const match = canonicalDecimalPattern.exec(value);
  const integerPart = match?.[1];
  if (integerPart === undefined) {
    return err(
      createCanonicalError({
        category: "validation",
        code: "INVALID_FORMAT",
        message: "Quantity value must be a canonical non-negative decimal string",
        details: { field: "value" },
      }),
    );
  }

  const fractionalPart = match?.[2] ?? "";
  const integerDigits = integerPart === "0" ? 0 : integerPart.length;
  if (integerDigits > MAX_QUANTITY_INTEGER_DIGITS || fractionalPart.length > MAX_QUANTITY_SCALE) {
    return err(
      createCanonicalError({
        category: "validation",
        code: "OUT_OF_RANGE",
        message: "Quantity exceeds the numeric(38,18) canonical range",
        details: { field: "value" },
      }),
    );
  }

  return ok({
    coefficient: BigInt(`${integerPart}${fractionalPart}`),
    scale: fractionalPart.length,
  });
}

function parseQuantityUnit(value: unknown): Result<QuantityUnit> {
  if (typeof value !== "string" || !quantityUnitPattern.test(value)) {
    return err(
      createCanonicalError({
        category: "validation",
        code: "INVALID_FORMAT",
        message: "Quantity unit must be an explicit canonical unit token",
        details: { field: "unit" },
      }),
    );
  }
  return ok(value as QuantityUnit);
}

function powerOfTen(exponent: number): bigint {
  return 10n ** BigInt(exponent);
}

function canonicalDecimal(coefficient: bigint, scale: number): string {
  if (coefficient === 0n) {
    return "0";
  }

  let normalizedCoefficient = coefficient;
  let normalizedScale = scale;
  while (normalizedScale > 0 && normalizedCoefficient % 10n === 0n) {
    normalizedCoefficient /= 10n;
    normalizedScale -= 1;
  }

  const digits = normalizedCoefficient.toString(10);
  if (normalizedScale === 0) {
    return digits;
  }
  if (digits.length <= normalizedScale) {
    return `0.${"0".repeat(normalizedScale - digits.length)}${digits}`;
  }

  const splitAt = digits.length - normalizedScale;
  return `${digits.slice(0, splitAt)}.${digits.slice(splitAt)}`;
}

function partsOf(quantity: DecimalQuantity): DecimalParts {
  const parsed = parseCanonicalDecimal(quantity.value);
  if (!parsed.ok) {
    throw new TypeError("DecimalQuantity invariant violated");
  }
  return parsed.value;
}

function arithmeticQuantity(
  coefficient: bigint,
  scale: number,
  unit: QuantityUnit,
): Result<DecimalQuantity> {
  const value = canonicalDecimal(coefficient, scale);
  const quantity = createDecimalQuantity(value, unit);
  if (!quantity.ok) {
    return err(
      createCanonicalError({
        category: "validation",
        code: "OVERFLOW",
        message: "Quantity arithmetic exceeds the numeric(38,18) canonical range",
      }),
    );
  }
  return quantity;
}

function alignParts(left: DecimalParts, right: DecimalParts): readonly [bigint, bigint, number] {
  const scale = Math.max(left.scale, right.scale);
  return [
    left.coefficient * powerOfTen(scale - left.scale),
    right.coefficient * powerOfTen(scale - right.scale),
    scale,
  ];
}

function unitMismatch(left: DecimalQuantity, right: DecimalQuantity): Result<never> {
  return err(
    createCanonicalError({
      category: "validation",
      code: "UNIT_MISMATCH",
      message: "Quantity arithmetic requires matching units",
      details: { leftUnit: left.unit, rightUnit: right.unit },
    }),
  );
}

export function createDecimalQuantity(value: unknown, unit: unknown): Result<DecimalQuantity> {
  const parsedDecimal = parseCanonicalDecimal(value);
  if (!parsedDecimal.ok) {
    return parsedDecimal;
  }
  const parsedUnit = parseQuantityUnit(unit);
  if (!parsedUnit.ok) {
    return parsedUnit;
  }

  return ok(Object.freeze({ value: value as string, unit: parsedUnit.value }));
}

export function decimalQuantityFromJson(value: unknown): Result<DecimalQuantity> {
  if (typeof value !== "object" || value === null || Array.isArray(value)) {
    return err(
      createCanonicalError({
        category: "validation",
        code: "INVALID_TYPE",
        message: "Quantity JSON must be an object",
        details: { field: "quantity" },
      }),
    );
  }

  const record = value as Readonly<Record<string, unknown>>;
  const keys = Object.keys(record);
  if (
    keys.length !== 2 ||
    !Object.prototype.hasOwnProperty.call(record, "value") ||
    !Object.prototype.hasOwnProperty.call(record, "unit")
  ) {
    return err(
      createCanonicalError({
        category: "validation",
        code: "INVALID_FORMAT",
        message: "Quantity JSON must contain only value and unit",
        details: { field: "quantity" },
      }),
    );
  }

  return createDecimalQuantity(record["value"], record["unit"]);
}

export function decimalQuantityToJson(quantity: DecimalQuantity): DecimalQuantityJson {
  return { value: quantity.value, unit: quantity.unit };
}

export function addDecimalQuantities(
  left: DecimalQuantity,
  right: DecimalQuantity,
): Result<DecimalQuantity> {
  if (left.unit !== right.unit) {
    return unitMismatch(left, right);
  }
  const [leftCoefficient, rightCoefficient, scale] = alignParts(partsOf(left), partsOf(right));
  return arithmeticQuantity(leftCoefficient + rightCoefficient, scale, left.unit);
}

export function subtractDecimalQuantities(
  left: DecimalQuantity,
  right: DecimalQuantity,
): Result<DecimalQuantity> {
  if (left.unit !== right.unit) {
    return unitMismatch(left, right);
  }
  const [leftCoefficient, rightCoefficient, scale] = alignParts(partsOf(left), partsOf(right));
  if (rightCoefficient > leftCoefficient) {
    return err(
      createCanonicalError({
        category: "validation",
        code: "OUT_OF_RANGE",
        message: "Quantity subtraction cannot produce a negative quantity",
      }),
    );
  }
  return arithmeticQuantity(leftCoefficient - rightCoefficient, scale, left.unit);
}

export function compareDecimalQuantities(
  left: DecimalQuantity,
  right: DecimalQuantity,
): Result<-1 | 0 | 1> {
  if (left.unit !== right.unit) {
    return unitMismatch(left, right);
  }
  const [leftCoefficient, rightCoefficient] = alignParts(partsOf(left), partsOf(right));
  return ok(leftCoefficient < rightCoefficient ? -1 : leftCoefficient > rightCoefficient ? 1 : 0);
}

export function decimalQuantitiesEqual(left: DecimalQuantity, right: DecimalQuantity): boolean {
  return left.unit === right.unit && left.value === right.value;
}
