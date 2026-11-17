import { optimalLineup, playoffOdds, starterScoreSd, type Id, type OddsWeek } from "@rfp/core";
import { sql } from "@rfp/db";
import type { Db } from "@rfp/db";
import { matchups, seasonSummary, standings } from "./season-pages";

/** Sd of a typical full lineup's score, for a team whose starters are not known. */
const FALLBACK_SD = 25;
/** Weeks ahead (counting the current one as 0) whose projections are used as they are; later weeks blend in the team's average. */
const PROJECTION_WEEKS = 2;
const CACHE_MS = 30_000;

export interface TeamPlayoffOdds {
  /** 0-1. Exactly 1 / 0 only when `clinched` / `eliminated` (mathematical certainty). */
  probability: number;
  clinched: boolean;
  eliminated: boolean;
}
export type PlayoffOdds = Record<string, TeamPlayoffOdds>;

const cache = new Map<number, { at: number; value: PlayoffOdds | null }>();

const clamp = (v: number, lo: number, hi: number) => Math.min(hi, Math.max(lo, v));

interface LineupEntry {
  playerId: Id;
  position: string | null;
  slotKind: string;
  projected: number | null;
}

/**
 * The best lineup a manager could start in a week that has not been set yet, by projection: today's starters are not
 * carried forward (a starter on bye that week would drag the team's projection down), and IR players cannot start.
 */
function bestProjectedLineup(
  lineup: readonly LineupEntry[],
  slots: readonly string[]
): { mean: number; sd: number } | null {
  const players = lineup
    .filter((l) => l.slotKind !== "ir" && l.projected !== null)
    .map((l) => ({ id: l.playerId, points: l.projected as number, position: l.position }));
  if (slots.length === 0 || players.length === 0) return null;
  const best = optimalLineup(slots, players);
  const byId = new Map(lineup.map((l) => [l.playerId, l]));
  const positions = best.assignments.flatMap((a) =>
    a.playerId === null ? [] : [byId.get(a.playerId)?.position ?? null]
  );
  return { mean: best.points, sd: starterScoreSd(positions) };
}

/**
 * Playoff odds for a season still in its regular season, else null. Remaining games come from the stored schedule;
 * each team's score is drawn around its projected total (the live projection for the week being played, see `matchups`),
 * with a spread from its starters' positions. Doc "Playoff odds".
 */
export async function seasonPlayoffOdds(
  db: Db,
  seasonId: number,
  opts: { cache?: boolean } = {}
): Promise<PlayoffOdds | null> {
  const useCache = opts.cache ?? true;
  const hit = cache.get(seasonId);
  if (useCache && hit && Date.now() - hit.at < CACHE_MS) return hit.value;
  const value = await compute(db, seasonId);
  if (useCache) cache.set(seasonId, { at: Date.now(), value });
  return value;
}

async function compute(db: Db, seasonId: number): Promise<PlayoffOdds | null> {
  const summary = await seasonSummary(db, seasonId);
  if (!summary) return null;
  const regularWeeks = Number(summary.regular_season_weeks);
  const lastCompleted = Number(summary.last_completed_week);
  if (summary.status === "complete" || lastCompleted >= regularWeeks) return null;
  const current = lastCompleted + 1;

  const rows = (
    await db.execute<{
      team_season_id: number;
      wins: number;
      ties: number;
      pf: number;
    }>(sql`
      select ts.id as team_season_id, coalesce(tsw.wins, 0)::int as wins, coalesce(tsw.ties, 0)::int as ties,
             coalesce(tsw.pf, 0)::float8 as pf
      from team_season ts
      left join team_season_week tsw on tsw.team_season_id = ts.id
        and tsw.week = (select max(x.week) from team_season_week x where x.team_season_id = ts.id)
      where ts.league_season_id = ${seasonId}`)
  ).rows;
  if (rows.length === 0) return null;
  const average = new Map(
    rows.map((r) => [r.team_season_id, lastCompleted > 0 ? r.pf / lastCompleted : null])
  );

  const rosterSlots =
    (
      await db.execute<{ roster_slots: string[] | null }>(
        sql`select roster_slots from league_season where id = ${seasonId}`
      )
    ).rows[0]?.roster_slots ?? [];

  const weekNumbers = Array.from({ length: regularWeeks - current + 1 }, (_, i) => current + i);
  const weeks = await Promise.all(
    weekNumbers.map(async (wk): Promise<OddsWeek> => {
      const m = await matchups(db, seasonId, wk, true);
      const live = wk === current && m.weekStatus === "in_progress";
      const games = m.games.filter((g) => g.teams.length === 2);
      const teams = games.flatMap((g) =>
        g.teams.map((t) => {
          const starters = (t.lineup ?? []).filter((l) => l.slotKind === "starter");
          const fullSd = starters.length
            ? starterScoreSd(starters.map((s) => s.position))
            : FALLBACK_SD;
          const avg = average.get(t.teamSeasonId) ?? null;
          let mean: number;
          let sd = fullSd;
          if (t.isFinal) {
            mean = t.points;
            sd = 0;
          } else if (live && t.projected !== null) {
            // Points so far + the rest of the projection; the spread shrinks with the share of the lineup still to play.
            const original = starters.reduce((s, l) => s + (l.originalProjected ?? 0), 0);
            const left = original > 0 ? clamp((t.projected - t.points) / original, 0, 1) : 1;
            mean = t.projected;
            sd = fullSd * Math.sqrt(left);
          } else if (wk > current && t.lineup && bestProjectedLineup(t.lineup, rosterSlots)) {
            const best = bestProjectedLineup(t.lineup, rosterSlots)!;
            mean =
              wk - current > PROJECTION_WEEKS && avg !== null ? (best.mean + avg) / 2 : best.mean;
            sd = best.sd;
          } else if (t.projected !== null) {
            mean =
              wk - current > PROJECTION_WEEKS && avg !== null
                ? (t.projected + avg) / 2
                : t.projected;
          } else {
            mean = avg ?? 100;
          }
          return { id: t.teamSeasonId, mean, sd };
        })
      );
      return {
        week: wk,
        games: games.map((g) => [g.teams[0]!.teamSeasonId, g.teams[1]!.teamSeasonId] as const),
        teams,
      };
    })
  );

  // A week with no stored games means the schedule is not known yet: say nothing rather than guess.
  if (weeks.some((w) => w.games.length === 0)) return null;

  const out = playoffOdds({
    teams: rows.map((r) => ({
      id: r.team_season_id,
      wins: r.wins + 0.5 * r.ties,
      pf: r.pf,
    })),
    weeks,
    medianEnabled: Boolean(summary.median_enabled),
    playoffTeams: Number(summary.playoff_teams),
    seed: seasonId * 1000 + current,
  });
  return Object.fromEntries(
    out.map((o) => [
      String(o.teamId),
      { probability: o.probability, clinched: o.clinched, eliminated: o.eliminated },
    ])
  );
}

/** The standings page data, with playoff odds when the latest week of a season still in its regular season is shown. */
export async function standingsWithOdds(db: Db, seasonId: number, week: number | undefined) {
  const base = await standings(db, seasonId, week);
  const latest = base.week !== null && base.week === base.weeks.at(-1);
  const odds = latest && base.rows.length > 0 ? await seasonPlayoffOdds(db, seasonId) : null;
  return { ...base, playoffOdds: odds };
}
