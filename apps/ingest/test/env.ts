import { loadEnvFile } from "@rfp/db";

// Local runs read the repo-root .env; CI provides DATABASE_URL directly.
if (!process.env.DATABASE_URL) loadEnvFile();
