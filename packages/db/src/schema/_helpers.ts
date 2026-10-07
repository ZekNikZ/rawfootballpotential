import { integer, numeric, timestamp } from "drizzle-orm/pg-core";

/** Surrogate key: `integer generated always as identity`. */
export const pk = () => integer().primaryKey().generatedAlwaysAsIdentity();

/** `timestamptz` that maps to JS `Date`. */
export const ts = () => timestamp({ withTimezone: true, mode: "date" });

/** Fantasy points: exact decimals (2dp from the sources, more after projections), read back as JS numbers. */
export const pts = () => numeric({ precision: 10, scale: 3, mode: "number" });
