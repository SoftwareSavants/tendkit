import { defineConfig } from "drizzle-kit";

// Generates the reference migration for the SQLite / D1 schema (tests apply it to node:sqlite).
export default defineConfig({
  dialect: "sqlite",
  schema: ["./registry/support/d1/schema.ts", "./registry/support/d1/ai-schema.ts"],
  out: "./registry/support/d1/migrations",
});
