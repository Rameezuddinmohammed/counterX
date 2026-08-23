import { fileURLToPath } from "node:url";
import { dirname, join, resolve } from "node:path";
import { PostgresDatabase } from "./database.js";
import { createBackup, restoreBackup } from "./database-tools.js";
import { applySyntheticSeed, loadMigrations, MigrationRunner } from "./migrations.js";

const packageRoot = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const migrationsDirectory = join(packageRoot, "migrations");
const seedsDirectory = join(packageRoot, "seeds");

export async function runDatabaseCli(
  arguments_: readonly string[],
  environment: NodeJS.ProcessEnv = process.env,
): Promise<void> {
  const command = arguments_[0];
  const databaseUrl = requireEnvironmentValue(environment, "DATABASE_URL");
  const counterEnvironment = requireCounterEnvironment(environment);
  validateLifecycleDatabaseUrl(databaseUrl, counterEnvironment);

  if (command === "backup") {
    const outputPath = arguments_[1];
    const backupPath = await createBackup({
      databaseUrl,
      ...(outputPath === undefined ? {} : { outputPath: resolve(outputPath) }),
      ...(environment["PG_BIN_DIR"] === undefined
        ? {}
        : { clientBinaryDirectory: environment["PG_BIN_DIR"] }),
      workingDirectory: resolve(packageRoot, "../.."),
    });
    console.log(`Backup created: ${backupPath}`);
    return;
  }

  if (command === "restore") {
    const backupPath = arguments_[1];
    if (backupPath === undefined) {
      throw new Error("restore requires a backup file path");
    }
    await restoreBackup({
      backupPath: resolve(backupPath),
      sourceDatabaseUrl: databaseUrl,
      targetDatabaseUrl: requireEnvironmentValue(environment, "RESTORE_DATABASE_URL"),
      ...(environment["PG_BIN_DIR"] === undefined
        ? {}
        : { clientBinaryDirectory: environment["PG_BIN_DIR"] }),
    });
    console.log("Backup restored to the isolated restore database");
    return;
  }

  const database = new PostgresDatabase(databaseUrl);
  try {
    const migrations = await loadMigrations(migrationsDirectory);
    const runner = new MigrationRunner(database, migrations);

    switch (command) {
      case "up": {
        const status = await runner.up(parseTarget(arguments_[1]));
        printStatus(status.currentVersion, status.latestVersion, status.pending.length);
        break;
      }
      case "down": {
        const target = arguments_[1] === undefined ? 0 : parseTarget(arguments_[1]);
        const status = await runner.down(target);
        printStatus(status.currentVersion, status.latestVersion, status.pending.length);
        break;
      }
      case "status": {
        const status = await runner.status();
        printStatus(status.currentVersion, status.latestVersion, status.pending.length);
        break;
      }
      case "seed": {
        const status = await runner.status();
        if (status.pending.length > 0) {
          throw new Error("Apply all migrations before loading synthetic seed fixtures");
        }
        await applySyntheticSeed(database, join(seedsDirectory, `${counterEnvironment}.sql`));
        console.log(`Synthetic ${counterEnvironment} fixtures applied`);
        break;
      }
      default:
        throw new Error(
          "Expected one of: up [version], down [version], status, seed, backup [path], restore <path>",
        );
    }
  } finally {
    await database.close();
  }
}

function requireCounterEnvironment(environment: NodeJS.ProcessEnv): "local" | "test" {
  const value = requireEnvironmentValue(environment, "COUNTER_ENV");
  if (value !== "local" && value !== "test") {
    throw new Error("Database lifecycle commands are restricted to COUNTER_ENV=local or test");
  }
  return value;
}

function requireEnvironmentValue(environment: NodeJS.ProcessEnv, name: string): string {
  const value = environment[name];
  if (value === undefined || value.trim().length === 0) {
    throw new Error(`${name} is required`);
  }
  return value;
}

function validateLifecycleDatabaseUrl(rawUrl: string, environment: "local" | "test"): void {
  let databaseUrl: URL;
  try {
    databaseUrl = new URL(rawUrl);
  } catch {
    throw new Error("DATABASE_URL must be a valid URL");
  }
  const databaseName = decodeURIComponent(databaseUrl.pathname.replace(/^\//u, ""));
  const expectedName = environment === "local" ? "counter_local" : "counter_test";
  if (
    (databaseUrl.protocol !== "postgresql:" && databaseUrl.protocol !== "postgres:") ||
    !["localhost", "127.0.0.1", "[::1]", "::1"].includes(databaseUrl.hostname) ||
    databaseName !== expectedName
  ) {
    throw new Error(
      `${environment} lifecycle commands require a loopback PostgreSQL database named ${expectedName}`,
    );
  }
}

function parseTarget(rawTarget: string | undefined): number | undefined {
  if (rawTarget === undefined) {
    return undefined;
  }
  if (!/^\d+$/u.test(rawTarget)) {
    throw new Error("Migration target must be a non-negative integer");
  }
  return Number.parseInt(rawTarget, 10);
}

function printStatus(currentVersion: number, latestVersion: number, pendingCount: number): void {
  console.log(JSON.stringify({ currentVersion, latestVersion, pendingCount }, undefined, 2));
}

const entryPoint = process.argv[1];
if (entryPoint !== undefined && resolve(entryPoint) === fileURLToPath(import.meta.url)) {
  runDatabaseCli(process.argv.slice(2)).catch((error: unknown) => {
    const message = error instanceof Error ? error.message : "Unknown database lifecycle failure";
    console.error(message);
    process.exitCode = 1;
  });
}
