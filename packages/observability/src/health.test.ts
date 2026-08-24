import { describe, expect, it } from "vitest";
import type { Instant } from "@counter/domain";
import {
  createHealthRegistry,
  type DependencyHealthCheck,
  type DependencyHealthResult,
} from "./health.js";

function createMockCheck(
  name: string,
  status: "healthy" | "degraded" | "unhealthy",
): DependencyHealthCheck {
  return {
    name,
    async check(): Promise<DependencyHealthResult> {
      return {
        name,
        status,
        lastChecked: Date.now() as Instant,
      };
    },
  };
}

describe("health registry", () => {
  it("returns healthy when no checks are registered", async () => {
    const registry = createHealthRegistry();
    const result = await registry.checkAll();
    expect(result.status).toBe("healthy");
    expect(result.dependencies).toHaveLength(0);
  });

  it("returns healthy when all dependencies are healthy", async () => {
    const registry = createHealthRegistry();
    registry.register(createMockCheck("database", "healthy"));
    registry.register(createMockCheck("redis", "healthy"));
    registry.register(createMockCheck("provider", "healthy"));

    const result = await registry.checkAll();
    expect(result.status).toBe("healthy");
    expect(result.dependencies).toHaveLength(3);
  });

  it("returns degraded when one dependency is degraded", async () => {
    const registry = createHealthRegistry();
    registry.register(createMockCheck("database", "healthy"));
    registry.register(createMockCheck("redis", "degraded"));
    registry.register(createMockCheck("provider", "healthy"));

    const result = await registry.checkAll();
    expect(result.status).toBe("degraded");
  });

  it("returns unhealthy when one dependency is unhealthy", async () => {
    const registry = createHealthRegistry();
    registry.register(createMockCheck("database", "healthy"));
    registry.register(createMockCheck("redis", "degraded"));
    registry.register(createMockCheck("provider", "unhealthy"));

    const result = await registry.checkAll();
    expect(result.status).toBe("unhealthy");
  });

  it("returns unhealthy over degraded when both are present", async () => {
    const registry = createHealthRegistry();
    registry.register(createMockCheck("database", "degraded"));
    registry.register(createMockCheck("redis", "unhealthy"));

    const result = await registry.checkAll();
    expect(result.status).toBe("unhealthy");
  });

  it("includes dependency details in the result", async () => {
    const registry = createHealthRegistry();
    registry.register(createMockCheck("database", "healthy"));

    const result = await registry.checkAll();
    expect(result.dependencies[0]!.name).toBe("database");
    expect(result.dependencies[0]!.status).toBe("healthy");
    expect(result.dependencies[0]!.lastChecked).toBeTypeOf("number");
  });
});
