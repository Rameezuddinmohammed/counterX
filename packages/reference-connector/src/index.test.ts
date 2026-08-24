import { describe, expect, it } from "vitest";
import {
  PACKAGE_NAME,
} from "./index.js";
import type {
  ReferenceConnectorManifest,
  FaultControls,
} from "./index.js";

describe("@counter/reference-connector", () => {
  it("exposes its package identity", () => {
    expect(PACKAGE_NAME).toBe("@counter/reference-connector");
  });

  it("ReferenceConnectorManifest type is structurally correct", () => {
    const manifest: ReferenceConnectorManifest = {
      connectorId: "ref-1",
      platform: "reference",
      version: "1.0.0",
      capabilities: ["catalog-read", "inventory-read"],
      certificationLevel: "basic",
    };
    expect(manifest.platform).toBe("reference");
    expect(manifest.capabilities).toHaveLength(2);
  });

  it("FaultControls type is structurally correct", () => {
    const controls: FaultControls = {
      enabled: true,
      failureRate: 0.1,
      latencyMs: 500,
      errorCodes: ["TIMEOUT", "RATE_LIMIT"],
      affectedOperations: ["catalog-sync"],
    };
    expect(controls.enabled).toBe(true);
    expect(controls.failureRate).toBe(0.1);
  });
});
