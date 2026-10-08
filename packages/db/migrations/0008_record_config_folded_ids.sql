-- Records that were folded into a sortable record (the old "lowest" / "fewest" / "bust" version is now the same
-- record sorted the other way). Admin settings for the removed ids would no longer match anything.
-- A removed id that was featured features the surviving record; show/hide and order are not carried over (hiding
-- "lowest score" must not hide the merged record). Idempotent: the removed rows are deleted.
INSERT INTO "record_config" ("league_id", "record_id", "visible", "sort_order", "featured")
SELECT rc."league_id", m."new_id", true, 0, true
FROM "record_config" rc
JOIN (VALUES
    ('score.low', 'score.high'),
    ('narrow-win', 'blowout'),
    ('teamwide.low', 'teamwide.high'),
    ('bench.low', 'bench.high'),
    ('potential.low', 'potential.high'),
    ('actual.low', 'actual.high'),
    ('ratio.low', 'ratio.high'),
    ('player.roster.low', 'player.roster.high'),
    ('player.starter.low', 'player.starter.high'),
    ('player.bench.low', 'player.bench.high'),
    ('season.pf.low', 'season.pf.high'),
    ('season.pa.low', 'season.pa.high'),
    ('season.winpct.low', 'season.winpct.high'),
    ('season.iq.low', 'season.iq.high'),
    ('season.trades.fewest', 'season.trades.most'),
    ('season.claims.fewest', 'season.claims.most'),
    ('season.faab.least', 'season.faab.most'),
    ('season.retention.low', 'season.retention.high'),
    ('season.luck.low', 'season.luck.high'),
    ('season.schedule.worst', 'season.schedule.best'),
    ('draft.class.worst', 'draft.class.best'),
    ('draft.bust', 'draft.steal'),
    ('projection.bust', 'projection.boom'),
    ('projection.player.bust', 'projection.player.boom')
) AS m ("old_id", "new_id") ON m."old_id" = rc."record_id"
WHERE rc."featured"
ON CONFLICT ON CONSTRAINT "record_config_uq" DO UPDATE SET "featured" = true;--> statement-breakpoint
DELETE FROM "record_config" WHERE "record_id" IN (
  'score.low',
  'narrow-win',
  'teamwide.low',
  'bench.low',
  'potential.low',
  'actual.low',
  'ratio.low',
  'player.roster.low',
  'player.starter.low',
  'player.bench.low',
  'season.pf.low',
  'season.pa.low',
  'season.winpct.low',
  'season.iq.low',
  'season.trades.fewest',
  'season.claims.fewest',
  'season.faab.least',
  'season.retention.low',
  'season.luck.low',
  'season.schedule.worst',
  'draft.class.worst',
  'draft.bust',
  'projection.bust',
  'projection.player.bust'
);
