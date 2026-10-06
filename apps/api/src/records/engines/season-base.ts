import { sql } from "@rfp/db";
import type { SQL } from "@rfp/db";
import { medianCond, scopeCond, seasonCond, weeksCond, type RunContext } from "../context";

/** Minimum games to qualify: the record's qualifier, relaxed to 1 when the scope is a short postseason slice. */
export function minGames(ctx: RunContext): number {
  if (ctx.q.minGames) return ctx.q.minGames;
  const base = ctx.def.qualifier?.minGames ?? 1;
  return ctx.q.scope === "all" || ctx.q.scope === "regular" ? base : 1;
}

/**
 * One row per team season in the selected seasons, with its totals inside the active scope / weeks / median
 * filters. Every season-grain and career-grain record builds on this.
 *
 *   pf, pa, games                 counted head-to-head games (PF/PA never include median games)
 *   optimal, pts_player           optimal points and actual points over team-weeks that have player data
 *   perfect                       perfect-lineup count
 *   w, l, t                       record under the median filter
 */
export function seasonStatsCte(ctx: RunContext): SQL {
  const { q } = ctx;
  return sql`
    ss as (
      select
        ts.team_season_id, ts.franchise_id, ts.league_season_id, ts.season,
        ts.season_status, ts.made_playoffs, ts.final_place, ts.team_count,
        coalesce(a.pf, 0) as pf, coalesce(a.pa, 0) as pa, coalesce(a.games, 0) as games,
        a.optimal, a.pts_player, coalesce(a.perfect, 0) as perfect, coalesce(a.player_games, 0) as player_games,
        coalesce(g.w, 0) as w, coalesce(g.l, 0) as l, coalesce(g.t, 0) as t
      from rec_team_season ts
      left join (
        select tw.team_season_id,
               sum(tw.points) as pf, sum(otw.points) as pa, count(*) as games,
               sum(tw.optimal_points) as optimal,
               sum(tw.points) filter (where tw.optimal_points is not null) as pts_player,
               count(*) filter (where tw.optimal_points is not null) as player_games,
               count(*) filter (where tw.is_perfect) as perfect
        from rec_team_week tw
        left join team_week otw on otw.team_season_id = tw.opponent_team_season_id and otw.week = tw.week
        where ${seasonCond(sql`tw.league_season_id`, ctx.seasonIds)}
          and ${scopeCond(sql`tw.game_type`, q.scope)}
          and ${weeksCond(sql`tw.week`, q.weeks)}
        group by tw.team_season_id
      ) a on a.team_season_id = ts.team_season_id
      left join (
        select gr.team_season_id,
               count(*) filter (where gr.result = 'W') as w,
               count(*) filter (where gr.result = 'L') as l,
               count(*) filter (where gr.result = 'T') as t
        from rec_game_result gr
        where ${seasonCond(sql`gr.league_season_id`, ctx.seasonIds)}
          and ${scopeCond(sql`gr.game_type`, q.scope)}
          and ${weeksCond(sql`gr.week`, q.weeks)}
          and ${medianCond(sql`gr.kind`, sql`gr.median_enabled`, q.median)}
        group by gr.team_season_id
      ) g on g.team_season_id = ts.team_season_id
      where ${seasonCond(sql`ts.league_season_id`, ctx.seasonIds)}
        and ${q.franchise ? sql`ts.franchise_id = ${q.franchise}` : sql`true`}
    )`;
}

export const winPctExpr = sql`((w + 0.5 * t) / nullif(w + l + t, 0))`;
