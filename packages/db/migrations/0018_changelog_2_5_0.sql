-- Version history 2.5.0: playoff odds on the standings. Idempotent.
INSERT INTO "site_config" ("key", "value") VALUES ('changelog', $cl$[{"date":"2026-11-17T12:00:00.000Z","title":"Playoff odds","version":"2.5.0","description":"**Standings**\n- New Playoffs column while the regular season is on: each team's chance of making the playoffs, simulated from the remaining schedule, projected scores, the league median and the tiebreakers.\n- 100% (✓) means clinched and 0% (✗) means eliminated: only shown when it is mathematically certain.\n- Once the regular season ends the column shows who made the playoffs."}]$cl$::jsonb)
ON CONFLICT ("key") DO UPDATE
  SET "value" = EXCLUDED."value" || "site_config"."value", "updated_at" = now()
  WHERE NOT ("site_config"."value" @> '[{"version": "2.5.0"}]'::jsonb);
