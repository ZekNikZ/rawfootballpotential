-- Version history 2.3.0: league-wide scoring records. Idempotent.
INSERT INTO "site_config" ("key", "value") VALUES ('changelog', $cl$[{"date":"2026-10-19T03:34:37.811Z","title":"League-wide scoring records","version":"2.3.0","description":"**Records**\n- League scoring: the points every team scored added together for a whole season or a single week, and the average per team-game.\n- Three versions of each: scored points, bench points and total points (everything every rostered player scored).\n- Season totals show finished seasons only; season averages and the weekly records include the current season.\n- Choose regular season, playoffs or all games with the scope switcher (regular season to start). The two-week 2020 playoff games are left out."}]$cl$::jsonb)
ON CONFLICT ("key") DO UPDATE
  SET "value" = EXCLUDED."value" || "site_config"."value", "updated_at" = now()
  WHERE NOT ("site_config"."value" @> '[{"version": "2.3.0"}]'::jsonb);
