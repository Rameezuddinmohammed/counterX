import { describe, expect, it } from "vitest";
import {
  isFleetHealthArray,
  isIncidentSummaryArray,
  isKillSwitchViewArray,
  isQueueStatusArray,
} from "./types.js";

describe("Type guard functions", () => {
  describe("isFleetHealthArray", () => {
    it("returns true for valid fleet health array", () => {
      const valid = [
        { name: "database", status: "healthy", lastChecked: "2024-01-01T00:00:00.000Z" },
        { name: "redis", status: "degraded", lastChecked: "2024-01-01T00:00:00.000Z", message: "slow" },
      ];
      expect(isFleetHealthArray(valid)).toBe(true);
    });

    it("returns true for empty array", () => {
      expect(isFleetHealthArray([])).toBe(true);
    });

    it("returns false for non-array", () => {
      expect(isFleetHealthArray("not an array")).toBe(false);
      expect(isFleetHealthArray(null)).toBe(false);
      expect(isFleetHealthArray(42)).toBe(false);
    });

    it("returns false for array with invalid items", () => {
      expect(isFleetHealthArray([{ name: "db" }])).toBe(false);
      expect(isFleetHealthArray([{ status: "healthy" }])).toBe(false);
    });
  });

  describe("isIncidentSummaryArray", () => {
    it("returns true for valid incident summary array", () => {
      const valid = [
        {
          id: "inc-1",
          title: "High error rate",
          severity: "critical",
          scope: "platform",
          startedAt: "2024-01-01T00:00:00.000Z",
        },
      ];
      expect(isIncidentSummaryArray(valid)).toBe(true);
    });

    it("returns true for empty array", () => {
      expect(isIncidentSummaryArray([])).toBe(true);
    });

    it("returns false for invalid items", () => {
      expect(isIncidentSummaryArray([{ id: "1" }])).toBe(false);
    });
  });

  describe("isQueueStatusArray", () => {
    it("returns true for valid queue status array", () => {
      const valid = [
        { name: "jobs", depth: 100, oldestJobAge: 30, processingRate: 50 },
      ];
      expect(isQueueStatusArray(valid)).toBe(true);
    });

    it("returns true for empty array", () => {
      expect(isQueueStatusArray([])).toBe(true);
    });

    it("returns false for invalid items", () => {
      expect(isQueueStatusArray([{ name: "jobs" }])).toBe(false);
    });
  });

  describe("isKillSwitchViewArray", () => {
    it("returns true for valid kill switch view array", () => {
      const valid = [
        {
          id: "ks-1",
          scope: "merchant",
          entityId: null,
          status: "active",
          reason: "incident",
          activatedBy: "op-1",
          activatedAt: "2024-01-01T00:00:00.000Z",
          expiresAt: null,
        },
      ];
      expect(isKillSwitchViewArray(valid)).toBe(true);
    });

    it("returns true for empty array", () => {
      expect(isKillSwitchViewArray([])).toBe(true);
    });

    it("returns false for invalid items", () => {
      expect(isKillSwitchViewArray([{ id: "ks-1" }])).toBe(false);
    });
  });
});
