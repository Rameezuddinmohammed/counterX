/**
 * DB-gated integration tests for PostgresIdempotencyStore.
 *
 * Skipped when TEST_DATABASE_URL is unset. Exercises the acquire/complete/replay
 * round-trip against a migrated test database.
 */
import { fileURLToPath } from "node:url";
import { randomUUID } from "node:crypto";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { sha256Digest, type Instant } from "@counter/domain";
import { PostgresDatabase } from "./database.js";
import { loadMigrations, MigrationRunner } from "./migrations.js";
import { PostgresIdempotencyStore } from "./runtime-repositories.js";

const testDatabaseUrl = process.env["TEST_DATABASE_URL"]?.trim() || undefined;
const databaseDescribe = testDatabaseUrl === undefined ? describe.skip : describe;
const migrationsDirectory = fileURLToPath(new URL("../migrations", import.meta.url));
const databaseHookTimeout = 30_000;

function digestOf(value: string) {
  return sha256Digest(new TextEncoder().encode(value));
}

databaseDescribe("PostgresIdempotencyStore", () => {
  if (testDatabaseUrl === undefined) {
    return;
  }

  const database = new PostgresDatabase(testDatabaseUrl);
  const store = new PostgresIdempotencyStore(database);

  beforeAll(async () => {
    const migrations = await loadMigrations(migrationsDirectory);
    await new MigrationRunner(database, migrations).up();
  }, databaseHookTimeout);

  afterAll(async () => {
    await database.close();
  });

  it("acquires, completes, and replays the persisted snapshot", async () => {
    const key = `idem_${randomUUID()}`;
    const digest = digestOf(`body:${key}`);
    const now = Date.now() as Instant;
    const snapshot = { transactionId: "txn_001", status: "pending" };

    const acquired = await store.acquire(key, digest, now);
    expect(acquired.ok).toBe(true);
    if (acquired.ok) {
      expect(acquired.value.outcome).toBe("acquired");
    }

    // A second acquire while pending reports in_flight.
    const inFlight = await store.acquire(key, digest, now);
    expect(inFlight.ok).toBe(true);
    if (inFlight.ok) {
      expect(inFlight.value.outcome).toBe("in_flight");
    }

    const completed = await store.complete(key, snapshot, now);
    expect(completed.ok).toBe(true);

    // After completion the same key + digest replays the snapshot.
    const replay = await store.acquire(key, digest, now);
    expect(replay.ok).toBe(true);
    if (replay.ok && replay.value.outcome === "replay") {
      expect(replay.value.responseSnapshot).toEqual(snapshot);
    } else {
      throw new Error(`expected replay, got ${replay.ok ? replay.value.outcome : "error"}`);
    }
  });

  it("reports a digest conflict for the same key with a different request body", async () => {
    const key = `idem_${randomUUID()}`;
    const now = Date.now() as Instant;

    const acquired = await store.acquire(key, digestOf("original"), now);
    expect(acquired.ok).toBe(true);

    const conflict = await store.acquire(key, digestOf("tampered"), now);
    expect(conflict.ok).toBe(true);
    if (conflict.ok) {
      expect(conflict.value.outcome).toBe("digest_conflict");
    }
  });
});
