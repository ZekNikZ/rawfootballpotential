import { compareScores } from "./points";
import type { Bracket, Id } from "./types";

export interface PlacementGame {
  bracket: Bracket;
  /** Bracket `p` of the game (1 = championship / consolation final, 3, 5, ...). */
  placement: number | null;
  teamA: Id;
  teamB: Id;
  pointsA: number;
  pointsB: number;
}

export interface PlacementInput {
  teamCount: number;
  /** Teams that made the playoffs (appear in the winners bracket). */
  playoffTeams: readonly Id[];
  /** Every team, best to worst by regular-season record (the tie-break for places no game decides). */
  regularSeasonOrder: readonly Id[];
  games: readonly PlacementGame[];
}

/**
 * Final places from the brackets.
 * - Winners-bracket game deciding place p: the higher scorer takes p, the other p + 1.
 * - Losers-bracket (consolation / "toilet bowl") game with p: that bracket is played for last place, so the
 *   *lower* scorer takes the worse place, N - p + 1, and the higher scorer N - p.
 * - Places no game decides are filled by regular-season order: playoff teams take the open places among the top
 *   `playoffTeams.length`, the rest take the remaining open places.
 */
export function derivePlacements(input: PlacementInput): Map<Id, number> {
  const n = input.teamCount;
  const placed = new Map<Id, number>();
  const taken = new Set<number>();
  const assign = (team: Id, place: number) => {
    if (placed.has(team) || taken.has(place) || place < 1 || place > n) return;
    placed.set(team, place);
    taken.add(place);
  };

  for (const g of input.games) {
    if (g.placement === null) continue;
    const r = compareScores(g.pointsA, g.pointsB);
    if (r === "T") continue; // cannot decide from scores; falls back to regular-season order
    const [hi, lo] = r === "W" ? [g.teamA, g.teamB] : [g.teamB, g.teamA];
    if (g.bracket === "winners") {
      assign(hi, g.placement);
      assign(lo, g.placement + 1);
    } else {
      assign(lo, n - g.placement + 1);
      assign(hi, n - g.placement);
    }
  }

  const playoff = new Set(input.playoffTeams);
  const order = input.regularSeasonOrder;
  const open = (from: number, to: number) => {
    const out: number[] = [];
    for (let p = from; p <= to; p++) if (!taken.has(p)) out.push(p);
    return out;
  };
  const top = open(1, input.playoffTeams.length);
  for (const team of order.filter((t) => playoff.has(t) && !placed.has(t))) {
    const place = top.shift();
    if (place !== undefined) assign(team, place);
  }
  const rest = open(1, n);
  for (const team of order.filter((t) => !placed.has(t))) {
    const place = rest.shift();
    if (place !== undefined) assign(team, place);
  }
  return placed;
}
