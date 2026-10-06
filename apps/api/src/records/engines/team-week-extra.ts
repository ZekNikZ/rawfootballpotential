import { sql } from "@rfp/db";
import type { SQL } from "@rfp/db";
import { scopeCond, seasonCond, weeksCond, type RankedRow, type RunContext } from "../context";
import { rankRows } from "../rank";

/**
 * Team-week records from the "additional records" list (doc 4.5): luck, lineup regrets, projections, NFL byes.
 * Every record is a filter plus a ranked value over one candidate row per counted team-week; the shared base
 * carries what they need (weekly rank and field size, the opponent's score and projection, the bye/inactive stats).
 */
interface Spec {
  /** The ranked value. May fold a tie-break into the fraction; the displayed values live in `data`. */
  value: SQL;
  where?: SQL;
  /** Extra displayed values, merged over the base ones. */
  data?: SQL;
}

const rankText = sql`tw.week_rank || ' of ' || tw.n`;
const lost = sql`coalesce(tw.asleep_points_lost, 0)`;

const SPECS: Record<string, Spec> = {
  // Lost with a top score. Equal ranks: the higher score is the unluckier loss.
  "luck.unluckiest-loss": {
    value: sql`(tw.week_rank - tw.points / 100000.0)`,
    where: sql`tw.result = 'L' and tw.week_rank is not null`,
    data: sql`jsonb_build_object('rankText', ${rankText}, 'weekRank', tw.week_rank, 'fieldSize', tw.n)`,
  },
  // Won with a bottom score. Equal ranks: the lower score is the luckier win.
  "luck.luckiest-win": {
    value: sql`(tw.week_rank - tw.points / 100000.0)`,
    where: sql`tw.result = 'W' and tw.week_rank is not null`,
    data: sql`jsonb_build_object('rankText', ${rankText}, 'weekRank', tw.week_rank, 'fieldSize', tw.n)`,
  },
  // Losses the optimal lineup would have won (strictly: a tie is not a win).
  "shouldve-won": {
    value: sql`(tw.optimal_points - tw.points)`,
    where: sql`tw.result = 'L' and tw.optimal_points > tw.opp_points`,
    data: sql`jsonb_build_object('left', (tw.optimal_points - tw.points)::float8, 'potential', tw.optimal_points::float8)`,
  },
  // Median leagues: the head-to-head and the median game went opposite ways. Ranked by the gap to the median.
  "median.won-h2h-lost": {
    value: sql`(tw.points - tw.week_med)`,
    where: sql`tw.result = 'W' and tw.median_result = 'L'`,
    data: sql`jsonb_build_object('median', tw.week_med::float8, 'gap', (tw.points - tw.week_med)::float8)`,
  },
  "median.lost-h2h-won": {
    value: sql`(tw.points - tw.week_med)`,
    where: sql`tw.result = 'L' and tw.median_result = 'W'`,
    data: sql`jsonb_build_object('median', tw.week_med::float8, 'gap', (tw.points - tw.week_med)::float8)`,
  },
  // The first playoff loss of a team's season is its elimination from the title race.
  "contender.eliminated": {
    value: sql`(tw.optimal_points - tw.points)`,
    where: sql`tw.first_playoff_loss and tw.optimal_points > tw.opp_points`,
    data: sql`jsonb_build_object('left', (tw.optimal_points - tw.points)::float8, 'potential', tw.optimal_points::float8)`,
  },
  "heartbreak.playoff-loss": {
    value: sql`abs(tw.margin)`,
    where: sql`tw.result = 'L' and tw.game_type = 'playoffs'`,
  },
  "oneman.high": {
    value: sql`tw.top_player_share`,
    where: sql`tw.top_player_share is not null`,
    data: sql`jsonb_build_object('share', tw.top_player_share::float8, 'topPlayer', top.name, 'topPoints', top.points::float8)`,
  },
  "projection.boom": {
    value: sql`(tw.points - tw.projected_points)`,
    where: sql`tw.projected_points > 0`,
    data: sql`jsonb_build_object('projected', tw.projected_points::float8, 'delta', (tw.points - tw.projected_points)::float8)`,
  },
  "projection.bust": {
    value: sql`(tw.points - tw.projected_points)`,
    where: sql`tw.projected_points > 0`,
    data: sql`jsonb_build_object('projected', tw.projected_points::float8, 'delta', (tw.points - tw.projected_points)::float8)`,
  },
  // A win despite the largest projected deficit.
  "projection.upset": {
    value: sql`(tw.opp_projected - tw.projected_points)`,
    where: sql`tw.result = 'W' and tw.projected_points > 0 and tw.opp_projected > tw.projected_points`,
    data: sql`jsonb_build_object('projected', tw.projected_points::float8, 'opponentProjected', tw.opp_projected::float8,
                                 'deficit', (tw.opp_projected - tw.projected_points)::float8)`,
  },
  "era.score": {
    value: sql`tw.week_zscore`,
    where: sql`tw.week_zscore is not null`,
    data: sql`jsonb_build_object('zscore', tw.week_zscore::float8)`,
  },
  // Most starters on a bye or inactive; ties broken by the points that cost.
  "asleep.week": {
    value: sql`(tw.asleep_starters + ${lost} / 1000.0)`,
    where: sql`tw.asleep_starters > 0`,
    data: sql`jsonb_build_object('deadStarters', tw.asleep_starters, 'byeStarters', tw.bye_starters, 'pointsLost', ${lost}::float8)`,
  },
  "asleep.lost-week": {
    value: lost,
    where: sql`${lost} > 0`,
    data: sql`jsonb_build_object('deadStarters', tw.asleep_starters, 'byeStarters', tw.bye_starters, 'pointsLost', ${lost}::float8)`,
  },
  // Lost, but the best live bench players in the dead slots would have won it.
  "asleep.blunder": {
    value: lost,
    where: sql`tw.result = 'L' and ${lost} > 0 and tw.points + ${lost} > tw.opp_points`,
    data: sql`jsonb_build_object('deadStarters', tw.asleep_starters, 'byeStarters', tw.bye_starters, 'pointsLost', ${lost}::float8,
                                 'flipBy', (tw.points + ${lost} - tw.opp_points)::float8)`,
  },
  // The highest score with at least two starters on bye.
  "bye.survivor": {
    value: sql`tw.points`,
    where: sql`tw.bye_starters >= 2`,
    data: sql`jsonb_build_object('byeStarters', tw.bye_starters)`,
  },
  // The most starters on bye in a game the team still won; ties go to the higher score.
  "bye.heaviest": {
    value: sql`(tw.bye_starters + tw.points / 10000.0)`,
    where: sql`tw.result = 'W' and tw.bye_starters >= 1`,
    data: sql`jsonb_build_object('byeStarters', tw.bye_starters)`,
  },
};

