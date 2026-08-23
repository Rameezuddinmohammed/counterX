import { describe, expect, it } from "vitest";
import fc from "fast-check";
import {
  FixedClock,
  PACKAGE_NAME,
  SequenceFactory,
  createDeterministicRandomByteSource,
} from "./index.js";

describe("@counter/testkit", () => {
  it("exposes its package identity", () => {
    expect(PACKAGE_NAME).toBe("@counter/testkit");
  });

  it("provides a fixed, explicitly advanced clock", () => {
    const clock = new FixedClock(1_000);

    expect(clock.now()).toBe(1_000);
    expect(clock.now()).toBe(1_000);
    expect(clock.advance((current) => current + 250)).toBe(1_250);
    clock.set(2_000);
    expect(clock.now()).toBe(2_000);
  });

  it("generates deterministic byte streams of every requested size", () => {
    fc.assert(
      fc.property(fc.integer({ min: 0, max: 512 }), fc.nat(), (length, seed) => {
        const left = createDeterministicRandomByteSource(seed);
        const right = createDeterministicRandomByteSource(seed);

        expect(left(length)).toEqual(right(length));
        expect(left(length)).toEqual(right(length));
      }),
    );
  });

  it("provides reproducible typed sequences", () => {
    const sequence = new SequenceFactory((index) => `test-id-${index}`, 3);

    expect(sequence.next()).toBe("test-id-3");
    expect(sequence.next()).toBe("test-id-4");
  });
});
