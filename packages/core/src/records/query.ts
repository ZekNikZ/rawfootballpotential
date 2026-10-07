import { z } from "zod";
import { MEDIAN_MODES, POSITIONS, SCOPES, SLOT_FILTERS } from "./types";

/** `all`, a list (`2023,2024`) or a range (`2020-2024`) in URLs. */
const seasonsParam = z
  .union([
    z.literal("all"),
    z.array(z.number().int()),
    z.object({ from: z.number().int(), to: z.number().int() }),
  ])
  .default("all");
export type SeasonsFilter = z.infer<typeof seasonsParam>;

export function parseSeasons(raw: string | undefined): SeasonsFilter {
  if (raw === undefined || raw === "" || raw === "all") return "all";
  const range = raw.match(/^(\d{4})-(\d{4})$/);
  if (range) return { from: Number(range[1]), to: Number(range[2]) };
  const list = raw.split(",").map((s) => Number(s.trim()));
  if (list.some((n) => !Number.isInteger(n))) throw new Error(`invalid seasons: ${raw}`);
  return list;
}

/** Years selected by a seasons filter out of the years that exist. */
export function selectSeasons(filter: SeasonsFilter, available: readonly number[]): number[] {
  if (filter === "all") return [...available];
  if (Array.isArray(filter)) return available.filter((y) => filter.includes(y));
  return available.filter((y) => y >= filter.from && y <= filter.to);
}

const bool = z
  .union([z.boolean(), z.enum(["true", "false", "1", "0"])])
  .transform((v) => v === true || v === "true" || v === "1");
const csv = <T extends string>(values: readonly [T, ...T[]]) =>
  z
    .union([z.array(z.enum(values)), z.string()])
    .transform((v) => (Array.isArray(v) ? v : v.split(",").filter(Boolean)))
    .pipe(z.array(z.enum(values)));
const id = z.coerce.number().int().positive();

/**
 * The one typed, validated filter object every record query takes (doc §3.4). Accepts the raw query string
 * (everything is a string) and produces the normalized form used for SQL and as the cache key.
 */
export const recordQuerySchema = z.object({
  seasons: z
    .union([z.string(), seasonsParam])
    .transform((v) => (typeof v === "string" ? parseSeasons(v) : v))
    .default("all"),
  scope: z.enum(SCOPES).default("all"),
  median: z.enum(MEDIAN_MODES).default("default"),
  weeks: z
    .union([z.string(), z.object({ from: z.number().int(), to: z.number().int() })])
    .transform((v) => {
      if (typeof v !== "string") return v;
      const m = v.match(/^(\d{1,2})-(\d{1,2})$/);
      if (!m) throw new Error(`invalid weeks: ${v}`);
      return { from: Number(m[1]), to: Number(m[2]) };
    })
    .optional(),
  franchise: id.optional(),
  opponent: id.optional(),
  /** "Season max": keep only the best row per season (or per franchise). */
  onePer: z.enum(["season", "franchise"]).optional(),
  positions: csv(POSITIONS).optional(),
  slots: csv(SLOT_FILTERS).optional(),
  excludeZero: bool.default(false),
  /** Default true: weeks with no counted game (byes, eliminated teams) are left out. */
  countedOnly: bool.default(true),
  /** Player season records: sum a player across the teams he played for. */
  combineTeams: bool.default(false),
  minGames: z.coerce.number().int().min(1).max(40).optional(),
  limit: z.coerce.number().int().min(1).max(500).default(25),
  offset: z.coerce.number().int().min(0).default(0),
});

export type RecordQuery = z.output<typeof recordQuerySchema>;

/** Stable string for a normalized query (cache key / ETag material). */
export function queryKey(q: RecordQuery): string {
  const entries = Object.entries(q)
    .filter(([, v]) => v !== undefined)
    .sort(([a], [b]) => a.localeCompare(b));
  return JSON.stringify(entries);
}