export const EXTRA_TEAM_WEEK_IDS: readonly string[] = Object.keys(SPECS);

/** The base rows (rec_team_week plus what the specs need), before scope / week / franchise filters. */
export function teamWeekBase(ctx: RunContext): SQL {
  return sql`
    w as (
      select tw.*,
        count(*) over (partition by tw.league_season_id, tw.week) as n,
        otw.points as opp_points,
        ots.franchise_id as opp_franchise_id,
        os.projected_points as opp_projected,
        mg.result as median_result, mg.points_against as week_med,
        s.asleep_starters, s.bye_starters, s.asleep_points_lost,
        (tw.week = min(tw.week) filter (where tw.result = 'L' and tw.game_type = 'playoffs')
                     over (partition by tw.team_season_id)) as first_playoff_loss
      from rec_team_week tw
      left join team_week otw on otw.team_season_id = tw.opponent_team_season_id and otw.week = tw.week
      left join team_season ots on ots.id = tw.opponent_team_season_id
      left join team_week_stats os on os.team_week_id = otw.id
      left join team_week_stats s on s.team_week_id = tw.team_week_id
      left join rec_game_result mg on mg.team_season_id = tw.team_season_id and mg.week = tw.week and mg.kind = 'median'
      where ${seasonCond(sql`tw.league_season_id`, ctx.seasonIds)}
    )`;
}

export async function extraTeamWeekRecord(ctx: RunContext): Promise<RankedRow[]> {
  const spec = SPECS[ctx.def.id];
  if (!spec) throw new Error(`no extra team-week spec for ${ctx.def.id}`);
  const { q } = ctx;
  const inner = sql`
    with ${teamWeekBase(ctx)}
    select
      round((${spec.value})::numeric, 5)::float8 as sort_value,
      tw.season,
      tw.franchise_id,
      jsonb_build_object(
        'season', tw.season, 'week', tw.week,
        'points', tw.points::float8, 'opponentPoints', tw.opp_points::float8, 'margin', tw.margin::float8
      ) || coalesce(${spec.data ?? sql`null::jsonb`}, '{}'::jsonb) as data,
      jsonb_build_object(
        'franchiseId', tw.franchise_id, 'teamSeasonId', tw.team_season_id,
        'opponentTeamSeasonId', tw.opponent_team_season_id, 'opponentFranchiseId', tw.opp_franchise_id,
        'matchupId', tw.matchup_id, 'leagueSeasonId', tw.league_season_id, 'season', tw.season, 'week', tw.week
      ) as refs,
      (ls.status <> 'complete') as in_progress,
      concat(tw.season, '-', lpad(tw.week::text, 2, '0'), '-', lpad(tw.team_season_id::text, 6, '0')) as tie_key
    from w tw
    join league_season ls on ls.id = tw.league_season_id
    ${
      ctx.def.id === "oneman.high"
        ? sql`left join lateral (
      select p.full_name as name, pw.points
      from player_week pw join player p on p.id = pw.player_id
      where pw.team_week_id = tw.team_week_id and pw.slot_kind = 'starter' and pw.points is not null
      order by pw.points desc, p.full_name limit 1
    ) top on true`
        : sql``
    }
    where ${scopeCond(sql`tw.game_type`, q.scope)}
      and ${weeksCond(sql`tw.week`, q.weeks)}
      and ${q.franchise ? sql`tw.franchise_id = ${q.franchise}` : sql`true`}
      and ${q.opponent ? sql`tw.opp_franchise_id = ${q.opponent}` : sql`true`}
      and ${spec.where ?? sql`true`}`;
  return rankRows(ctx, inner);
}
