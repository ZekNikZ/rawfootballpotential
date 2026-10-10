-- Version history 2.1.0: the ESPN seasons are now scored with the 2022 Sleeper settings (not roster-only points).
-- Idempotent: replace() changes nothing once the old line is gone (or if the entry was edited in the admin).
UPDATE "site_config"
SET "value" = (
      SELECT jsonb_agg(
               CASE WHEN e.elem->>'version' = '2.1.0'
                    THEN jsonb_set(e.elem, '{description}',
                           to_jsonb(replace(e.elem->>'description', $t$- ESPN seasons (2020 and 2021) have no stats, so they count only the points a player scored while on a roster. They are labelled "roster-only points".$t$, $t$- ESPN seasons (2020 and 2021) are valued too, using Sleeper's stats scored with the 2022 settings, which match ESPN's recorded points for nearly every player.$t$)))
                    ELSE e.elem END
               ORDER BY e.ord)
      FROM jsonb_array_elements("site_config"."value") WITH ORDINALITY AS e(elem, ord)
    ),
    "updated_at" = now()
WHERE "key" = 'changelog' AND "value" @> '[{"version": "2.1.0"}]'::jsonb;
