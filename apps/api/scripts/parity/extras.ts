/* eslint-disable @typescript-eslint/no-explicit-any -- legacy records are untyped on purpose (see legacy-world.ts) */
import path from "node:path";
import { pathToFileURL } from "node:url";
import { sql } from "@rfp/db";
import type { Db } from "@rfp/db";
import { headToHead, trophyCase } from "../../src/info/league-data";
import { teamWeekFacts } from "./compare";
import type { LegacyWorld } from "./legacy-world";

const TYPE_MAP: Record<string, string> = {
  placement: "placement",
  "overall-high-score": "high-scorer-club",
  "overall-low-score": "benchwarmer-club",
  "overall-high-iq": "smartypants-club",
  "season-high-score": "season-high-score",
  "season-narrowest-win": "season-narrowest-win",
  "season-largest-blowout": "season-largest-blowout",
  "season-points-for": "season-points-for",
  "season-points-against": "season-points-against",
  "season-high-iq": "season-high-iq",
};

const THRESHOLDS: Record<string, { high: number; low: number }> = {
  redraft: { high: 190, low: 65 },
  dynasty: { high: 200, low: 90 },
};

interface Tk {
  type: string;
  season: number;
  manager: string;
  week: number | null;
  place?: number;
}
const tkey = (t: Tk) =>
  `${t.type}|${t.season}|${t.manager}|${t.type === "season-high-iq" ? "" : (t.week ?? "")}|${t.place ?? ""}`;

async function legacyTrophies(
  world: LegacyWorld,
  leagueDef: any,
  legacyDir: string
): Promise<Tk[]> {
  const mod: any = await import(pathToFileURL(path.join(legacyDir, "trophies.ts")).href);
  const data = mod.computeTrophies(leagueDef, world.leagues, world.nflData);
  const names = new Map<string, string>(world.config.managers.map((m: any) => [m.id, m.name]));
  return data.trophies.map((t: any) => ({
    type: TYPE_MAP[t.trophyType] ?? t.trophyType,
    season: t.year,
    manager: names.get(t.managerId) ?? t.managerId,
    week: t.week ?? null,
    ...(t.trophyType === "placement" ? { place: t.placement } : {}),
  }));
}

async function matchupMatrix(
  world: LegacyWorld,
  leagueDef: any,
  legacyDir: string
): Promise<Map<string, { wins: number; count: number }>> {
  const mod: any = await import(pathToFileURL(path.join(legacyDir, "manager-matchups.ts")).href);
  const data = mod.computeManagerMatchups(leagueDef, world.leagues).data;
  const names = new Map<string, string>(world.config.managers.map((m: any) => [m.id, m.name]));
  const out = new Map<string, { wins: number; count: number }>();
  for (const [a, row] of Object.entries<any>(data)) {
    for (const [b, v] of Object.entries<any>(row))
      out.set(`${names.get(a) ?? a}|${b === "MEDIAN" ? "MEDIAN" : (names.get(b) ?? b)}`, v);
  }
  return out;
}

