import { sql } from "@rfp/db";
import type { Db } from "@rfp/db";
import { displayManager, type FranchiseSeason, type TeamManager } from "@rfp/core";
import { inList, type RankedRow, type Refs } from "./context";

export interface Entities {
  franchises: Record<
    number,
    { teamName: string | null; managerId: number | null; season: number | null }
  >;
  teamSeasons: Record<
    number,
    { name: string; season: number; franchiseId: number; managerId: number | null }
  >;
  managers: Record<number, { name: string; avatar: string | null }>;
}

export interface ResolvedRow {
  rank: number;
  values: Record<string, unknown>;
  refs: Refs & { managerId?: number | null; opponentManagerId?: number | null };
  inProgress: boolean;
}

type TeamSeasonRow = {
  id: number;
  name: string;
  season: number;
  franchise_id: number;
};
type ManagerRow = {
  team_season_id: number;
  manager_id: number;
  role: "primary" | "co";
  from_week: number | null;
  to_week: number | null;
};

/**
 * Names for the entities rows refer to, plus the manager each row displays (doc §2): the season's manager (at that
 * week, for a single game) when the row covers one team season, the franchise's current manager when it spans years.
 */
export async function resolveRows(
  db: Db,
  input: readonly RankedRow[],
  opts: { singleYear?: number } = {}
): Promise<{ rows: ResolvedRow[]; entities: Entities }> {
  // A franchise-level row (a career total) covers one season when the filter selects a single year: show that
  // season's team and manager, not the franchise's current ones (owner decision).
  let rows = input;
  if (opts.singleYear !== undefined) {
    const ids = [
      ...new Set(
        input
          .filter((r) => r.refs.franchiseId && !r.refs.teamSeasonId)
          .map((r) => r.refs.franchiseId!)
      ),
    ];
    if (ids.length) {
      const found = await db.execute<{ id: number; franchise_id: number }>(sql`
        select ts.id, ts.franchise_id from team_season ts join league_season ls on ls.id = ts.league_season_id
        where ls.year = ${opts.singleYear} and ts.franchise_id in (${inList(ids)})`);
      const byFranchise = new Map(found.rows.map((r) => [r.franchise_id, r.id]));
      rows = input.map((r) => {
        const id =
          r.refs.franchiseId && !r.refs.teamSeasonId
            ? byFranchise.get(r.refs.franchiseId)
            : undefined;
        return id === undefined ? r : { ...r, refs: { ...r.refs, teamSeasonId: id } };
      });
    }
  }
  const teamSeasonIds = new Set<number>();
  const franchiseIds = new Set<number>();
  for (const r of rows) {
    const refs = r.refs;
    for (const id of [refs.teamSeasonId, refs.opponentTeamSeasonId, ...(refs.teamSeasonIds ?? [])])
      if (id) teamSeasonIds.add(id);
    for (const id of [refs.franchiseId, refs.opponentFranchiseId]) if (id) franchiseIds.add(id);
  }

  const teamSeasons = teamSeasonIds.size
    ? (
        await db.execute<TeamSeasonRow>(sql`
          select ts.id, ts.name, ls.year as season, ts.franchise_id
          from team_season ts join league_season ls on ls.id = ts.league_season_id
          where ts.id in (${inList([...teamSeasonIds])})`)
      ).rows
    : [];
  // Franchises: show the most recent season's team and manager.
  const latest = franchiseIds.size
    ? (
        await db.execute<TeamSeasonRow>(sql`
          select distinct on (ts.franchise_id) ts.id, ts.name, ls.year as season, ts.franchise_id
          from team_season ts join league_season ls on ls.id = ts.league_season_id
          where ts.franchise_id in (${inList([...franchiseIds])}) and ls.enabled
          order by ts.franchise_id, ls.year desc`)
      ).rows
    : [];
  for (const t of teamSeasons) franchiseIds.add(t.franchise_id);
  const allTeamIds = [...new Set([...teamSeasons.map((t) => t.id), ...latest.map((t) => t.id)])];
  const managerRows = allTeamIds.length
    ? (
        await db.execute<ManagerRow>(sql`
          select team_season_id, manager_id, role::text as role, from_week, to_week
          from team_season_manager where team_season_id in (${inList(allTeamIds)})`)
      ).rows
    : [];
  const byTeam = new Map<number, TeamManager[]>();
  for (const m of managerRows) {
    const list = byTeam.get(m.team_season_id) ?? [];
    list.push({ managerId: m.manager_id, role: m.role, fromWeek: m.from_week, toWeek: m.to_week });
    byTeam.set(m.team_season_id, list);
  }
  const managerIds = new Set(managerRows.map((m) => m.manager_id));
  const managers = managerIds.size
    ? (
        await db.execute<{ id: number; name: string; avatar: string | null }>(sql`
          select id, name, avatar from manager where id in (${inList([...managerIds])})`)
      ).rows
    : [];

  const season = (teamSeasonId: number) => teamSeasons.find((t) => t.id === teamSeasonId);
  const managerOf = (teamSeasonId: number, week?: number): number | null => {
    const t = season(teamSeasonId);
    if (!t) return null;
    const history: FranchiseSeason[] = [
      { year: t.season, managers: byTeam.get(teamSeasonId) ?? [] },
    ];
    const scope = week === undefined ? { seasons: [t.season] } : { seasons: [t.season], week };
    const m = displayManager(history, scope).primary;
    return typeof m === "number" ? m : null;
  };
  const currentManager = (franchiseId: number): number | null => {
    const t = latest.find((x) => x.franchise_id === franchiseId);
    if (!t) return null;
    const m = displayManager([{ year: t.season, managers: byTeam.get(t.id) ?? [] }], {
      seasons: [],
    }).primary;
    return typeof m === "number" ? m : null;
  };

  const entities: Entities = { franchises: {}, teamSeasons: {}, managers: {} };
  for (const t of teamSeasons) {
    entities.teamSeasons[t.id] = {
      name: t.name,
      season: t.season,
      franchiseId: t.franchise_id,
      managerId: managerOf(t.id),
    };
  }
  for (const f of franchiseIds) {
    const t = latest.find((x) => x.franchise_id === f);
    entities.franchises[f] = {
      teamName: t?.name ?? null,
      managerId: currentManager(f),
      season: t?.season ?? null,
    };
  }
  for (const m of managers) entities.managers[m.id] = { name: m.name, avatar: m.avatar };

  const resolved = rows.map((r): ResolvedRow => {
    const refs: ResolvedRow["refs"] = { ...r.refs };
    if (r.refs.teamSeasonId && !r.refs.teamSeasonIds?.length)
      refs.managerId = managerOf(r.refs.teamSeasonId, r.refs.week);
    else if (r.refs.teamSeasonId && (r.refs.teamSeasonIds?.length ?? 0) > 0)
      refs.managerId = managerOf(r.refs.teamSeasonId);
    else if (r.refs.franchiseId) refs.managerId = currentManager(r.refs.franchiseId);
    if (r.refs.opponentTeamSeasonId)
      refs.opponentManagerId = managerOf(r.refs.opponentTeamSeasonId, r.refs.week);
    else if (r.refs.opponentFranchiseId)
      refs.opponentManagerId = currentManager(r.refs.opponentFranchiseId);
    return { rank: r.rank, values: { ...r.data, value: r.value }, refs, inProgress: r.inProgress };
  });
  return { rows: resolved, entities };
}
