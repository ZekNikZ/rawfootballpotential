import { playerWeekPoints, player, leagueSeason, league as leagueTable, type Db } from "@rfp/db";
import { and, eq, inArray } from "@rfp/db";
import { FOREVER, hours, type FreshnessPolicy } from "../lib/raw-store";
import { log } from "../lib/log";
import type { SleeperClient } from "./client";
import { scoreProjection } from "./projections";
import { overridesForWeek } from "./rescore";

const chunk = <T>(arr: readonly T[], size: number): T[][] => {
  const out: T[][] = [];
  for (let i = 0; i < arr.length; i += size) out.push(arr.slice(i, i + size));
  return out;
};

/**
 * What each NFL player scored in each week under one league season's scoring, whether or not a team rostered him:
 * Sleeper's raw stat lines (the same endpoint as-played rescoring uses) scored with the league's settings and the
 * as-played overrides for that week. Rostered players come out equal to `player_week.points`, so unrostered ones
 * (a player dropped after a trade) can be valued on the same footing. One call per week; completed weeks are cached
 * forever. Only players already in the Sleeper dump are stored (team defenses and unknown ids are skipped), and only
 * non-zero lines.
 */
export async function syncPlayerPoints(
  db: Db,
  client: SleeperClient,
  opts: {
    leagueSeasonId: number;
    year: number;
    weeks: readonly number[];
    scoring: Readonly<Record<string, number>>;
    overrides: Parameters<typeof overridesForWeek>[0];
    policy: (week: number) => FreshnessPolicy;
  }
): Promise<number> {
  let stored = 0;
  for (const week of opts.weeks) {
    const stats = await client.stats(opts.year, week, opts.policy(week));
    if (!stats) continue;
    const scoring = { ...opts.scoring, ...overridesForWeek(opts.overrides, week) };
    const scored = new Map<string, number>();
    for (const [sleeperId, line] of Object.entries(stats)) {
      const points = scoreProjection(line, scoring);
      if (points !== 0) scored.set(sleeperId, points);
    }
    const ids = new Map<string, number>();
    for (const batch of chunk([...scored.keys()], 1000)) {
      const rows = await db
        .select({ id: player.id, sleeperId: player.sleeperId })
        .from(player)
        .where(inArray(player.sleeperId, batch));
      for (const r of rows) if (r.sleeperId) ids.set(r.sleeperId, r.id);
    }
    const values = [...scored]
      .filter(([sleeperId]) => ids.has(sleeperId))
      .map(([sleeperId, points]) => ({
        leagueSeasonId: opts.leagueSeasonId,
        week,
        playerId: ids.get(sleeperId)!,
        points,
      }));
    await db.transaction(async (tx) => {
      await tx
        .delete(playerWeekPoints)
        .where(
          and(
            eq(playerWeekPoints.leagueSeasonId, opts.leagueSeasonId),
            eq(playerWeekPoints.week, week)
          )
        );
      for (const batch of chunk(values, 2000)) await tx.insert(playerWeekPoints).values(batch);
    });
    stored += values.length;
  }
  log.info({ season: opts.year, weeks: opts.weeks.length, stored }, "player points synced");
  return stored;
}

/**
 * The scoring settings a season's players are scored with. A Sleeper season uses its own; an ESPN season has none
 * stored, so it uses the settings of the league's earliest Sleeper season (the leagues scored the same way before and
 * after the move: Sleeper's stat lines scored that way match ESPN's recorded points for about 93% of players to the
 * hundredth, correlation 0.998).
 */
export function scoringForSeason(
  season: { id: number; year: number; source: string; scoringSettings: Record<string, number> },
  sleeperSeasons: readonly { year: number; scoringSettings: Record<string, number> }[]
): Record<string, number> {
  if (season.source === "sleeper" || Object.keys(season.scoringSettings).length > 0)
    return season.scoringSettings;
  const first = [...sleeperSeasons]
    .filter((s) => Object.keys(s.scoringSettings).length > 0)
    .sort((a, b) => a.year - b.year)[0];
  return first?.scoringSettings ?? {};
}

/**
 * Backfill for every enabled season with Sleeper stat lines (`pnpm ingest points`), ESPN seasons included (their
 * players are scored with `scoringForSeason`); completed weeks are cached forever.
 */
export async function syncAllPlayerPoints(
  db: Db,
  client: SleeperClient,
  only?: readonly number[]
): Promise<void> {
  const seasons = await db
    .select({ s: leagueSeason, slug: leagueTable.slug })
    .from(leagueSeason)
    .innerJoin(leagueTable, eq(leagueTable.id, leagueSeason.leagueId));
  for (const { s } of seasons) {
    if (only && !only.includes(s.id)) continue;
    const complete = s.status === "complete";
    const lastWeek = complete ? s.lastWeek : (s.lastCompletedWeek ?? 0);
    const weeks = Array.from({ length: Math.max(0, lastWeek) }, (_, i) => i + 1);
    await syncPlayerPoints(db, client, {
      leagueSeasonId: s.id,
      year: s.year,
      weeks,
      scoring: scoringForSeason(
        s,
        seasons
          .filter((o) => o.s.leagueId === s.leagueId && o.s.source === "sleeper")
          .map((o) => o.s)
      ),
      overrides: s.source === "sleeper" ? s.scoringOverrides : [],
      policy: (w) => (complete || w < (s.lastCompletedWeek ?? 0) ? FOREVER : hours(3)),
    });
  }
}
