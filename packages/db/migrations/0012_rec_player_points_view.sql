-- What every player scored each completed week of an enabled season, rostered or not (player_week_points).
-- week_type is 'regular' before the playoffs start and 'postseason' from then on (a player is not tied to one game,
-- so the record scope filter maps regular -> regular and every other scope except "all" -> postseason).
CREATE VIEW "rec_player_points" AS
SELECT
  pp.league_season_id,
  ls.league_id,
  ls.year AS season,
  pp.week,
  pp.player_id,
  pp.points,
  CASE WHEN ls.playoff_week_start IS NOT NULL AND pp.week >= ls.playoff_week_start
       THEN 'postseason' ELSE 'regular' END AS week_type
FROM player_week_points pp
JOIN league_season ls ON ls.id = pp.league_season_id AND ls.enabled
JOIN league_season_week lsw
  ON lsw.league_season_id = pp.league_season_id AND lsw.week = pp.week AND lsw.status = 'complete';
