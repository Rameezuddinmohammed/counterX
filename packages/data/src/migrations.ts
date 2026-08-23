import { createHash } from "node:crypto";
import { readdir, readFile } from "node:fs/promises";
import { join } from "node:path";
import type { DatabaseSession, TransactionalDatabase } from "./database.js";

const migrationFilePattern = /^(\d{4})-([a-z0-9]+(?:-[a-z0-9]+)*)\.(up|down)\.sql$/u;
const migrationLockId = 1_186_470_989;

export interface Migration {
  readonly version: number;
  readonly name: string;
  readonly checksum: string;
  readonly upSql: string;
  readonly downSql: string;
}

export interface AppliedMigration {
  readonly version: number;
  readonly name: string;
  readonly checksum: string;
  readonly appliedAt: Date;
}

export interface MigrationStatus {
  readonly applied: readonly AppliedMigration[];
  readonly pending: readonly Migration[];
  readonly currentVersion: number;
  readonly latestVersion: number;
}

interface MigrationFilePair {
  version: number;
  name: string;
  upPath?: string;
  downPath?: string;
}

interface AppliedMigrationRow {
  version: number;
  name: string;
  checksum: string;
  applied_at: Date;
}

export async function loadMigrations(directory: string): Promise<readonly Migration[]> {
  const directoryEntries = await readdir(directory, { withFileTypes: true });
  const pairs = new Map<number, MigrationFilePair>();

  for (const entry of directoryEntries) {
    if (!entry.isFile()) {
      continue;
    }
    const match = migrationFilePattern.exec(entry.name);
    if (match === null) {
      if (entry.name.endsWith(".sql")) {
        throw new Error(`Invalid migration filename: ${entry.name}`);
      }
      continue;
    }

    const versionText = match[1];
    const name = match[2];
    const direction = match[3];
    if (versionText === undefined || name === undefined || direction === undefined) {
      throw new Error(`Could not parse migration filename: ${entry.name}`);
    }

    const version = Number.parseInt(versionText, 10);
    const existing = pairs.get(version);
    if (existing !== undefined && existing.name !== name) {
      throw new Error(`Migration version ${versionText} has conflicting names`);
    }

    const pair = existing ?? { version, name };
    const path = join(directory, entry.name);
    if (direction === "up") {
      if (pair.upPath !== undefined) {
        throw new Error(`Migration ${versionText} has duplicate up files`);
      }
      pair.upPath = path;
    } else {
      if (pair.downPath !== undefined) {
        throw new Error(`Migration ${versionText} has duplicate down files`);
      }
      pair.downPath = path;
    }
    pairs.set(version, pair);
  }

  const orderedPairs = [...pairs.values()].sort((left, right) => left.version - right.version);
  assertContiguousVersions(orderedPairs);

  return Promise.all(
    orderedPairs.map(async (pair) => {
      if (pair.upPath === undefined || pair.downPath === undefined) {
        throw new Error(
          `Migration ${formatVersion(pair.version)}-${pair.name} must have both up and down files`,
        );
      }
      const [upSql, downSql] = await Promise.all([
        readFile(pair.upPath, "utf8"),
        readFile(pair.downPath, "utf8"),
      ]);
      if (upSql.trim().length === 0 || downSql.trim().length === 0) {
        throw new Error(`Migration ${formatVersion(pair.version)}-${pair.name} cannot be empty`);
      }

      return {
        version: pair.version,
        name: pair.name,
        checksum: createHash("sha256").update(upSql, "utf8").digest("hex"),
        upSql,
        downSql,
      };
    }),
  );
}

export class MigrationRunner {
  constructor(
    private readonly database: TransactionalDatabase,
    private readonly migrations: readonly Migration[],
  ) {
    assertContiguousVersions(migrations);
  }

  async status(): Promise<MigrationStatus> {
    await ensureSchemaVersionTable(this.database);
    const applied = await readAppliedMigrations(this.database);
    validateAppliedMigrations(applied, this.migrations);
    const currentVersion = applied.at(-1)?.version ?? 0;

    return {
      applied,
      pending: this.migrations.filter((migration) => migration.version > currentVersion),
      currentVersion,
      latestVersion: this.migrations.at(-1)?.version ?? 0,
    };
  }

  async up(targetVersion = this.migrations.at(-1)?.version ?? 0): Promise<MigrationStatus> {
    assertTargetVersion(targetVersion, this.migrations);
    await ensureSchemaVersionTable(this.database);

    await this.database.transaction(async (session) => {
      await acquireMigrationLock(session);
      const applied = await readAppliedMigrations(session);
      validateAppliedMigrations(applied, this.migrations);
      const currentVersion = applied.at(-1)?.version ?? 0;
      if (targetVersion < currentVersion) {
        throw new Error(
          `Cannot migrate up from version ${currentVersion} to ${targetVersion}; use rollback`,
        );
      }

      for (const migration of this.migrations) {
        if (migration.version <= currentVersion || migration.version > targetVersion) {
          continue;
        }
        await session.query(migration.upSql);
        await session.query(
          `INSERT INTO platform.schema_versions (version, name, checksum)
           VALUES ($1, $2, $3)`,
          [migration.version, migration.name, migration.checksum],
        );
      }
    });

    return this.status();
  }

