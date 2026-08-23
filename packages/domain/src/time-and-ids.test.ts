import { describe, expect, it } from "vitest";
import fc from "fast-check";
import {
  COUNTER_ID_ENTROPY_BYTES,
  COUNTER_ID_KINDS,
  MAX_INSTANT_EPOCH_MILLISECONDS,
  MIN_INSTANT_EPOCH_MILLISECONDS,
  CryptoIdGenerator,
  addMilliseconds,
  compareInstants,
  createCounterId,
  instantFromEpochMilliseconds,
  parseAnyCounterId,
  parseCounterId,
  parseInstant,
  serializeInstant,
  type Clock,
  type Instant,
  type Result,
} from "./index.js";

function unwrap<Value>(result: Result<Value>): Value {
  if (!result.ok) {
    throw new Error(`${result.error.code}: ${result.error.message}`);
  }
  return result.value;
}

class FixedClock implements Clock {
  public constructor(private readonly instant: Instant) {}

  public now(): Instant {
    return this.instant;
  }
}

describe("UTC instants and clocks", () => {
  it("round-trips the full canonical millisecond instant domain", () => {
    fc.assert(
      fc.property(
        fc.integer({
          min: MIN_INSTANT_EPOCH_MILLISECONDS,
          max: MAX_INSTANT_EPOCH_MILLISECONDS,
        }),
        (epochMilliseconds) => {
          const instant = unwrap(instantFromEpochMilliseconds(epochMilliseconds));
          const serialized = serializeInstant(instant);
          const reparsed = unwrap(parseInstant(serialized));

          expect(serialized).toMatch(/^\d{4}-.*\.\d{3}Z$/u);
          expect(reparsed).toBe(instant);
        },
      ),
    );
  });

  it("accepts both exact RFC 3339 boundaries and rejects both overflows", () => {
    const minimum = unwrap(instantFromEpochMilliseconds(MIN_INSTANT_EPOCH_MILLISECONDS));
    const maximum = unwrap(instantFromEpochMilliseconds(MAX_INSTANT_EPOCH_MILLISECONDS));

    expect(serializeInstant(minimum)).toBe("0000-01-01T00:00:00.000Z");
    expect(serializeInstant(maximum)).toBe("9999-12-31T23:59:59.999Z");
    expect(addMilliseconds(minimum, -1)).toMatchObject({
      ok: false,
      error: { code: "OVERFLOW" },
    });
    expect(addMilliseconds(maximum, 1)).toMatchObject({
      ok: false,
      error: { code: "OVERFLOW" },
    });
  });

  it("uses deterministic injected clocks and exact millisecond arithmetic", () => {
    const initial = unwrap(parseInstant("2026-08-23T12:34:56.789Z"));
    const clock = new FixedClock(initial);
    const later = unwrap(addMilliseconds(clock.now(), 1_211));

    expect(serializeInstant(clock.now())).toBe("2026-08-23T12:34:56.789Z");
    expect(serializeInstant(later)).toBe("2026-08-23T12:34:58.000Z");
    expect(compareInstants(initial, later)).toBe(-1);
  });

  it("rejects local offsets and missing milliseconds", () => {
    expect(parseInstant("2026-08-23T18:04:56.789+05:30").ok).toBe(false);
    expect(parseInstant("2026-08-23T12:34:56Z").ok).toBe(false);
  });
});

describe("opaque Counter IDs", () => {
  it("round-trips every reviewed kind and 128-bit entropy value", () => {
    fc.assert(
      fc.property(
        fc.constantFrom(...COUNTER_ID_KINDS),
        fc.uint8Array({
          minLength: COUNTER_ID_ENTROPY_BYTES,
          maxLength: COUNTER_ID_ENTROPY_BYTES,
        }),
        (kind, entropy) => {
          const id = unwrap(createCounterId(kind, entropy));
          const reparsed = unwrap(parseCounterId(id, kind));

          expect(id).toMatch(new RegExp(`^ctr_${kind}_[A-Za-z0-9_-]{22}$`, "u"));
          expect(reparsed).toBe(id);
        },
      ),
    );
  });

  it("rejects non-canonical base64url aliases for every generated ID", () => {
    const alphabet = "ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789-_";
    fc.assert(
      fc.property(
        fc.constantFrom(...COUNTER_ID_KINDS),
        fc.uint8Array({
          minLength: COUNTER_ID_ENTROPY_BYTES,
          maxLength: COUNTER_ID_ENTROPY_BYTES,
        }),
        (kind, entropy) => {
          const id = unwrap(createCounterId(kind, entropy));
          const finalCharacter = id.at(-1);
          const index = finalCharacter === undefined ? -1 : alphabet.indexOf(finalCharacter);
          expect(index % 16).toBe(0);

          const alias = `${id.slice(0, -1)}${alphabet[index + 1]}`;
          expect(parseAnyCounterId(alias).ok).toBe(false);
        },
      ),
    );
  });

  it("requests exactly 128 crypto-random bits from its source", () => {
    const requestedLengths: number[] = [];
    const generator = new CryptoIdGenerator((length) => {
      requestedLengths.push(length);
      return new Uint8Array(length).fill(7);
    });

    expect(generator.generate("merchant")).toBe("ctr_merchant_BwcHBwcHBwcHBwcHBwcHBw");
    expect(requestedLengths).toEqual([COUNTER_ID_ENTROPY_BYTES]);
  });

  it("produces unique opaque values from the system cryptographic source", () => {
    const generator = new CryptoIdGenerator();
    const ids = Array.from({ length: 256 }, () => generator.generate("correlation"));

    expect(new Set(ids).size).toBe(ids.length);
    expect(ids.every((id) => /^ctr_correlation_[A-Za-z0-9_-]{22}$/u.test(id))).toBe(true);
  });

  it("rejects malformed entropy, unreviewed kinds, and cross-kind parsing", () => {
    expect(createCounterId("merchant", new Uint8Array(15)).ok).toBe(false);
    expect(parseAnyCounterId("ctr_customer-alice_AAAAAAAAAAAAAAAAAAAAAA").ok).toBe(false);

    const merchantId = unwrap(createCounterId("merchant", new Uint8Array(16)));
    expect(parseCounterId(merchantId, "wallet").ok).toBe(false);
  });
});
