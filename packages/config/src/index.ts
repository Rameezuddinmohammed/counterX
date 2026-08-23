import { z } from "zod";

export const PACKAGE_NAME = "@counter/config";

export const counterEnvironments = ["local", "test", "sandbox", "pilot", "production"] as const;

export type CounterEnvironment = (typeof counterEnvironments)[number];
export type LocalDatabaseEnvironment = Extract<CounterEnvironment, "local" | "test">;
export type EnvironmentSource = Readonly<Record<string, string | undefined>>;

const counterEnvironmentSchema = z.enum(counterEnvironments);
const nodeEnvironmentSchema = z.enum(["development", "test", "production"]);
const logLevelSchema = z.enum(["fatal", "error", "warn", "info", "debug", "trace"]);

const baseConfigurationSchema = z
  .object({
    NODE_ENV: nodeEnvironmentSchema,
    COUNTER_ENV: counterEnvironmentSchema,
    LOG_LEVEL: logLevelSchema.default("info"),
    OTEL_EXPORTER_OTLP_ENDPOINT: z.string().url().optional(),
  })
  .superRefine((configuration, context) => {
    const expectedNodeEnvironment =
      configuration.COUNTER_ENV === "local"
        ? "development"
        : configuration.COUNTER_ENV === "test"
          ? "test"
          : "production";

    if (configuration.NODE_ENV !== expectedNodeEnvironment) {
      context.addIssue({
        code: z.ZodIssueCode.custom,
        path: ["NODE_ENV"],
        message: `NODE_ENV must be ${expectedNodeEnvironment} when COUNTER_ENV is ${configuration.COUNTER_ENV}`,
      });
    }
  });

export interface BaseConfiguration {
  readonly environment: CounterEnvironment;
  readonly nodeEnvironment: "development" | "test" | "production";
  readonly logLevel: "fatal" | "error" | "warn" | "info" | "debug" | "trace";
  readonly otlpEndpoint?: URL;
}

export interface LocalDatabaseConfiguration extends BaseConfiguration {
  readonly environment: LocalDatabaseEnvironment;
  readonly databaseUrl: URL;
}

const databaseNames: Readonly<Record<LocalDatabaseEnvironment, string>> = {
  local: "counter_local",
  test: "counter_test",
};

const loopbackHostnames = new Set(["localhost", "127.0.0.1", "[::1]", "::1"]);

export function parseBaseConfiguration(source: EnvironmentSource): BaseConfiguration {
  const parsed = baseConfigurationSchema.parse(source);

  return {
    environment: parsed.COUNTER_ENV,
    nodeEnvironment: parsed.NODE_ENV,
    logLevel: parsed.LOG_LEVEL,
    ...(parsed.OTEL_EXPORTER_OTLP_ENDPOINT === undefined
      ? {}
      : { otlpEndpoint: new URL(parsed.OTEL_EXPORTER_OTLP_ENDPOINT) }),
  };
}

export function parseLocalDatabaseConfiguration(
  source: EnvironmentSource,
  expectedEnvironment?: LocalDatabaseEnvironment,
): LocalDatabaseConfiguration {
  const base = parseBaseConfiguration(source);
  if (base.environment !== "local" && base.environment !== "test") {
    throw new Error(
      "Direct database URLs are permitted only for isolated local and test environments",
    );
  }
  if (expectedEnvironment !== undefined && base.environment !== expectedEnvironment) {
    throw new Error(
      `Expected ${expectedEnvironment} configuration but received ${base.environment}`,
    );
  }

  const rawDatabaseUrl = z.string().min(1).parse(source["DATABASE_URL"]);
  const databaseUrl = parseAndValidateDatabaseUrl(rawDatabaseUrl, base.environment);

  return {
    ...base,
    environment: base.environment,
    databaseUrl,
  };
}

export function parseAndValidateDatabaseUrl(
  rawDatabaseUrl: string,
  environment: LocalDatabaseEnvironment,
): URL {
  let databaseUrl: URL;
  try {
    databaseUrl = new URL(rawDatabaseUrl);
  } catch {
    throw new Error("DATABASE_URL must be a valid PostgreSQL URL");
  }

  if (databaseUrl.protocol !== "postgresql:" && databaseUrl.protocol !== "postgres:") {
    throw new Error("DATABASE_URL must use the postgresql protocol");
  }
  if (!loopbackHostnames.has(databaseUrl.hostname)) {
    throw new Error("Local and test database hosts must be loopback addresses");
  }

  const databaseName = decodeURIComponent(databaseUrl.pathname.replace(/^\//u, ""));
  if (databaseName !== databaseNames[environment]) {
    throw new Error(
      `The ${environment} environment must use the ${databaseNames[environment]} database`,
    );
  }

  return databaseUrl;
}

export function assertLocalAndTestAreSeparated(
  localDatabaseUrl: string,
  testDatabaseUrl: string,
): void {
  const local = parseAndValidateDatabaseUrl(localDatabaseUrl, "local");
  const test = parseAndValidateDatabaseUrl(testDatabaseUrl, "test");

  if (local.href === test.href) {
    throw new Error("Local and test environments must not share a database URL");
  }
}
