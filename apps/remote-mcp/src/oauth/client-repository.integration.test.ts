/**
 * Integration proof for PostgresRemoteMcpClientRepository against the real
 * platform.remote_mcp_clients table (migration 0024) — proves the SQL matches
 * the live schema, that `text[]` round-trips as a JS string array, that the
 * environment partition really hides other environments' clients, and that
 * the durable CHECK constraints reject what the application-level validation
 * rejects.
 *
 * SKIPPED unless TEST_DATABASE_URL or DATABASE_URL is present (mirrors every
 * other *.integration.test.ts gate in this repo). SAFETY: every row is
 * written under a unique per-run client_id and deleted in afterAll. It never
 * truncates, drops, or migrates the shared schema.
 */
import { afterAll, describe, expect, it } from "vitest";
import { PostgresDatabase } from "@counter/data";
import { PostgresRemoteMcpClientRepository, generateMcpClientId } from "./client-repository.js";

const databaseUrl =
  process.env["TEST_DATABASE_URL"]?.trim() || process.env["DATABASE_URL"]?.trim() || undefined;
const databaseDescribe = databaseUrl === undefined ? describe.skip : describe;

databaseDescribe("PostgresRemoteMcpClientRepository (real Postgres)", () => {
  const database = new PostgresDatabase(databaseUrl as string);
  const testRepo = new PostgresRemoteMcpClientRepository(database, "test");
  const sandboxRepo = new PostgresRemoteMcpClientRepository(database, "sandbox");
  const created: string[] = [];

  function freshId(): string {
    const id = generateMcpClientId();
    created.push(id);
    return id;
  }

  afterAll(async () => {
    if (created.length > 0) {
      await database.query(`DELETE FROM platform.remote_mcp_clients WHERE client_id = ANY($1)`, [
        created,
      ]);
    }
    await database.close();
  }, 30_000);

  it("round-trips a registered client, including the redirect_uris array", async () => {
    const clientId = freshId();
    const record = await testRepo.create({
      clientId,
      redirectUris: ["https://claude.ai/api/mcp/auth_callback", "http://127.0.0.1:33418/cb"],
      clientName: "Claude",
    });

    expect(record.clientId).toBe(clientId);
    expect(record.redirectUris).toEqual([
      "https://claude.ai/api/mcp/auth_callback",
      "http://127.0.0.1:33418/cb",
    ]);
    expect(record.clientName).toBe("Claude");
    expect(record.createdAt).toBeInstanceOf(Date);

    const found = await testRepo.findById(clientId);
    expect(found).toEqual(record);
  });

  it("stores a null client_name as undefined, not null", async () => {
    const clientId = freshId();
    await testRepo.create({
      clientId,
      redirectUris: ["https://example.test/cb"],
      clientName: undefined,
    });
    const found = await testRepo.findById(clientId);
    expect(found?.clientName).toBeUndefined();
  });

  it("returns undefined for an unknown client_id", async () => {
    await expect(testRepo.findById(generateMcpClientId())).resolves.toBeUndefined();
  });

  it("partitions by environment: a sandbox client is invisible to test", async () => {
    const clientId = freshId();
    await sandboxRepo.create({
      clientId,
      redirectUris: ["https://example.test/cb"],
      clientName: undefined,
    });

    await expect(sandboxRepo.findById(clientId)).resolves.toBeDefined();
    // Not a "wrong environment" error — simply not found, matching this
    // repo's existence-hiding convention for cross-tenant lookups.
    await expect(testRepo.findById(clientId)).resolves.toBeUndefined();
  });

  it("the database itself rejects an empty redirect_uris array", async () => {
    await expect(
      testRepo.create({ clientId: freshId(), redirectUris: [], clientName: undefined }),
    ).rejects.toThrow(/redirect_uris/u);
  });

  it("the database itself rejects a non-http(s) redirect_uri", async () => {
    await expect(
      testRepo.create({
        clientId: freshId(),
        redirectUris: ["javascript:alert(1)"],
        clientName: undefined,
      }),
    ).rejects.toThrow(/redirect_uris_absolute/u);

    // ...including when only ONE element of the array is bad.
    await expect(
      testRepo.create({
        clientId: freshId(),
        redirectUris: ["https://ok.test/cb", "ftp://bad.test/cb"],
        clientName: undefined,
      }),
    ).rejects.toThrow(/redirect_uris_absolute/u);
  });
});
