import type { ResultValue } from "./types";

/** Scores come from sources with 2 decimals; sums pick up float noise. Everything compares at 3 dp. */
export const round3 = (n: number): number => Math.round(n * 1000) / 1000;

/** Compare two scores: a tie means equal at 3 dp, never "second argument wins" (doc §1.4 bug 2). */
export function compareScores(a: number, b: number): ResultValue {
  const x = round3(a);
  const y = round3(b);
  return x > y ? "W" : x < y ? "L" : "T";
}

/** Win % = (W + 0.5T) / games played (doc §2). `null` when no games were played. */
export function winPct(wins: number, losses: number, ties: number): number | null {
  const games = wins + losses + ties;
  return games === 0 ? null : (wins + 0.5 * ties) / games;
}
