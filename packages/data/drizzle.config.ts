import { defineConfig } from "drizzle-kit";

const databaseUrl = process.env["DATABASE_URL"];
if (databaseUrl === undefined || databaseUrl.length === 0) {
  throw new Error("DATABASE_URL is required for Drizzle schema inspection");
}

export default defineConfig({
  dialect: "postgresql",
  schema: ["./src/schema.ts", "./src/identity-schema.ts"],
  out: "./.local/drizzle",
  dbCredentials: {
    url: databaseUrl,
  },
  strict: true,
  verbose: true,
});
