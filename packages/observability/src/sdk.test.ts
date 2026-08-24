import { describe, expect, it } from "vitest";
import { createObservabilitySdk } from "./sdk.js";

describe("observability SDK", () => {
  it("creates an SDK instance without throwing", () => {
    const sdk = createObservabilitySdk({
      serviceName: "test-service",
      environment: "test",
    });

    expect(sdk).toBeDefined();
    expect(typeof sdk.start).toBe("function");
    expect(typeof sdk.shutdown).toBe("function");
  });

  it("starts and shuts down cleanly", async () => {
    const sdk = createObservabilitySdk({
      serviceName: "test-service",
      environment: "test",
      signals: {
        traces: false,
        metrics: false,
        logs: false,
      },
    });

    expect(() => {
      sdk.start();
    }).not.toThrow();

    await expect(sdk.shutdown()).resolves.toBeUndefined();
  });

  it("handles multiple start calls idempotently", () => {
    const sdk = createObservabilitySdk({
      serviceName: "test-service",
      environment: "test",
      signals: { traces: false, metrics: false, logs: false },
    });

    expect(() => {
      sdk.start();
      sdk.start();
    }).not.toThrow();
  });

  it("handles shutdown without start gracefully", async () => {
    const sdk = createObservabilitySdk({
      serviceName: "test-service",
      environment: "test",
      signals: { traces: false, metrics: false, logs: false },
    });

    await expect(sdk.shutdown()).resolves.toBeUndefined();
  });

  it("respects disabled signals config", () => {
    const sdk = createObservabilitySdk({
      serviceName: "test-service",
      environment: "local",
      signals: {
        traces: false,
        metrics: false,
        logs: false,
      },
    });

    // SDK should create successfully with all signals disabled
    expect(sdk).toBeDefined();
  });

  it("accepts OTLP endpoint configuration", () => {
    const sdk = createObservabilitySdk({
      serviceName: "test-service",
      environment: "sandbox",
      otlpEndpoint: "http://localhost:4318",
      signals: { traces: false, metrics: false, logs: false },
    });

    expect(sdk).toBeDefined();
  });
});
