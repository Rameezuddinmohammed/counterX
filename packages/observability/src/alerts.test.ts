import { describe, expect, it } from "vitest";
import { ALERT_CATALOG, ALERT_NAMES, ALERT_SEVERITIES } from "./alerts.js";
import { RUNBOOK_CATALOG } from "./runbooks.js";

describe("Alert catalog completeness", () => {
  it("defines all expected alerts", () => {
    for (const name of ALERT_NAMES) {
      expect(ALERT_CATALOG[name]).toBeDefined();
    }
  });

  it("every alert has a valid severity", () => {
    for (const alert of Object.values(ALERT_CATALOG)) {
      expect(ALERT_SEVERITIES).toContain(alert.severity);
    }
  });

  it("every alert has a non-empty condition", () => {
    for (const alert of Object.values(ALERT_CATALOG)) {
      expect(alert.condition.length).toBeGreaterThan(0);
    }
  });

  it("every alert has a non-empty threshold", () => {
    for (const alert of Object.values(ALERT_CATALOG)) {
      expect(alert.threshold.length).toBeGreaterThan(0);
    }
  });

  it("every alert has a metric reference", () => {
    for (const alert of Object.values(ALERT_CATALOG)) {
      expect(alert.metricReference).toMatch(/^counter\./u);
    }
  });

  it("every alert has a runbook reference that exists in the catalog", () => {
    for (const alert of Object.values(ALERT_CATALOG)) {
      const runbookRef = alert.runbookReference;
      expect(runbookRef).toMatch(/^runbook:/u);
      expect(RUNBOOK_CATALOG[runbookRef]).toBeDefined();
    }
  });

  it("all alert names match their record key", () => {
    for (const [key, alert] of Object.entries(ALERT_CATALOG)) {
      expect(alert.name).toBe(key);
    }
  });
});
