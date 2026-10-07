-- Record views (docs/records-architecture.md §3.3). Every record query reads through these:
--   * completed weeks only (league_season_week.status = 'complete')
--   * final rows only (team_week.is_final), enabled seasons only
--   * rec_* (no suffix) = counted rows only; *_all variants keep no-game weeks ("scores that didn't count").
-- Views live in a custom migration because drizzle-kit can't express them.

CREATE VIEW "rec_team_week_all" AS
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
  s.top_player_share
FROM team_week tw
JOIN league_season ls ON ls.id = tw.league_season_id AND ls.enabled
JOIN league_season_week lsw
  ON lsw.league_season_id = tw.league_season_id AND lsw.week = tw.week AND lsw.status = 'complete'
JOIN team_season t ON t.id = tw.team_season_id
LEFT JOIN matchup m ON m.id = tw.matchup_id
LEFT JOIN team_week_stats s ON s.team_week_id = tw.id
WHERE tw.is_final;
--> statement-breakpoint

CREATE VIEW "rec_team_week" AS
SELECT * FROM "rec_team_week_all" WHERE counts;
--> statement-breakpoint

CREATE VIEW "rec_game_result" AS
SELECT
  gr.team_season_id,
  gr.franchise_id,
  gr.league_season_id,
  ls.league_id,
  ls.year                     AS season,
  ls.median_enabled,
  gr.week,
  gr.seq,
  gr.kind,
  gr.matchup_id,
  gr.opponent_team_season_id,
  gr.opponent_franchise_id,
  gr.result,
  gr.game_type,
  gr.points_for,
  gr.points_against
FROM game_result gr
JOIN league_season ls ON ls.id = gr.league_season_id AND ls.enabled
JOIN league_season_week lsw
  ON lsw.league_season_id = gr.league_season_id AND lsw.week = gr.week AND lsw.status = 'complete';
--> statement-breakpoint

CREATE VIEW "rec_matchup" AS
SELECT
  m.id                        AS matchup_id,
  m.league_season_id,
  ls.league_id,
  ls.year                     AS season,
  m.week,
  m.game_type,
  m.bracket,
  m.bracket_round,
  m.placement_at_stake,
  m.is_championship,
  a.team_season_id            AS team_a_season_id,
  ta.franchise_id             AS franchise_a_id,
  a.points                    AS points_a,
  b.team_season_id            AS team_b_season_id,
  tb.franchise_id             AS franchise_b_id,
  b.points                    AS points_b,
  a.points + b.points         AS combined_points,
  abs(a.points - b.points)    AS margin
FROM matchup m
JOIN league_season ls ON ls.id = m.league_season_id AND ls.enabled
JOIN league_season_week lsw
  ON lsw.league_season_id = m.league_season_id AND lsw.week = m.week AND lsw.status = 'complete'
JOIN team_week a ON a.matchup_id = m.id AND a.is_final
JOIN team_week b ON b.matchup_id = m.id AND b.is_final AND b.team_season_id > a.team_season_id
JOIN team_season ta ON ta.id = a.team_season_id
JOIN team_season tb ON tb.id = b.team_season_id
WHERE a.counts AND b.counts;
--> statement-breakpoint

CREATE VIEW "rec_player_week" AS
SELECT
  pw.team_week_id,
  pw.player_id,
  tw.league_season_id,
  tw.league_id,
  tw.season,
  tw.week,
  tw.team_season_id,
  tw.franchise_id,
  tw.counts,
  tw.game_type,
  pw.slot,
  pw.slot_kind,
  pw.points,
  pw.projected_points,
  pw.position,
  pw.eligible_positions,
  pw.nfl_team,
  pw.nfl_game_id,
  pw.nfl_status
FROM player_week pw
JOIN rec_team_week_all tw ON tw.team_week_id = pw.team_week_id;
--> statement-breakpoint

CREATE VIEW "rec_team_season" AS
SELECT
  t.id                        AS team_season_id,
  t.league_season_id,
  ls.league_id,
  ls.year                     AS season,
  t.franchise_id,
  t.seed,
  t.final_place,
  t.made_playoffs,
  ls.team_count,
  ls.status                   AS season_status,
  (ls.status = 'complete')    AS season_complete
FROM team_season t
JOIN league_season ls ON ls.id = t.league_season_id AND ls.enabled;
--> statement-breakpoint

-- Successful transactions in completed weeks. Week 0 (pre-season) counts once any week is complete.
CREATE VIEW "rec_transaction" AS
SELECT
  x.id                        AS transaction_id,
  x.league_season_id,
  ls.league_id,
  ls.year                     AS season,
  x.type,
  x.week,
  x.executed_at,
  x.creator_team_season_id
FROM "transaction" x
JOIN league_season ls ON ls.id = x.league_season_id AND ls.enabled
WHERE x.status = 'complete' AND x.week <= ls.last_completed_week;
--> statement-breakpoint

CREATE VIEW "rec_transaction_item" AS
SELECT
  i.id                        AS item_id,
  x.transaction_id,
  x.league_season_id,
  x.league_id,
  x.season,
  x.type,
  x.week,
  x.executed_at,
  i.kind,
  i.direction,
  i.player_id,
  i.pick_season,
  i.pick_round,
  i.pick_original_franchise_id,
  i.amount,
  i.faab_bid,
  i.from_team_season_id,
  i.to_team_season_id
FROM transaction_item i
JOIN rec_transaction x ON x.transaction_id = i.transaction_id;
--> statement-breakpoint

CREATE VIEW "rec_draft_pick" AS
SELECT
  dp.draft_id,
  dp.pick_no,
  dp.round,
  dp.slot,
  dp.team_season_id,
  t.franchise_id,
  dp.player_id,
  dp.amount,
  dp.is_keeper,
  d.kind                      AS draft_kind,
  d.type                      AS draft_type,
  d.league_season_id,
  ls.league_id,
  ls.year                     AS season
FROM draft_pick dp
JOIN draft d ON d.id = dp.draft_id AND d.status = 'complete'
JOIN league_season ls ON ls.id = d.league_season_id AND ls.enabled
JOIN team_season t ON t.id = dp.team_season_id;
