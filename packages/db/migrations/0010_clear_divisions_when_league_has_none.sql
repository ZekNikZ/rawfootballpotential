-- Sleeper keeps each roster's old `division` number after a league turns divisions off (league setting
-- `divisions` = 0), and the sync showed those stale numbers as divisions. Clear them for every Sleeper
-- season whose latest saved league response says divisions are off. Idempotent: only rows still set change,
-- and a season with no saved response (or no `divisions` key) is left alone.
UPDATE "team_season" ts SET "division" = NULL
FROM "league_season" ls
WHERE ls."id" = ts."league_season_id"
  AND ts."division" IS NOT NULL
  AND (
    SELECT (rp."payload"->'settings'->>'divisions')::int
    FROM "raw_payload" rp
    WHERE rp."endpoint" = 'league' AND rp."params"->>'id' = ls."external_id" AND rp."payload" IS NOT NULL
    ORDER BY rp."id" DESC LIMIT 1
  ) = 0;
