/* eslint-disable @typescript-eslint/no-explicit-any -- legacy records are untyped on purpose (see legacy-world.ts) */
import { sql } from "@rfp/db";
import type { Db } from "@rfp/db";
import { runRecord, type RecordResponse } from "../../src/records/run";

export interface Row {
  season: number;
  week: number;
  team: string;
  manager: string;
  value: number;
}

export const keyOf = (r: Pick<Row, "season" | "week" | "team">) =>
  `${r.season}|${r.week}|${r.team}`;

/** All rows of a record from the new API, paging through the 500-row limit. */
export async function fetchAll(
  db: Db,
  leagueId: number,
  recordId: string,
  query: Record<string, unknown>
): Promise<RecordResponse> {
  let first: RecordResponse | undefined;
  for (let offset = 0; ; offset += 500) {
    const page = await runRecord(
      db,
      leagueId,
      recordId,
      { ...query, limit: 500, offset },
      { noCache: true }
    );
    if (!first) first = page;
    else first.rows.push(...page.rows);
    Object.assign(first.entities.teamSeasons, page.entities.teamSeasons);
    Object.assign(first.entities.managers, page.entities.managers);
    Object.assign(first.entities.franchises, page.entities.franchises);
    if (offset + 500 >= page.total) break;
  }
  return first!;
}

/** "Team Name (Manager N.)" -> parts. */
export function splitTeam(label: string): { team: string; manager: string } {
  const i = label.lastIndexOf(" (");
  return i < 0
    ? { team: label, manager: "" }
    : { team: label.slice(0, i), manager: label.slice(i + 2, -1) };
}

export function parseWeek(label: string): { season: number; week: number } {
  const m = label.match(/^(\d{4}) WK (\d+)$/);
  if (!m) throw new Error(`unexpected week label ${label}`);
  return { season: Number(m[1]), week: Number(m[2]) };
}

export function legacyTeamWeekRows(entries: any[], field: string): Row[] {
  return entries.map((e) => ({
    ...parseWeek(e.week),
    ...splitTeam(e.team),
    value: Number(e[field]),
  }));
}

export function newTeamWeekRows(res: RecordResponse): Row[] {
  return res.rows.map((r) => {
    const ts = res.entities.teamSeasons[r.refs.teamSeasonId!]!;
    const mgr = res.entities.managers[r.refs.managerId!];
    return {
      season: Number(r.values.season),
      week: Number(r.values.week),
      team: ts.name,
      manager: mgr?.name ?? "",
      value: Number(r.values.value),
    };
  });
}

export interface TeamWeekFacts {
  matchupId: number | null;
  gameType: string | null;
  counts: boolean;
  result: string | null;
  points: number;
  hasPlayers: boolean;
}

/** Facts about every team-week in the new data, to explain why a legacy row has no counterpart. */
export async function teamWeekFacts(db: Db, leagueId: number): Promise<Map<string, TeamWeekFacts>> {
  const res = await db.execute<{
    year: number;
    week: number;
    name: string;
    matchup_id: number | null;
    game_type: string | null;
    counts: boolean;
    result: string | null;
    points: number;
    players: boolean;
  }>(sql`
    select ls.year, tw.week, ts.name, tw.matchup_id, m.game_type::text as game_type, tw.counts, tw.result::text as result,
           tw.points::float8 as points, exists (select 1 from player_week pw where pw.team_week_id = tw.id) as players
    from team_week tw join team_season ts on ts.id = tw.team_season_id join league_season ls on ls.id = tw.league_season_id
    left join matchup m on m.id = tw.matchup_id where ls.league_id = ${leagueId}`);
  return new Map(
    res.rows.map((r) => [
      keyOf({ season: r.year, week: r.week, team: r.name }),
      {
        matchupId: r.matchup_id,
        gameType: r.game_type,
        counts: r.counts,
        result: r.result,
        points: Number(r.points),
        hasPlayers: r.players,
      },
    ])
  );
}

export interface DiffResult {
  legacyCount: number;
  newCount: number;
  matched: number;
  onlyLegacy: { row: Row; reason: string }[];
  onlyNew: { row: Row; reason: string }[];
  valueDiffs: { legacy: Row; now: Row; reason: string }[];
  /** Do the two lists agree on the order of the top N rows (by value, ties aside)? */
  topAgree: boolean;
}

export function diffTeamWeek(
  legacy: Row[],
  now: Row[],
  facts: Map<string, TeamWeekFacts>,
  explain: {
    legacyOnly: (r: Row, f: TeamWeekFacts | undefined) => string;
    newOnly: (r: Row, f: TeamWeekFacts | undefined) => string;
    valueDiff: (l: Row, n: Row) => string;
  },
  tol = 0.0051
): DiffResult {
  const newBy = new Map(now.map((r) => [keyOf(r), r]));
  const legacyBy = new Map(legacy.map((r) => [keyOf(r), r]));
  const out: DiffResult = {
    legacyCount: legacy.length,
    newCount: now.length,
    matched: 0,
    onlyLegacy: [],
    onlyNew: [],
    valueDiffs: [],
    topAgree: true,
  };
  for (const l of legacy) {
    const n = newBy.get(keyOf(l));
    if (!n) out.onlyLegacy.push({ row: l, reason: explain.legacyOnly(l, facts.get(keyOf(l))) });
    else if (Math.abs(n.value - l.value) > tol)
      out.valueDiffs.push({ legacy: l, now: n, reason: explain.valueDiff(l, n) });
    else out.matched++;
  }
  for (const n of now)
    if (!legacyBy.has(keyOf(n)))
      out.onlyNew.push({ row: n, reason: explain.newOnly(n, facts.get(keyOf(n))) });
  return out;
}

export const countBy = <T>(items: T[], f: (t: T) => string): Record<string, number> => {
  const out: Record<string, number> = {};
  for (const i of items) out[f(i)] = (out[f(i)] ?? 0) + 1;
  return out;
};
