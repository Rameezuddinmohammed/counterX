/**
 * Drizzle schema definition for the merchant policy config table.
 *
 * Serves as a reference for the table structure. Actual queries are performed
 * via raw SQL through the DatabaseSession interface (see policy-store.ts).
 */

import { sql } from "drizzle-orm";
import { bigint, check, integer, jsonb, text, timestamp, unique } from "drizzle-orm/pg-core";
import { counterEnvironment } from "./schema.js";
import { merchantSchema } from "./identity-schema.js";

export const policyConfigs = merchantSchema.table(
  "policy_configs",
  {
    id: bigint("id", { mode: "number" }).generatedAlwaysAsIdentity().primaryKey(),
    environment: counterEnvironment("environment").notNull(),
    merchantId: text("merchant_id").notNull(),
    version: integer("version").notNull(),
    config: jsonb("config").notNull(),
    createdAt: timestamp("created_at", { withTimezone: true, mode: "date" })
      .notNull()
      .default(sql`clock_timestamp()`),
    updatedAt: timestamp("updated_at", { withTimezone: true, mode: "date" })
      .notNull()
      .default(sql`clock_timestamp()`),
  },
  (table) => [
    unique("policy_configs_natural_key").on(table.environment, table.merchantId),
    check("policy_configs_version_positive", sql`${table.version} >= 1`),
  ],
);
