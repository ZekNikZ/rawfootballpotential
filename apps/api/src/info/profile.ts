import { sql } from "@rfp/db";
import type { Db } from "@rfp/db";
import { RECORD_CATALOG } from "@rfp/core";
import { HttpError } from "../lib/http";
import { bySlot } from "../lib/slots";
import { unrecordedIr } from "./season-pages";
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

/**
 * One franchise's roster for one season. Finished seasons show the lineup of the last week the team played
 * (what the roster looked like at the end of that year); the running season shows the live roster. Season points
 * and starts only count weeks the player was on this team.
 */
export async function franchiseRoster(db: Db, leagueId: number, franchiseId: number, year: number) {
  const ts = (
    await db.execute<{ id: number; status: string }>(sql`
      select ts.id, ls.status::text as status
      from team_season ts join league_season ls on ls.id = ts.league_season_id and ls.enabled
      join franchise f on f.id = ts.franchise_id
      where ts.franchise_id = ${franchiseId} and f.league_id = ${leagueId} and ls.year = ${year}`)
  ).rows[0];
  if (!ts) throw new HttpError(404, `franchise ${franchiseId} has no ${year} season`);

  const lastWeek = (
    await db.execute<{ week: number | null }>(sql`
      select max(tw.week)::int as week from team_week tw
      join player_week pw on pw.team_week_id = tw.id where tw.team_season_id = ${ts.id}`)
  ).rows[0]?.week;

  const live =
    ts.status !== "complete"
      ? (
          await db.execute<Record<string, unknown>>(sql`
            select rc.player_id, rc.slot, rc.slot_kind::text as slot_kind, p.position, p.nfl_team, p.injury_status
            from roster_current rc join player p on p.id = rc.player_id
            where rc.team_season_id = ${ts.id}`)
        ).rows
      : [];
  const source = live.length > 0 ? "live" : lastWeek == null ? "none" : "final-week";

  const base =
    source === "live"
      ? live
      : source === "none"
        ? []
        : (
            await db.execute<Record<string, unknown>>(sql`
              select pw.player_id, pw.slot, pw.slot_kind::text as slot_kind, pw.position, pw.nfl_team, null::text as injury_status
              from player_week pw join team_week tw on tw.id = pw.team_week_id
              where tw.team_season_id = ${ts.id} and tw.week = ${lastWeek}`)
          ).rows;

  const totals = new Map<number, { points: number; weeks: number; starts: number }>();
  for (const r of (
    await db.execute<Record<string, unknown>>(sql`
      select pw.player_id, coalesce(sum(pw.points), 0)::float8 as points, count(*)::int as weeks,
             count(*) filter (where pw.slot_kind = 'starter')::int as starts
      from player_week pw join team_week tw on tw.id = pw.team_week_id
      where tw.team_season_id = ${ts.id} group by pw.player_id`)
  ).rows)
    totals.set(Number(r.player_id), {
      points: Number(r.points),
      weeks: Number(r.weeks),
      starts: Number(r.starts),
    });

  const ids = base.map((r) => Number(r.player_id));
  const names = new Map<number, string>();
  if (ids.length)
    for (const r of (
      await db.execute<{ id: number; full_name: string }>(
        sql`select id, full_name from player where id in (${sql.join(
          ids.map((i) => sql`${i}`),
          sql`, `
        )})`
      )
    ).rows)
      names.set(r.id, r.full_name);

  const players = base
    .map((r) => {
      const t = totals.get(Number(r.player_id));
      return {
        playerId: Number(r.player_id),
        name: names.get(Number(r.player_id)) ?? "Unknown player",
        position: (r.position as string | null) ?? null,
        nflTeam: (r.nfl_team as string | null) ?? null,
        injuryStatus: (r.injury_status as string | null) ?? null,
        slot: (r.slot as string | null) ?? null,
        slotKind: String(r.slot_kind),
        points: t?.points ?? null,
        weeks: t?.weeks ?? 0,
        starts: t?.starts ?? 0,
      };
    })
    .sort(bySlot);
  const slotCounts = (
    await db.execute<{ bench_slots: number; ir_slots: number }>(sql`
      select ls.bench_slots, ls.ir_slots from team_season ts join league_season ls on ls.id = ts.league_season_id
      where ts.id = ${ts.id}`)
  ).rows[0];
  return {
    franchiseId,
    season: year,
    irUnrecorded:
      source === "final-week"
        ? unrecordedIr(players, {
            benchSlots: slotCounts?.bench_slots ?? 0,
            irSlots: slotCounts?.ir_slots ?? 0,
          })
        : 0,
    source,
    week: source === "final-week" ? lastWeek : null,
    players,
  };
}
