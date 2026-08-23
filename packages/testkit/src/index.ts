/** Deterministic test-only primitives shared by Counter invariant suites. */

export const PACKAGE_NAME = "@counter/testkit";

export interface MutableTestClock<Value> {
  now(): Value;
  set(value: Value): void;
  advance(updater: (current: Value) => Value): Value;
}

/**
 * Generic by design: when instantiated with domain `Instant`, this class
 * structurally satisfies the domain `Clock` port without a reverse dependency.
 */
export class FixedClock<Value> implements MutableTestClock<Value> {
  #current: Value;

  public constructor(initial: Value) {
    this.#current = initial;
  }

  public now(): Value {
    return this.#current;
  }

  public set(value: Value): void {
    this.#current = value;
  }

  public advance(updater: (current: Value) => Value): Value {
    this.#current = updater(this.#current);
    return this.#current;
  }
}

export type TestRandomByteSource = (length: number) => Uint8Array;

/**
 * Returns reproducible bytes for tests and fixtures. This is intentionally not
 * cryptographically secure and must only be injected into test generators.
 */
export function createDeterministicRandomByteSource(seed = 0): TestRandomByteSource {
  if (!Number.isSafeInteger(seed) || seed < 0) {
    throw new RangeError("Deterministic random seed must be a non-negative safe integer");
  }

  let state = BigInt(seed) & 0xffff_ffff_ffff_ffffn;
  return (length) => {
    if (!Number.isSafeInteger(length) || length < 0) {
      throw new RangeError("Requested byte length must be a non-negative safe integer");
    }

    const bytes = new Uint8Array(length);
    for (let index = 0; index < length; index += 1) {
      state ^= state << 13n;
      state ^= state >> 7n;
      state ^= state << 17n;
      state &= 0xffff_ffff_ffff_ffffn;
      bytes[index] = Number((state + BigInt(index) + 0x9e37_79b9n) & 0xffn);
    }
    state = (state + BigInt(length) + 1n) & 0xffff_ffff_ffff_ffffn;
    return bytes;
  };
}

export class SequenceFactory<Value> {
  #nextIndex: number;
  readonly #factory: (index: number) => Value;

  public constructor(factory: (index: number) => Value, startIndex = 0) {
    if (!Number.isSafeInteger(startIndex) || startIndex < 0) {
      throw new RangeError("Sequence start index must be a non-negative safe integer");
    }
    this.#factory = factory;
    this.#nextIndex = startIndex;
  }

  public next(): Value {
    if (this.#nextIndex === Number.MAX_SAFE_INTEGER) {
      throw new RangeError("Sequence index exhausted");
    }
    const value = this.#factory(this.#nextIndex);
    this.#nextIndex += 1;
    return value;
  }
}
