-- Games that span several scoring periods (ESPN 2020's two-week playoff matchups) are marked, so single-game and
-- lineup records can leave them out. The new column goes last, which CREATE OR REPLACE VIEW allows; rec_team_week
-- is re-created so its "SELECT *" picks it up.
CREATE OR REPLACE VIEW "rec_team_week_all" AS
SELECT
  tw.id                       AS team_week_id,
  tw.league_season_id,
  ls.league_id,
  ls.year                     AS season,
  tw.week,
  tw.team_season_id,
  t.franchise_id,
  tw.matchup_id,
  tw.opponent_team_season_id,
  tw.counts,
  COALESCE(m.game_type, 'none'::game_type) AS game_type,
  m.bracket,
  m.placement_at_stake,
  m.is_championship,
  tw.points,
  tw.result,
  tw.margin,
  s.optimal_points,
  s.bench_points,
  s.ir_points,
  s.projected_points,
  s.lineup_iq,
  s.is_perfect,
  s.week_median,
  s.week_mean,
  s.week_rank,
  s.week_zscore,
  s.allplay_w,
  s.allplay_l,
  s.allplay_t,
  s.top_player_share,
  COALESCE(m.span_weeks, 1)   AS span_weeks
FROM team_week tw
JOIN league_season ls ON ls.id = tw.league_season_id AND ls.enabled
JOIN league_season_week lsw
  ON lsw.league_season_id = tw.league_season_id AND lsw.week = tw.week AND lsw.status = 'complete'
JOIN team_season t ON t.id = tw.team_season_id
LEFT JOIN matchup m ON m.id = tw.matchup_id
LEFT JOIN team_week_stats s ON s.team_week_id = tw.id
WHERE tw.is_final;
--> statement-breakpoint

CREATE OR REPLACE VIEW "rec_team_week" AS
SELECT * FROM "rec_team_week_all" WHERE counts;
