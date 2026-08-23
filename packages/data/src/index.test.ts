import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import {
  createBackupCommand,
  createRestoreCommand,
  loadMigrations,
  PACKAGE_NAME,
} from "./index.js";

const temporaryDirectories: string[] = [];

afterEach(async () => {
  await Promise.all(
    temporaryDirectories.splice(0).map((directory) => rm(directory, { recursive: true })),
  );
});

describe("migration source validation", () => {
  it("loads ordered paired migrations and hashes their forward SQL", async () => {
    const directory = await createTemporaryDirectory();
    await Promise.all([
      writeFile(join(directory, "0001-first-change.up.sql"), "CREATE TABLE first_change (id int);"),
      writeFile(join(directory, "0001-first-change.down.sql"), "DROP TABLE first_change;"),
      writeFile(
        join(directory, "0002-second-change.up.sql"),
        "CREATE TABLE second_change (id int);",
      ),
      writeFile(join(directory, "0002-second-change.down.sql"), "DROP TABLE second_change;"),
    ]);

    const migrations = await loadMigrations(directory);

    expect(migrations.map(({ version, name }) => ({ version, name }))).toEqual([
      { version: 1, name: "first-change" },
      { version: 2, name: "second-change" },
    ]);
    expect(migrations[0]?.checksum).toMatch(/^[0-9a-f]{64}$/u);
  });

  it("fails closed when a rollback pair is missing", async () => {
    const directory = await createTemporaryDirectory();
    await writeFile(join(directory, "0001-no-rollback.up.sql"), "SELECT 1;");

    await expect(loadMigrations(directory)).rejects.toThrow("both up and down files");
  });

  it("rejects gaps in migration versions", async () => {
    const directory = await createTemporaryDirectory();
    await Promise.all([
      writeFile(join(directory, "0002-gap.up.sql"), "SELECT 1;"),
      writeFile(join(directory, "0002-gap.down.sql"), "SELECT 1;"),
    ]);

    await expect(loadMigrations(directory)).rejects.toThrow("expected 0001");
  });
});

describe("credential-safe PostgreSQL tools", () => {
  it("passes connection fields through process environment rather than command arguments", () => {
    const command = createBackupCommand({
      databaseUrl: "postgresql://counter_local:private-value@localhost:5432/counter_local",
      outputPath: "backup.dump",
    });

    expect(command.arguments.join(" ")).not.toContain("private-value");
    expect(command.environment["PGPASSWORD"]).toBe("private-value");
    expect(command.environment["PGDATABASE"]).toBe("counter_local");
  });

  it("requires a separate, explicitly named restore database", () => {
    const command = createRestoreCommand({
      backupPath: "backup.dump",
      sourceDatabaseUrl: "postgresql://local:value@localhost/counter_local",
      targetDatabaseUrl: "postgresql://restore:value@localhost/counter_restore",
    });

    expect(command.arguments).toContain("counter_restore");
    expect(command.arguments.join(" ")).not.toContain("value");
  });

  it("rejects remote backup targets and production-like names", () => {
    expect(() =>
      createBackupCommand({
        databaseUrl: "postgresql://user:value@database.example.test/counter_local",
      }),
    ).toThrow("loopback");
    expect(() =>
      createBackupCommand({
        databaseUrl: "postgresql://user:value@localhost/counter_production",
      }),
    ).toThrow("counter_local or counter_test");
  });
});

describe("@counter/data", () => {
  it("exposes its package identity", () => {
    expect(PACKAGE_NAME).toBe("@counter/data");
  });
});

async function createTemporaryDirectory(): Promise<string> {
  const directory = await mkdtemp(join(tmpdir(), "counter-migrations-"));
  temporaryDirectories.push(directory);
  return directory;
}
