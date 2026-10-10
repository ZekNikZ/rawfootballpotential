import { sql } from "@rfp/db";
import type { SQL } from "@rfp/db";

/**
 * The last week a player can still score for a team in the stint containing `week` (null when he never made a
 * roster): the stint's last week, plus the week he was dropped or traded when he was still in that week's lineup
 * snapshot.
 */
export const stintEnd = (team: SQL, player: SQL, week: SQL): SQL => sql`(
  select t.to_week + (case when t.left_via in ('drop', 'trade', 'commissioner') then 1 else 0 end) from player_tenure t
  where t.team_season_id = ${team} and t.player_id = ${player} and t.from_week <= ${week} and t.to_week >= ${week}
  order by t.from_week desc limit 1)`;

/**
 * Points a player scored for `team` from `week` to the end of that stint (counted team-weeks only; the stint is within
 * one team season, so never past the season). A starter's points count in full, a bench / IR / taxi player's at
 * `benchWeight` (0 = starters only, 0.5 = half). Without a stint the player is valued at 0.
 */
export const pointsSince = (
  team: SQL,
  player: SQL,
  week: SQL,
  benchWeight: number,
  scope?: SQL
): SQL => sql`(
  select coalesce(sum(case when pw.slot_kind = 'starter' then pw.points else ${benchWeight} * pw.points end), 0)
  from rec_player_week pw
  where pw.team_season_id = ${team} and pw.player_id = ${player} and pw.counts and pw.points is not null
    ${scope ? sql`and ${scope}` : sql``}
    and pw.week between ${week} and coalesce(${stintEnd(team, player, week)}, ${week} - 1))`;
