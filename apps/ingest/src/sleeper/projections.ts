import type { Db } from "@rfp/db";
import { z } from "zod";
import { RawStore, FOREVER, hours, type FreshnessPolicy } from "../lib/raw-store";
import type { SleeperClient } from "./client";

export type WeekProjections = Map<string, number>;

/**
 * Raw projections are stat lines; the league's scoring settings turn them into points.
 * `pts_*` and adp fields in the payload are not scoring stats and are ignored (they have no scoring key).
 */
export function scoreProjection(
  stats: Record<string, number>,
  scoring: Record<string, number>
): number {
  let total = 0;
  for (const [stat, value] of Object.entries(stats)) total += value * (scoring[stat] ?? 0);
  return Math.round(total * 1000) / 1000;
}

const legacyCache = z.object({ projections: z.record(z.string(), z.number()) });

/**
 * Projected points per player for each requested week. A projection imported from the legacy Mongo cache
 * (what the old site showed) wins; otherwise it is computed from Sleeper's raw projections.
 */
export async function loadProjections(
  db: Db,
  client: SleeperClient,
  opts: {
    season: number;
    weeks: readonly number[];
    scoring: Record<string, number>;
    /** Legacy league id (`L-Redraft-2024`) for the imported cache lookup. */
    legacyLeagueId: string | null;
    policy: FreshnessPolicy;
  }
): Promise<Map<number, WeekProjections>> {
  const store = new RawStore(db);
  const out = new Map<number, WeekProjections>();
  for (const week of opts.weeks) {
    if (opts.legacyLeagueId) {
      const hit = await store.latest("sleeper", "mongo/projections-cache", {
        leagueId: opts.legacyLeagueId,
        year: opts.season,
        week,
      });
      const parsed = hit ? legacyCache.safeParse(hit.payload) : null;
      if (parsed?.success) {
        out.set(week, new Map(Object.entries(parsed.data.projections)));
        continue;
      }
    }
    const raw = await client.projections(opts.season, week, opts.policy);
    if (!raw) continue;
    const map: WeekProjections = new Map();
    for (const p of raw) if (p.stats) map.set(p.player_id, scoreProjection(p.stats, opts.scoring));
    out.set(week, map);
  }
  return out;
}

export const PROJECTION_POLICY = { completed: FOREVER, active: hours(6) };
