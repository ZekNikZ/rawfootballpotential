/* eslint-disable @typescript-eslint/no-explicit-any -- legacy records are untyped on purpose (see legacy-world.ts) */
import type { Db } from "@rfp/db";
import { fetchAll } from "./compare";

export interface ManagerFamily {
  family: string;
  legacyRecord: string;
  newRecord: string;
  /** legacy entry field -> new value key, with a tolerance and the reason a residual is expected. */
  fields: { legacy: string; now: string; tol: number; why?: string }[];
  /** Legacy entries to compare: the all-seasons aggregate for the season-default median. */
  pick: (e: any) => boolean;
}

const aggregate = (e: any) =>
  e.league === undefined &&
  e.scope === undefined &&
  (e.medianMethod === undefined || e.medianMethod === "default");

export const MANAGER_FAMILIES: ManagerFamily[] = [
  {
    family: "Career standings",
    legacyRecord: "Most wins",
    newRecord: "career.wins",
    pick: aggregate,
    fields: [
      { legacy: "wins", now: "wins", tol: 0 },
      { legacy: "losses", now: "losses", tol: 0 },
      { legacy: "yearsInLeague", now: "years", tol: 0 },
      { legacy: "winPercentage", now: "winPct", tol: 0.0005 },
      {
        legacy: "longestWinStreak",
        now: "winStreak",
        tol: 0,
        why: "streaks are per season now (doc §2); the legacy streak runs across seasons",
      },
      {
        legacy: "longestLossStreak",
        now: "lossStreak",
        tol: 0,
        why: "streaks are per season now (doc §2); the legacy streak runs across seasons",
      },
    ],
  },
  {
    family: "Career placements",
    legacyRecord: "Highest placement",
    newRecord: "career.place.best",
    pick: aggregate,
    fields: [
      { legacy: "highestPlacement", now: "bestPlace", tol: 0 },
      { legacy: "lowestPlacement", now: "worstPlace", tol: 0 },
      { legacy: "averagePlacement", now: "avgPlace", tol: 0.0006 },
      { legacy: "playoffAppearances", now: "playoffs", tol: 0 },
      {
        legacy: "toiletBowlAppearances",
        now: "toiletBowls",
        tol: 0,
        why: "toilet bowl appearance = played in the losers bracket (doc §2); the legacy counted every team that missed the playoffs",
      },
    ],
  },
  {
    family: "Career lineups",
    legacyRecord: "Most perfect lineups",
    newRecord: "career.perfect",
    pick: aggregate,
    fields: [
      {
        legacy: "perfectLineups",
        now: "perfect",
        tol: 0,
        why: "optimal lineups use each week's position snapshot and an exact assignment (doc §1.4 bug 8)",
      },
      {
        legacy: "missedPoints",
        now: "missed",
        tol: 0.011,
        why: "optimal lineups use each week's position snapshot and an exact assignment (doc §1.4 bug 8)",
      },
      {
        legacy: "lineupIQ",
        now: "lineupIq",
        tol: 0.0006,
        why: "optimal lineups use each week's position snapshot and an exact assignment (doc §1.4 bug 8)",
      },
    ],
  },
  {
    family: "Career scores",
    legacyRecord: "Highest highest score",
    newRecord: "career.score.high",
    pick: aggregate,
    fields: [
      { legacy: "highestScore", now: "highScore", tol: 0.011 },
      { legacy: "lowestScore", now: "lowScore", tol: 0.011 },
      { legacy: "pointsForward", now: "pf", tol: 0.011 },
      { legacy: "pointsAgainst", now: "pa", tol: 0.011 },
      { legacy: "numGames", now: "games", tol: 0 },
      { legacy: "pointsForwardPerGame", now: "pfpg", tol: 0.011 },
      { legacy: "pointsAgainstPerGame", now: "papg", tol: 0.011 },
    ],
  },
];

export interface ManagerDiff {
  family: string;
  field: string;
  managers: number;
  layer0: number;
  layer1: number;
  why: string;
  unexplained: number;
  detail: { manager: string; legacy: number; now: number }[];
}

const num = (v: unknown) => (typeof v === "number" ? v : Number(v));

/** Compare one family of manager records, manager by manager, both for raw and corrected legacy data. */
export async function compareManagerRecords(
  db: Db,
  leagueId: number,
  seasons: string,
  family: ManagerFamily,
  legacy0: any,
  legacy1: any,
  leagueKey: string
): Promise<ManagerDiff[]> {
  const res = await fetchAll(db, leagueId, family.newRecord, { seasons });
  const nowBy = new Map(
    res.rows.map((r) => [res.entities.managers[r.refs.managerId!]?.name ?? "?", r.values])
  );
  const byManager = (rec: any) =>
    new Map<string, any>(rec.entries.filter(family.pick).map((e: any) => [e.manager, e]));
  const l0 = byManager(legacy0);
  const l1 = byManager(legacy1);
  const out: ManagerDiff[] = [];
  for (const f of family.fields) {
    const differ = (legacy: Map<string, any>) => {
      const diffs: { manager: string; legacy: number; now: number }[] = [];
      for (const [name, vals] of nowBy) {
        const l = legacy.get(name);
        if (!l) continue;
        const a = num(l[f.legacy]);
        const b = num(vals[f.now]);
        if (Math.abs(a - b) > f.tol + 1e-9) diffs.push({ manager: name, legacy: a, now: b });
      }
      return diffs;
    };
    const d0 = differ(l0);
    const d1 = differ(l1);
    out.push({
      family: family.family,
      field: f.legacy,
      managers: [...nowBy.keys()].filter((n) => l0.has(n)).length,
      layer0: d0.length,
      layer1: d1.length,
      why: d1.length === 0 ? "-" : (f.why ?? "UNEXPLAINED"),
      unexplained: d1.length > 0 && !f.why ? d1.length : 0,
      detail: d1,
    });
  }
  void leagueKey;
  return out;
}
