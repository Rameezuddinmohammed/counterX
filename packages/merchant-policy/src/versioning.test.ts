import { describe, expect, it } from "vitest";

import {
  advanceVersion,
  compareVersions,
  detectVersionTransition,
  isMonotonicHistory,
} from "./versioning.js";

// ---------------------------------------------------------------------------
// compareVersions
// ---------------------------------------------------------------------------

describe("compareVersions", () => {
  it("returns 'newer' when candidate > current", () => {
    expect(compareVersions(1, 2)).toBe("newer");
    expect(compareVersions(5, 10)).toBe("newer");
  });

  it("returns 'same' when candidate === current", () => {
    expect(compareVersions(1, 1)).toBe("same");
    expect(compareVersions(42, 42)).toBe("same");
  });

  it("returns 'rollback' when candidate < current", () => {
    expect(compareVersions(5, 3)).toBe("rollback");
    expect(compareVersions(10, 1)).toBe("rollback");
  });
});

// ---------------------------------------------------------------------------
// detectVersionTransition
// ---------------------------------------------------------------------------

describe("detectVersionTransition", () => {
  it("detects a forward transition", () => {
    const t = detectVersionTransition(1, 2);
    expect(t.from).toBe(1);
    expect(t.to).toBe(2);
    expect(t.comparison).toBe("newer");
    expect(t.isRollback).toBe(false);
  });

  it("detects a rollback transition", () => {
    const t = detectVersionTransition(5, 3);
    expect(t.from).toBe(5);
    expect(t.to).toBe(3);
    expect(t.comparison).toBe("rollback");
    expect(t.isRollback).toBe(true);
  });

  it("detects same-version transition", () => {
    const t = detectVersionTransition(3, 3);
    expect(t.from).toBe(3);
    expect(t.to).toBe(3);
    expect(t.comparison).toBe("same");
    expect(t.isRollback).toBe(false);
  });
});

// ---------------------------------------------------------------------------
// advanceVersion
// ---------------------------------------------------------------------------

describe("advanceVersion", () => {
  it("succeeds for a forward version advance", () => {
    const result = advanceVersion(1, 2, "merchant_001", false);
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.value.version).toBe(2);
    expect(result.value.merchantId).toBe("merchant_001");
    expect(typeof result.value.activatedAt).toBe("number");
  });

  it("rejects rollback without allowRollback flag", () => {
    const result = advanceVersion(5, 3, "merchant_001", false);
    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.error.code).toBe("CONFLICT");
    expect(result.error.category).toBe("conflict");
  });

  it("allows rollback with allowRollback flag", () => {
    const result = advanceVersion(5, 3, "merchant_001", true);
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.value.version).toBe(3);
  });

  it("rejects same version (no-op)", () => {
    const result = advanceVersion(5, 5, "merchant_001", false);
    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.error.code).toBe("CONFLICT");
  });

  it("rejects non-positive version", () => {
    const result = advanceVersion(1, 0, "merchant_001", false);
    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.error.code).toBe("OUT_OF_RANGE");
  });

  it("rejects non-integer version", () => {
    const result = advanceVersion(1, 2.5, "merchant_001", false);
    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.error.code).toBe("OUT_OF_RANGE");
  });
});

// ---------------------------------------------------------------------------
// isMonotonicHistory
// ---------------------------------------------------------------------------

describe("isMonotonicHistory", () => {
  it("returns true for empty history", () => {
    expect(isMonotonicHistory([])).toBe(true);
  });

  it("returns true for single-element history", () => {
    expect(isMonotonicHistory([1])).toBe(true);
  });

  it("returns true for strictly increasing history", () => {
    expect(isMonotonicHistory([1, 2, 3, 5, 10])).toBe(true);
  });

  it("returns false for non-monotonic history", () => {
    expect(isMonotonicHistory([1, 2, 3, 2, 5])).toBe(false);
  });

  it("returns false for duplicate versions in history", () => {
    expect(isMonotonicHistory([1, 2, 2, 3])).toBe(false);
  });

  it("returns false for decreasing history", () => {
    expect(isMonotonicHistory([5, 4, 3, 2, 1])).toBe(false);
  });
});