  async down(targetVersion = 0): Promise<MigrationStatus> {
    assertTargetVersion(targetVersion, this.migrations, true);
    await ensureSchemaVersionTable(this.database);

    await this.database.transaction(async (session) => {
      await acquireMigrationLock(session);
      const applied = await readAppliedMigrations(session);
      validateAppliedMigrations(applied, this.migrations);
      const currentVersion = applied.at(-1)?.version ?? 0;
      if (targetVersion > currentVersion) {
        throw new Error(
          `Cannot roll back from version ${currentVersion} to future version ${targetVersion}`,
        );
      }

      const migrationsByVersion = new Map(
        this.migrations.map((migration) => [migration.version, migration]),
      );
      for (const appliedMigration of [...applied].reverse()) {
        if (appliedMigration.version <= targetVersion) {
          continue;
        }
        const migration = migrationsByVersion.get(appliedMigration.version);
        if (migration === undefined) {
          throw new Error(`Cannot roll back unknown migration ${appliedMigration.version}`);
        }
        await session.query(migration.downSql);
        await session.query("DELETE FROM platform.schema_versions WHERE version = $1", [
          migration.version,
        ]);
      }
    });

    return this.status();
  }
}

export async function applySyntheticSeed(
  database: TransactionalDatabase,
  seedPath: string,
): Promise<void> {
  const seedSql = await readFile(seedPath, "utf8");
  if (seedSql.trim().length === 0) {
    throw new Error("Seed file cannot be empty");
  }
  await database.transaction(async (session) => {
    await acquireMigrationLock(session);
    await session.query(seedSql);
  });
}

async function ensureSchemaVersionTable(session: DatabaseSession): Promise<void> {
  await session.query(`
    CREATE SCHEMA IF NOT EXISTS platform;
    CREATE TABLE IF NOT EXISTS platform.schema_versions (
      version integer PRIMARY KEY,
      name text NOT NULL UNIQUE,
      checksum text NOT NULL,
      applied_at timestamptz NOT NULL DEFAULT clock_timestamp(),
      CONSTRAINT schema_versions_positive_version CHECK (version > 0),
      CONSTRAINT schema_versions_sha256_checksum CHECK (checksum ~ '^[0-9a-f]{64}$')
    );
  `);
}

async function acquireMigrationLock(session: DatabaseSession): Promise<void> {
  await session.query("SELECT pg_advisory_xact_lock($1)", [migrationLockId]);
}

async function readAppliedMigrations(
  session: DatabaseSession,
): Promise<readonly AppliedMigration[]> {
  const result = await session.query<AppliedMigrationRow>(
    `SELECT version, name, checksum, applied_at
     FROM platform.schema_versions
     ORDER BY version`,
  );

  return result.rows.map((row) => ({
    version: row.version,
    name: row.name,
    checksum: row.checksum,
    appliedAt: row.applied_at,
  }));
}

function validateAppliedMigrations(
  applied: readonly AppliedMigration[],
  available: readonly Migration[],
): void {
  for (const [index, appliedMigration] of applied.entries()) {
    const expected = available[index];
    if (expected === undefined || expected.version !== appliedMigration.version) {
      throw new Error(
        `Applied migration ${appliedMigration.version} is not a known ordered migration`,
      );
    }
    if (
      expected.name !== appliedMigration.name ||
      expected.checksum !== appliedMigration.checksum
    ) {
      throw new Error(`Applied migration ${appliedMigration.version} no longer matches its source`);
    }
  }
}

function assertContiguousVersions(
  migrations: readonly Pick<Migration, "version" | "name">[],
): void {
  migrations.forEach((migration, index) => {
    const expectedVersion = index + 1;
    if (migration.version !== expectedVersion) {
      throw new Error(
        `Migration versions must be contiguous from 0001; expected ${formatVersion(expectedVersion)} but found ${formatVersion(migration.version)}`,
      );
    }
  });
}

function assertTargetVersion(
  targetVersion: number,
  migrations: readonly Migration[],
  allowZero = false,
): void {
  const minimum = allowZero ? 0 : migrations.length === 0 ? 0 : 1;
  const maximum = migrations.at(-1)?.version ?? 0;
  if (!Number.isInteger(targetVersion) || targetVersion < minimum || targetVersion > maximum) {
    throw new Error(`Migration target must be an integer between ${minimum} and ${maximum}`);
  }
}

function formatVersion(version: number): string {
  return version.toString().padStart(4, "0");
}
