import { defineConfig } from "drizzle-kit";

// Generates the reference migration for the Postgres schema (tests apply it to PGlite).
export default defineConfig({
  dialect: "postgresql",
  schema: ["./registry/support/postgres/schema.ts", "./registry/support/postgres/ai-schema.ts"],
  out: "./registry/support/postgres/migrations",
});
