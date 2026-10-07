import { index, integer, jsonb, pgTable, text } from "drizzle-orm/pg-core";
import { pk, ts } from "./_helpers";
import { rawSource } from "./enums";

/**
 * Every external response, stored as-is so we can re-normalize without re-fetching.
 * Scraped ESPN data is irreplaceable. History is kept (stat corrections show up as newer rows);
 * lookups take the newest row for (source, endpoint, params_hash).
 */
export const rawPayload = pgTable(
  "raw_payload",
  {
    id: pk(),
    source: rawSource().notNull(),
    endpoint: text().notNull(),
    params: jsonb().$type<Record<string, unknown>>().notNull().default({}),
    /** Stable hash of `params`, so lookups don't compare jsonb. */
    paramsHash: text().notNull(),
    fetchedAt: ts().notNull().defaultNow(),
    httpStatus: integer(),
    /** JSON responses. */
    payload: jsonb(),
    /** CSV / non-JSON responses (nflverse, dynastyprocess). Exactly one of payload/body is set. */
    body: text(),
    /** Set for payloads imported from an ESPN season bundle. */
    bundle: text(),
  },
  (t) => [
    index("raw_payload_lookup_idx").on(t.source, t.endpoint, t.paramsHash, t.fetchedAt.desc()),
  ]
);
