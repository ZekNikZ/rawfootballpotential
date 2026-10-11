import { sql } from "@rfp/db";
import type { Db } from "@rfp/db";
import { seasonById } from "../lib/leagues";
import {
  describeTeams,
  recordsBroken,
  runSpec,
  topHighlights,
  type Highlight,
  type HighlightSpec,
  type TeamRef,
} from "./highlights";

/** The awards of a season recap: the top row of each record read over that season only. */
export const RECAP_SPECS: readonly HighlightSpec[] = [
  { id: "season.player.high", label: "Season MVP" },
  { id: "season.pf.high", label: "Most points scored" },
  { id: "season.pf.high", label: "Fewest points scored", flip: true },
  { id: "season.top-scorer", label: "Most weeks as the top scorer" },
  { id: "season.iq.high", label: "Best lineup management" },
  { id: "season.luck.high", label: "Luckiest team" },
  { id: "season.luck.high", label: "Unluckiest team", flip: true },
  { id: "season.sos", label: "Toughest schedule" },
  { id: "season.sos", label: "Easiest schedule", flip: true },
  { id: "season.score.stddev", label: "Boom-or-bust team" },
  { id: "season.score.stddev", label: "Steadiest team", flip: true },
  { id: "score.high", label: "Highest score of the year" },
  { id: "blowout", label: "Biggest blowout" },
  { id: "blowout", label: "Narrowest win", flip: true },
  { id: "trade.best.est", label: "Best trade" },
  { id: "pickup.best", label: "Best waiver pickup" },
  { id: "draft.steal", label: "Biggest draft steal" },
];

export interface Mover {
  team: TeamRef;
  from: number;
  to: number;
  teams: number;
}

export interface Championship {
  winner: TeamRef;
  loser: TeamRef | null;
  winnerPoints: number;
  loserPoints: number;
  week: number;
}

/**
 * A finished season in review: the title game, an award for each record's leader that year, who climbed and fell the
 * most in the final standings, the league records set that year, and season totals.
 */
export async function seasonRecap(db: Db, seasonId: number) {
  const { season, league } = await seasonById(db, seasonId);
  const year = season.year;
  const one = { seasons: String(year), limit: 5 };

  const awards = (
    await Promise.all(
      RECAP_SPECS.map(async (spec) => {
        const res = await runSpec(db, league.id, spec, one);
        return topHighlights(res, spec, 1)
          .slice(0, 3)
          .filter((h) => h.rank === 1);
      })
    )
  ).filter((h): h is Highlight[] => h.length > 0);

  const moves = (
    await db.execute<{
      team_season_id: number;
      cur: number;
      prev: number;
      teams: number;
    }>(sql`
      select cur.team_season_id, cur.final_place as cur, prev.final_place as prev, cur.team_count as teams
      from rec_team_season cur
      join rec_team_season prev
        on prev.franchise_id = cur.franchise_id and prev.season = cur.season - 1 and prev.league_id = cur.league_id
      where cur.league_season_id = ${seasonId} and cur.final_place is not null and prev.final_place is not null`)
  ).rows;

  const title = (
    await db.execute<{
      team_season_id: number;
      opponent_team_season_id: number | null;
      pf: number;
      pa: number;
      week: number;
    }>(sql`
      select gr.team_season_id, gr.opponent_team_season_id, gr.points_for::float8 as pf,
             gr.points_against::float8 as pa, gr.week
      from rec_game_result gr join rec_matchup m on m.matchup_id = gr.matchup_id
      where gr.league_season_id = ${seasonId} and gr.kind = 'h2h' and m.is_championship and gr.result = 'W'
      order by gr.week desc limit 1`)
  ).rows[0];

  const totals = (
    await db.execute<{
      games: number;
      avg_score: number | null;
      total_points: number | null;
      trades: number;
      claims: number;
    }>(sql`
      select (select count(*) from rec_team_week tw where tw.league_season_id = ${seasonId} and tw.span_weeks = 1
                and tw.opponent_team_season_id is not null)::int / 2 as games,
             (select avg(points)::float8 from rec_team_week tw where tw.league_season_id = ${seasonId}
                and tw.span_weeks = 1) as avg_score,
             (select sum(points)::float8 from rec_team_week tw where tw.league_season_id = ${seasonId}) as total_points,
             (select count(*) from "transaction" x where x.league_season_id = ${seasonId}
                and x.type = 'trade' and x.status = 'complete')::int as trades,
             (select count(*) from "transaction" x where x.league_season_id = ${seasonId}
                and x.type = 'waiver' and x.status = 'complete')::int as claims`)
  ).rows[0];

  const teamIds = [
    ...moves.map((m) => Number(m.team_season_id)),
    ...(title ? [Number(title.team_season_id), Number(title.opponent_team_season_id)] : []),
  ].filter((n) => Number.isFinite(n) && n > 0);
  const teams = await describeTeams(db, teamIds);
  const mover = (pick: (typeof moves)[number] | undefined): Mover | null => {
    const team = pick ? teams.get(Number(pick.team_season_id)) : undefined;
    return pick && team
      ? { team, from: Number(pick.prev), to: Number(pick.cur), teams: Number(pick.teams) }
      : null;
  };
  const gain = (m: (typeof moves)[number]) => Number(m.prev) - Number(m.cur);
  const byGain = [...moves].sort((a, b) => gain(b) - gain(a));
  const climber = byGain[0] && gain(byGain[0]) > 0 ? byGain[0] : undefined;
  const faller = byGain.at(-1) && gain(byGain.at(-1)!) < 0 ? byGain.at(-1) : undefined;

  const winner = title ? teams.get(Number(title.team_season_id)) : undefined;
  const championship: Championship | null =
    title && winner
      ? {
          winner,
          loser: teams.get(Number(title.opponent_team_season_id)) ?? null,
          winnerPoints: Number(title.pf),
          loserPoints: Number(title.pa),
          week: Number(title.week),
        }
      : null;

  return {
    seasonId,
    season: year,
    status: season.status,
    championship,
    awards: awards.flat(),
    mostImproved: mover(climber),
    biggestFall: mover(faller),
    recordsSet: await recordsBroken(db, league.id, year, null, 3),
    totals: {
      games: Number(totals?.games ?? 0),
      averageScore: totals?.avg_score == null ? null : Number(totals.avg_score),
      totalPoints: totals?.total_points == null ? null : Number(totals.total_points),
      trades: Number(totals?.trades ?? 0),
      claims: Number(totals?.claims ?? 0),
    },
  };
}
