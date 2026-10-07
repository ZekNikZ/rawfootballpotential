import { defineConfig } from "drizzle-kit";
import { loadEnvFile } from "./src/env";

if (!process.env.DATABASE_URL) loadEnvFile();

export default defineConfig({
  dialect: "postgresql",
  schema: "./src/schema/index.ts",
  out: "./migrations",
  casing: "snake_case",
  // pg-boss keeps its own `pgboss` schema; drizzle only owns `public`.
  schemaFilter: ["public"],
  dbCredentials: { url: process.env.DATABASE_URL ?? "" },
});
