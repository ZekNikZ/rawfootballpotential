import { loadEnvFile } from "@rfp/db";
import { z } from "zod";

const schema = z.object({
  DATABASE_URL: z.string().min(1),
  PORT: z.coerce.number().int().default(8000),
  LOG_LEVEL: z.enum(["fatal", "error", "warn", "info", "debug", "trace", "silent"]).default("info"),
  TRUST_PROXY: z
    .enum(["true", "false"])
    .default("false")
    .transform((v) => v === "true"),
  /** The RFP blog's RSS feed (Wix). Fetched server-side and cached. */
  BLOG_FEED_URL: z
    .string()
    .url()
    .default("https://jaytalentedmo.wixsite.com/raw-football-potenti/blog-feed.xml"),
});

export type Config = z.infer<typeof schema>;

/** Parses process.env (after loading the repo-root .env in development). Values are never logged. */
export function loadConfig(): Config {
  if (!process.env.DATABASE_URL) loadEnvFile();
  const parsed = schema.safeParse(process.env);
  if (!parsed.success) {
    throw new Error(
      `Invalid environment: ${parsed.error.issues.map((i) => i.path.join(".")).join(", ")}`
    );
  }
  return parsed.data;
}
