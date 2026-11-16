-- Version history 2.4.0: live projections. Idempotent.
INSERT INTO "site_config" ("key", "value") VALUES ('changelog', $cl$[{"date":"2026-11-16T12:00:00.000Z","title":"Live projections","version":"2.4.0","description":"**Matchups**\n- Projected scores for live games now update as the games are played: players who have finished count what they scored, players in a game underway count their points so far plus the rest of their projection (by time left), and games not started count the full projection.\n- The same live projection shows on the home page tiles, in the week's projected median, and for each player in the lineups.\n- A player's projection is green or red when it has moved more than a point above or below the original.\n- Finished games and weeks are unchanged."}]$cl$::jsonb)
ON CONFLICT ("key") DO UPDATE
  SET "value" = EXCLUDED."value" || "site_config"."value", "updated_at" = now()
  WHERE NOT ("site_config"."value" @> '[{"version": "2.4.0"}]'::jsonb);