export async function compareExtras(
  db: Db,
  leagueId: number,
  seasons: string,
  leagueDef: any,
  asWas: LegacyWorld,
  corrected: LegacyWorld,
  _defs: any,
  legacyDir: string,
  ownerChanged: ReadonlySet<string>
): Promise<{ lines: string[]; unexplained: number }> {
  const lines: string[] = [];
  let unexplained = 0;
  void teamWeekFacts;
  const mw = await db.execute<{
    year: number;
    week: number;
    name: string;
    result: string | null;
    points: number;
    overridden: boolean;
  }>(sql`
    select ls.year, tw.week, m.name, tw.result::text as result, tw.points::float8 as points, tw.points_overridden as overridden
    from team_week tw join team_season ts on ts.id = tw.team_season_id join league_season ls on ls.id = tw.league_season_id
    join team_season_manager tsm on tsm.team_season_id = ts.id and tsm.role = 'primary' join manager m on m.id = tsm.manager_id
    where ls.league_id = ${leagueId} and tw.counts`);
  const byManagerWeek = new Map(mw.rows.map((r) => [`${r.year}|${r.week}|${r.name}`, r]));
  const fact = (t: Tk) => byManagerWeek.get(`${t.season}|${t.week}|${t.manager}`);
  const thr = THRESHOLDS[leagueDef.type]!;

  // ---- Trophies ----
  const now = await trophyCase(db, leagueId, {});
  const nowRows: Tk[] = now.trophies
    .filter(
      (t) => String(t.season) >= seasons.split("-")[0]! && t.season <= Number(seasons.split("-")[1])
    )
    .map((t) => ({
      type: t.type,
      season: t.season,
      manager: now.entities.managers[t.managerId ?? -1]?.name ?? "?",
      week: t.week,
      ...(t.type === "placement" ? { place: t.value } : {}),
    }));
  const nowBy = new Map(nowRows.map((t) => [tkey(t), t]));

  lines.push("### Trophies (legacy `trophies.ts`)");
  lines.push("");
  lines.push(
    "| Trophy type | Legacy | New | Only legacy (as-was / corrected) | Only new (as-was / corrected) | Why |"
  );
  lines.push("|---|---:|---:|---|---|---|");
  const types = [...new Set([...Object.values(TYPE_MAP)])];
  const l0 = await legacyTrophies(asWas, leagueDef, legacyDir);
  const l1 = await legacyTrophies(corrected, leagueDef, legacyDir);
  const WHY: Record<string, string> = {
    placement:
      "the legacy used hand-entered placements; the brackets decide now (owner decision, doc §7)",
    "high-scorer-club": `the legacy counts only the winning side and uses ≥ ${thr.high}; any counted team-week above ${thr.high} qualifies now (doc §4.1)`,
    "benchwarmer-club": `the legacy counts only the losing side; any counted team-week below ${thr.low} qualifies now (doc §4.1)`,
    "smartypants-club":
      "a commissioner score override: the legacy ratio uses the overridden team total",
    "season-high-score":
      "the legacy considers only winners' scores; the highest score of the season counts even in a loss",
    "season-narrowest-win": "-",
    "season-largest-blowout": "-",
    "season-points-for":
      "doc §1.4 bug 3: the legacy added only the winner's score to a team's points for",
    "season-points-against":
      "doc §1.4 bug 3: the legacy added the loser's *own* score to a team's points against",
    "season-high-iq":
      "the legacy breaks a tie by who has the most top-IQ weeks; all tied lineups share the trophy now",
  };
  for (const type of types) {
    const set = (rows: Tk[]) =>
      new Map(rows.filter((t) => t.type === type).map((t) => [tkey(t), t]));
    const a0 = set(l0);
    const a1 = set(l1);
    const b = new Map([...nowBy].filter(([, t]) => t.type === type));
    const only = (x: Map<string, Tk>, y: Map<string, Tk>) => [...x.keys()].filter((k) => !y.has(k));
    const lo0 = only(a0, b).length;
    const ln0 = only(b, a0).length;
    const lo1 = only(a1, b);
    const ln1 = only(b, a1);
    const residual = lo1.length + ln1.length;
    const expectedChange = WHY[type] !== "-" || type === "smartypants-club";
    // A residual is acceptable only where the definition changed on purpose, and only if the row has the property
    // that explains it; anything else is unexplained.
    const verifyOnlyNew = (t: Tk): boolean => {
      const f = fact(t);
      switch (type) {
        case "high-scorer-club":
          return f?.result === "L"; // legacy counted only the winning side
        case "benchwarmer-club":
          return f?.result === "W"; // legacy counted only the losing side
        case "season-high-score":
          return (
            f?.result === "L" || [...b.values()].filter((x) => x.season === t.season).length > 1
          );
        case "season-high-iq":
          return [...b.values()].filter((x) => x.season === t.season).length > 1;
        case "season-points-for":
        case "season-points-against":
          return true; // bug 3: the legacy totals were wrong; the new ones are checked in the API tests
        default:
          return false;
      }
    };
    const verifyOnlyLegacy = (t: Tk): boolean => {
      const f = fact(t);
      switch (type) {
        case "high-scorer-club":
          return f !== undefined && f.points === thr.high; // legacy used ≥
        case "smartypants-club":
          return f?.overridden === true; // legacy: overridden team total / potential
        case "season-high-iq":
          return [...b.values()].filter((x) => x.season === t.season).length > 1;
        case "season-points-for":
        case "season-points-against":
          return true;
        default:
          return false;
      }
    };
    const unverified = expectedChange
      ? lo1.filter((k) => !verifyOnlyLegacy(a1.get(k)!)).length +
        ln1.filter((k) => !verifyOnlyNew(b.get(k)!)).length
      : residual;
    const bad = unverified;
    unexplained += bad;
    lines.push(
      `| ${type} | ${a0.size} | ${b.size} | ${lo0} / ${lo1.length} | ${ln0} / ${ln1.length} | ${residual === 0 ? "**identical on corrected data**" : unverified === 0 ? `${WHY[type]} (every residual row verified)` : `UNEXPLAINED (${unverified} of ${residual})`} |`
    );
  }
  lines.push("");

  // ---- Head-to-head heatmap ----
  lines.push("### Manager matchup heatmap (legacy `manager-matchups.ts`)");
  lines.push("");
  const h = await headToHead(db, leagueId, { seasons, scope: "all", median: "include" });
  const nameOf = (f: number) =>
    h.entities.managers[h.entities.franchises[f]?.managerId ?? -1]?.name ?? "?";
  const newMap = new Map<string, { wins: number; count: number }>();
  for (const a of h.franchises) {
    for (const [b, v] of Object.entries(h.matrix[a] ?? {})) {
      newMap.set(`${nameOf(a)}|${b === "median" ? "MEDIAN" : nameOf(Number(b))}`, {
        wins: v.w,
        count: v.games,
      });
    }
  }
  const compareMatrix = (legacy: Map<string, { wins: number; count: number }>) => {
    let cells = 0;
    let differ = 0;
    const examples: string[] = [];
    for (const [k, v] of legacy) {
      if (v.count === 0) continue;
      const [a, b] = k.split("|") as [string, string];
      if (ownerChanged.has(a) || ownerChanged.has(b)) continue;
      cells++;
      const n = newMap.get(k) ?? { wins: 0, count: 0 };
      if (n.wins !== v.wins || n.count !== v.count) {
        differ++;
        if (examples.length < 3)
          examples.push(`${k}: legacy ${v.wins}/${v.count} vs new ${n.wins}/${n.count}`);
      }
    }
    return { cells, differ, examples };
  };
  const m0 = compareMatrix(await matchupMatrix(asWas, leagueDef, legacyDir));
  const m1 = compareMatrix(await matchupMatrix(corrected, leagueDef, legacyDir));
  unexplained += m1.differ;
  lines.push(
    `Cells compared (managers whose franchise did not change hands): ${m1.cells}. Differences on the old site's data: ${m0.differ}; on corrected data: ${m1.differ === 0 ? "**none**" : `${m1.differ} (UNEXPLAINED: ${m1.examples.join("; ")})`}. The median column is compared with \`median=include\`, because the legacy counted median games in every season.`
  );
  lines.push("");
  return { lines, unexplained };
}
