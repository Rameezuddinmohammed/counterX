import { describe, expect, it } from "vitest";
import type { CorrelationId, Environment } from "@counter/domain";
import { createLogger, type LogEntry, type LogWriter } from "./logger.js";

function createTestWriter(): LogWriter & { entries: LogEntry[] } {
  const entries: LogEntry[] = [];
  return {
    entries,
    write(entry: LogEntry): void {
      entries.push(entry);
    },
  };
}

describe("structured logger", () => {
  it("outputs JSON with required fields", () => {
    const writer = createTestWriter();
    const logger = createLogger({
      level: "info",
      context: {
        correlationId: "ctr_correlation_AAAAAAAAAAAAAAAAAAAAAA" as CorrelationId,
        environment: "production" as Environment,
        service: "control-plane-api",
      },
      writer,
    });

    logger.info("Request processed");

    expect(writer.entries).toHaveLength(1);
    const entry = writer.entries[0]!;
    expect(entry.timestamp).toMatch(/^\d{4}-\d{2}-\d{2}T/u);
    expect(entry.level).toBe("info");
    expect(entry.message).toBe("Request processed");
    expect(entry.correlationId).toBe("ctr_correlation_AAAAAAAAAAAAAAAAAAAAAA");
    expect(entry.environment).toBe("production");
    expect(entry.service).toBe("control-plane-api");
  });

  it("redacts secrets from log data", () => {
    const writer = createTestWriter();
    const logger = createLogger({
      level: "debug",
      context: { service: "test" },
      writer,
    });

    logger.info("User login", {
      userId: "ctr_actor_BBBBBBBBBBBBBBBBBBBBBB",
      password: "super-secret",
      apiKey: "sk_live_abc123",
    });

    const entry = writer.entries[0]!;
    const data = entry.data as Record<string, unknown>;
    expect(data["userId"]).toBe("ctr_actor_BBBBBBBBBBBBBBBBBBBBBB");
    expect(data["password"]).toBe("[REDACTED]");
    expect(data["apiKey"]).toBe("[REDACTED]");
  });

  it("redacts credit card patterns from log data", () => {
    const writer = createTestWriter();
    const logger = createLogger({
      level: "debug",
      context: {},
      writer,
    });

    logger.info("Payment attempt", {
      reference: "Payment for card 4111111111111111",
    });

    const entry = writer.entries[0]!;
    const data = entry.data as Record<string, unknown>;
    expect(data["reference"]).toBe("Payment for card [REDACTED_CARD]");
  });

  it("respects log level filtering", () => {
    const writer = createTestWriter();
    const logger = createLogger({
      level: "warn",
      context: {},
      writer,
    });

    logger.trace("should not appear");
    logger.debug("should not appear");
    logger.info("should not appear");
    logger.warn("should appear");
    logger.error("should appear");
    logger.fatal("should appear");

    expect(writer.entries).toHaveLength(3);
    expect(writer.entries[0]!.level).toBe("warn");
    expect(writer.entries[1]!.level).toBe("error");
    expect(writer.entries[2]!.level).toBe("fatal");
  });

  it("includes error information when provided", () => {
    const writer = createTestWriter();
    const logger = createLogger({
      level: "error",
      context: {},
      writer,
    });

    const testError = new Error("Connection failed");
    logger.error("Database error", { query: "SELECT 1" }, testError);

    const entry = writer.entries[0]!;
    expect(entry.error?.message).toBe("Connection failed");
    expect(entry.error?.stack).toContain("Connection failed");
  });

  it("creates child loggers with merged context", () => {
    const writer = createTestWriter();
    const logger = createLogger({
      level: "info",
      context: {
        service: "api",
        environment: "test" as Environment,
      },
      writer,
    });

    const child = logger.child({
      correlationId: "ctr_correlation_CCCCCCCCCCCCCCCCCCCCCC" as CorrelationId,
      scope: "merchant:m123",
    });

    child.info("Child log");

    const entry = writer.entries[0]!;
    expect(entry.service).toBe("api");
    expect(entry.environment).toBe("test");
    expect(entry.correlationId).toBe("ctr_correlation_CCCCCCCCCCCCCCCCCCCCCC");
    expect(entry.scope).toBe("merchant:m123");
  });

  it("does not include optional fields when not set", () => {
    const writer = createTestWriter();
    const logger = createLogger({
      level: "info",
      context: {},
      writer,
    });

    logger.info("Minimal log");

    const entry = writer.entries[0]!;
    expect(entry.correlationId).toBeUndefined();
    expect(entry.environment).toBeUndefined();
    expect(entry.service).toBeUndefined();
    expect(entry.scope).toBeUndefined();
    expect(entry.data).toBeUndefined();
    expect(entry.error).toBeUndefined();
  });
});
