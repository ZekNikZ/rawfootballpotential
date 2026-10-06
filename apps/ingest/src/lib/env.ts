import { loadEnvFile } from "@rfp/db";
import { z } from "zod";

const schema = z.object({
  DATABASE_URL: z.string().min(1),
  LOG_LEVEL: z.enum(["fatal", "error", "warn", "info", "debug", "trace", "silent"]).default("info"),
  TZ: z.string().default("America/New_York"),
  INGEST_SCHEDULES_ENABLED: z
    .enum(["true", "false"])
    .default("true")
    .transform((v) => v === "true"),
});

export type Env = z.infer<typeof schema>;

/** Parses process.env (after loading the repo-root .env in dev). Values are never logged. */
export function loadEnv(): Env {
  if (!process.env.DATABASE_URL) loadEnvFile();
  const parsed = schema.safeParse(process.env);
  if (!parsed.success) {
    throw new Error(
      `Invalid environment: ${parsed.error.issues.map((i) => i.path.join(".")).join(", ")}`
    );
  }
  return parsed.data;
}
