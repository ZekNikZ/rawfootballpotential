import { sql } from "@rfp/db";
import type { Db } from "@rfp/db";
import { franchiseEntities } from "./league-data";

export interface SearchFranchise {
  id: number;
  /** Current team name and manager (what the rest of the site shows). */
  team: string | null;
  manager: string | null;
  /** Every team name and manager the franchise has had, so an old name still finds it. */
  teamNames: string[];
  managers: string[];
  firstSeason: number;
  lastSeason: number;
}

/** What the search bar matches teams against: every franchise with its past names and managers. */
export async function searchIndex(db: Db, leagueId: number) {
  const rows = (
    await db.execute<{
      franchise_id: number;
      name: string;
      year: number;
      manager: string | null;
    }>(sql`
      select ts.franchise_id, ts.name, ls.year, m.name as manager
      from team_season ts
      join franchise f on f.id = ts.franchise_id
      join league_season ls on ls.id = ts.league_season_id and ls.enabled
      left join team_season_manager tsm on tsm.team_season_id = ts.id
      left join manager m on m.id = tsm.manager_id
      where f.league_id = ${leagueId}
      order by ls.year desc`)
  ).rows;
  const byFranchise = new Map<number, SearchFranchise>();
  for (const r of rows) {
    const id = Number(r.franchise_id);
    const f = byFranchise.get(id) ?? {
      id,
      team: null,
      manager: null,
      teamNames: [],
      managers: [],
      firstSeason: Number(r.year),
      lastSeason: Number(r.year),
    };
    byFranchise.set(id, f);
    if (!f.teamNames.includes(r.name)) f.teamNames.push(r.name);
    if (r.manager && !f.managers.includes(r.manager)) f.managers.push(r.manager);
    f.firstSeason = Math.min(f.firstSeason, Number(r.year));
    f.lastSeason = Math.max(f.lastSeason, Number(r.year));
  }
  const ids = [...byFranchise.keys()];
  const entities = await franchiseEntities(db, ids);
  for (const f of byFranchise.values()) {
    const e = entities.franchises[f.id];
    f.team = e?.teamName ?? f.teamNames[0] ?? null;
    f.manager = e?.managerId == null ? null : (entities.managers[e.managerId]?.name ?? null);
  }
  return { franchises: [...byFranchise.values()].sort((a, b) => a.id - b.id) };
}
