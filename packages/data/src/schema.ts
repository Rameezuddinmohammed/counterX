import { sql } from "drizzle-orm";
import { check, integer, jsonb, pgSchema, text, timestamp } from "drizzle-orm/pg-core";

export const platformSchema = pgSchema("platform");

export const counterEnvironment = platformSchema.enum("counter_environment", [
  "local",
  "test",
  "sandbox",
  "pilot",
  "production",
]);

export const schemaVersions = platformSchema.table(
  "schema_versions",
  {
    version: integer("version").primaryKey(),
    name: text("name").notNull().unique(),
    checksum: text("checksum").notNull(),
    appliedAt: timestamp("applied_at", { withTimezone: true, mode: "date" })
      .notNull()
      .default(sql`clock_timestamp()`),
  },
  (table) => [
    check("schema_versions_positive_version", sql`${table.version} > 0`),
    check("schema_versions_sha256_checksum", sql`${table.checksum} ~ '^[0-9a-f]{64}$'`),
  ],
);

export const environmentRegistry = platformSchema.table("environment_registry", {
  environment: counterEnvironment("environment").primaryKey(),
  createdAt: timestamp("created_at", { withTimezone: true, mode: "date" })
    .notNull()
    .default(sql`clock_timestamp()`),
});

export const syntheticFixtures = platformSchema.table(
  "synthetic_fixtures",
  {
    fixtureId: text("fixture_id").primaryKey(),
    environment: counterEnvironment("environment").notNull(),
    label: text("label").notNull(),
    classification: text("classification").notNull(),
    payload: jsonb("payload").$type<Record<string, unknown>>().notNull(),
    createdAt: timestamp("created_at", { withTimezone: true, mode: "date" })
      .notNull()
      .default(sql`clock_timestamp()`),
  },
  (table) => [
    check("synthetic_fixtures_classification", sql`${table.classification} = 'synthetic'`),
    check(
      "synthetic_fixtures_payload_marker",
      sql`${table.payload} @> '{"synthetic": true}'::jsonb`,
    ),
  ],
);
