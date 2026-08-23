import { describe, expect, it } from "vitest";
import {
  assertLocalAndTestAreSeparated,
  parseBaseConfiguration,
  parseLocalDatabaseConfiguration,
} from "./index.js";

const localEnvironment = {
  NODE_ENV: "development",
  COUNTER_ENV: "local",
  LOG_LEVEL: "debug",
  DATABASE_URL: "postgresql://counter_local:synthetic@localhost:5432/counter_local",
} as const;

describe("typed environment configuration", () => {
  it("parses an isolated local database configuration", () => {
    const configuration = parseLocalDatabaseConfiguration(localEnvironment, "local");

    expect(configuration.environment).toBe("local");
    expect(configuration.nodeEnvironment).toBe("development");
    expect(configuration.logLevel).toBe("debug");
    expect(configuration.databaseUrl.pathname).toBe("/counter_local");
  });

  it("maps test mode only to the isolated test database", () => {
    const configuration = parseLocalDatabaseConfiguration(
      {
        NODE_ENV: "test",
        COUNTER_ENV: "test",
        DATABASE_URL: "postgresql://counter_test:synthetic@127.0.0.1:5433/counter_test",
      },
      "test",
    );

    expect(configuration.environment).toBe("test");
    expect(configuration.databaseUrl.port).toBe("5433");
  });

  it("rejects NODE_ENV and COUNTER_ENV combinations that blur environment boundaries", () => {
    expect(() => parseBaseConfiguration({ NODE_ENV: "development", COUNTER_ENV: "test" })).toThrow(
      "NODE_ENV must be test",
    );
  });

  it.each([
    ["a remote host", "postgresql://user:value@db.example.test/counter_local"],
    ["the test database", "postgresql://user:value@localhost/counter_test"],
    ["a non-PostgreSQL URL", "https://localhost/counter_local"],
  ])("rejects %s for local mode", (_description, databaseUrl) => {
    expect(() =>
      parseLocalDatabaseConfiguration({ ...localEnvironment, DATABASE_URL: databaseUrl }),
    ).toThrow();
  });

  it("rejects direct database credentials in hosted environments", () => {
    expect(() =>
      parseLocalDatabaseConfiguration({
        NODE_ENV: "production",
        COUNTER_ENV: "pilot",
        DATABASE_URL: "postgresql://user:value@localhost/counter_local",
      }),
    ).toThrow("Direct database URLs are permitted only");
  });

  it("confirms local and test URLs target distinct databases", () => {
    expect(() =>
      assertLocalAndTestAreSeparated(
        localEnvironment.DATABASE_URL,
        "postgresql://counter_test:synthetic@localhost:5433/counter_test",
      ),
    ).not.toThrow();
  });
});
