import { compareScores, round3 } from "./points";
import { median } from "./stats";
import type { GameResultKind, GameType, Id, ResultValue } from "./types";

export interface GameSide {
  teamSeasonId: Id;
  franchiseId: Id;
  points: number;
}

/** A real head-to-head game that counts (game_type 'none' games are not passed in). */
export interface Game {
  matchupId: Id;
  week: number;
  gameType: GameType;
  a: GameSide;
  b: GameSide;
}

export interface GameResultRow {
  teamSeasonId: Id;
  franchiseId: Id;
  week: number;
  /** 1 = head-to-head, 2 = median; orders games within a week for streaks. */
  seq: number;
  kind: GameResultKind;
  matchupId: Id | null;
  opponentTeamSeasonId: Id | null;
  opponentFranchiseId: Id | null;
  result: ResultValue;
  gameType: GameType;
  pointsFor: number;
  /** Opponent's score; the week's median for median rows. */
  pointsAgainst: number;
}

/**
 * game_result rows: a head-to-head row per side of every game, plus a median row per team for
 * regular-season weeks (doc §2: median games exist only in the regular season, are compared with the
 * true median of that week's scores, independent of head-to-head results, and equal = tie).
 * Games with game_type 'none' must be filtered out by the caller.
 */
export function buildGameResults(games: readonly Game[]): GameResultRow[] {
  const rows: GameResultRow[] = [];
  for (const g of games) {
    const sides: [GameSide, GameSide][] = [
      [g.a, g.b],
      [g.b, g.a],
    ];
    for (const [me, opp] of sides) {
      rows.push({
        teamSeasonId: me.teamSeasonId,
        franchiseId: me.franchiseId,
        week: g.week,
        seq: 1,
        kind: "h2h",
        matchupId: g.matchupId,
        opponentTeamSeasonId: opp.teamSeasonId,
        opponentFranchiseId: opp.franchiseId,
        result: compareScores(me.points, opp.points),
        gameType: g.gameType,
        pointsFor: round3(me.points),
        pointsAgainst: round3(opp.points),
      });
    }
  }

  const regularByWeek = new Map<number, GameSide[]>();
  for (const g of games) {
    if (g.gameType !== "regular") continue;
    const list = regularByWeek.get(g.week) ?? [];
    list.push(g.a, g.b);
    regularByWeek.set(g.week, list);
  }
  for (const [week, sides] of regularByWeek) {
    const med = median(sides.map((s) => s.points));
    if (med === null) continue;
    for (const s of sides) {
      rows.push({
        teamSeasonId: s.teamSeasonId,
        franchiseId: s.franchiseId,
        week,
        seq: 2,
        kind: "median",
        matchupId: null,
        opponentTeamSeasonId: null,
        opponentFranchiseId: null,
        result: compareScores(s.points, med),
        gameType: "regular",
        pointsFor: round3(s.points),
        pointsAgainst: med,
      });
    }
  }
  return rows.sort((x, y) => x.week - y.week || x.seq - y.seq);
}

export type MedianMode = "default" | "include" | "exclude" | "only";

/** The median filter as a row predicate (doc §3.2): the same rule the SQL layer applies. */
export function medianFilter(
  mode: MedianMode,
  medianEnabled: boolean
): (r: { kind: GameResultKind }) => boolean {
  switch (mode) {
    case "include":
      return () => true;
    case "exclude":
      return (r) => r.kind === "h2h";
    case "only":
      return (r) => r.kind === "median";
    case "default":
      return (r) => r.kind === "h2h" || medianEnabled;
  }
}

export interface Tally {
  w: number;
  l: number;
  t: number;
}

export function tally(rows: readonly { result: ResultValue }[]): Tally {
  const out = { w: 0, l: 0, t: 0 };
  for (const r of rows) {
    if (r.result === "W") out.w++;
    else if (r.result === "L") out.l++;
    else out.t++;
  }
  return out;
}
