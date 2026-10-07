import { sql } from "@rfp/db";
import type { Db } from "@rfp/db";
import { RECORD_CATALOG } from "@rfp/core";
import { HttpError } from "../lib/http";
import { franchiseEntities, trophyCase } from "./league-data";
import { runRecord } from "../records/run";
import { resolveRows } from "../records/entities";

/**
 * Franchise profile: one season row per year (team, manager, record, finish), the franchise's rank in every
 * manager record, and its trophies. Uses the same record queries (and cache) as the Records pages.
 */
export async function franchiseProfile(db: Db, leagueId: number, franchiseId: number) {
  const exists = (
    await db.execute<{ id: number }>(
      sql`select id from franchise where id = ${franchiseId} and league_id = ${leagueId}`
    )
  ).rows[0];
  if (!exists) throw new HttpError(404, `unknown franchise ${franchiseId}`);

  const seasons = (
    await db.execute<Record<string, unknown>>(sql`
      select ls.year, ls.status::text as status, ts.id as team_season_id, ts.name, ts.avatar, ts.division, ts.seed, ts.final_place,
             ts.made_playoffs, ls.team_count,
             coalesce(g.w, 0)::int as wins, coalesce(g.l, 0)::int as losses, coalesce(g.t, 0)::int as ties,
             coalesce(p.pf, 0)::float8 as pf, coalesce(p.pa, 0)::float8 as pa
      from team_season ts
      join league_season ls on ls.id = ts.league_season_id and ls.enabled
      left join (
        select gr.team_season_id, count(*) filter (where result = 'W') w, count(*) filter (where result = 'L') l, count(*) filter (where result = 'T') t
        from rec_game_result gr where gr.kind = 'h2h' or gr.median_enabled group by 1
      ) g on g.team_season_id = ts.id
      left join (
        select tw.team_season_id, sum(tw.points) pf, sum(otw.points) pa
        from rec_team_week tw left join team_week otw on otw.team_season_id = tw.opponent_team_season_id and otw.week = tw.week group by 1
      ) p on p.team_season_id = ts.id
      where ts.franchise_id = ${franchiseId} order by ls.year`)
  ).rows;

  const resolved = await resolveRows(
    db,
    seasons.map((s) => ({
      rank: 0,
      total: 0,
      value: 0,
      data: {},
      refs: { franchiseId, teamSeasonId: Number(s.team_season_id) },
      inProgress: false,
    }))
  );

  const records = [];
  for (const def of RECORD_CATALOG.filter((r) => r.category === "manager")) {
    const res = await runRecord(db, leagueId, def.id, { limit: 200 });
    const row = res.rows.find((r) => r.refs.franchiseId === franchiseId);
    if (row)
      records.push({
        id: def.id,
        title: def.title,
        section: def.section,
        sortKey: def.sortKey,
        rank: row.rank,
        of: res.total,
        values: row.values,
      });
  }

  const trophies = await trophyCase(db, leagueId, {});
  return {
    franchiseId,
    seasons: seasons.map((s, i) => ({
      season: Number(s.year),
      status: s.status,
      teamSeasonId: Number(s.team_season_id),
      teamName: s.name,
      avatar: s.avatar,
      division: s.division,
      seed: s.seed === null ? null : Number(s.seed),
      finalPlace: s.final_place === null ? null : Number(s.final_place),
      madePlayoffs: s.made_playoffs,
      teamCount: Number(s.team_count),
      record: { wins: Number(s.wins), losses: Number(s.losses), ties: Number(s.ties) },
      pf: Number(s.pf),
      pa: Number(s.pa),
      managerId: resolved.rows[i]?.refs.managerId ?? null,
    })),
    records,
    trophies: trophies.trophies.filter((t) => t.franchiseId === franchiseId),
    entities: {
      ...(await franchiseEntities(db, [franchiseId])),
      managers: { ...resolved.entities.managers, ...trophies.entities.managers },
    },
  };
}
