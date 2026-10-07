/* eslint-disable @typescript-eslint/no-explicit-any -- legacy records are untyped on purpose (see legacy-world.ts) */
import type { Db } from "@rfp/db";
import { fetchAll } from "./compare";

export interface ManagerFamily {
  family: string;
  /** Extra query for the new API (e.g. median excluded). */
  query?: Record<string, unknown>;
  legacyRecord: string;
  newRecord: string;
  /** legacy entry field -> new value key, with a tolerance and the reason a residual is expected. */
  fields: { legacy: string; now: string; tol: number; why?: string }[];
  /** Legacy entries to compare: the all-seasons aggregate for the season-default median. */
  pick: (e: any) => boolean;
}

const STREAK_WHY =
  "the legacy default streak ignores median results (doc §1.4 bug 5) while the new default includes the season's median games (doc §2); with medians excluded they match exactly (next family)";

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
        why: STREAK_WHY,
      },
      {
        legacy: "longestLossStreak",
        now: "lossStreak",
        tol: 0,
        why: STREAK_WHY,
      },
    ],
  },
  {
    // Same record with medians excluded on both sides: streaks and W-L must match exactly.
    family: "Career standings, medians excluded",
    legacyRecord: "Most wins",
    newRecord: "career.wins",
    query: { median: "exclude" },
    pick: (e: any) =>
      e.league === undefined && e.scope === undefined && e.medianMethod === "no-medians",
    fields: [
      { legacy: "wins", now: "wins", tol: 0 },
      { legacy: "losses", now: "losses", tol: 0 },
      { legacy: "longestWinStreak", now: "winStreak", tol: 0 },
      { legacy: "longestLossStreak", now: "lossStreak", tol: 0 },
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
export interface FieldCheck {
  reason: string;
  /** manager -> the (legacy - new) gap this reason accounts for exactly */
  expected: ReadonlyMap<string, number>;
}

/**
 * Compare one family of manager records, manager by manager, on raw and on corrected legacy data. A residual on
 * corrected data counts as explained only if (a) the franchise changed hands (records follow the franchise, doc §2),
 * (b) a data-derived check accounts for the exact gap, or (c) the field has a documented logic reason that is
 * itself verified elsewhere in the report (streaks: see the medians-excluded family).
 */
export async function compareManagerRecords(
  db: Db,
  leagueId: number,
  seasons: string,
  family: ManagerFamily,
  legacy0: any,
  legacy1: any,
  ownerChanged: ReadonlySet<string> = new Set(),
  checks: Record<string, FieldCheck> = {}
): Promise<ManagerDiff[]> {
  const res = await fetchAll(db, leagueId, family.newRecord, { seasons, ...(family.query ?? {}) });
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
    const check = checks[f.legacy];
    const byOwner = d1.filter((d) => ownerChanged.has(d.manager));
    const rest = d1.filter((d) => !ownerChanged.has(d.manager));
    const verified = check
      ? rest.filter((d) => Math.abs(d.legacy - d.now - (check.expected.get(d.manager) ?? 0)) < 1e-6)
      : [];
    const left = rest.length - verified.length;
    const generic = left > 0 && !check && f.why ? left : 0;
    const parts = [
      byOwner.length
        ? `${byOwner.length} × franchise changed hands: records follow the franchise and show its current manager (doc §2); the legacy split it by person`
        : "",
      verified.length && check ? `${verified.length} × ${check.reason}` : "",
      generic && f.why ? `${generic} × ${f.why}` : "",
      left - generic > 0 ? `${left - generic} × UNEXPLAINED` : "",
    ].filter(Boolean);
    out.push({
      family: family.family,
      field: f.legacy,
      managers: [...nowBy.keys()].filter((n) => l0.has(n)).length,
      layer0: d0.length,
      layer1: d1.length,
      why: parts.length ? parts.join("; ") : "-",
      unexplained: left - generic,
      detail: d1,
    });
  }
  return out;
}
