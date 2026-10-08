-- Sleeper sends custom team avatars as full URLs; the sync prefixed the CDN base to those too, giving
-- "https://sleepercdn.com/avatars/https://...". Strip the doubled prefix. Idempotent: only matching rows change.
UPDATE "team_season" SET "avatar" = substring("avatar" from '^https://sleepercdn\.com/avatars/(https?://.*)$')
WHERE "avatar" ~ '^https://sleepercdn\.com/avatars/https?://';
UPDATE "manager" SET "avatar" = substring("avatar" from '^https://sleepercdn\.com/avatars/(https?://.*)$')
WHERE "avatar" ~ '^https://sleepercdn\.com/avatars/https?://';
