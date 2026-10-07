import { round3 } from "./points";
import type { Id } from "./types";

/** The true median: the middle score, or the mean of the two middle scores when the count is even (doc §2). */
export function median(values: readonly number[]): number | null {
  if (values.length === 0) return null;
  const sorted = [...values].sort((a, b) => a - b);
  const mid = Math.floor(sorted.length / 2);
  const value = sorted.length % 2 === 1 ? sorted[mid]! : (sorted[mid - 1]! + sorted[mid]!) / 2;
  return round3(value);
}

export interface WeekScore {
  teamId: Id;
  points: number;
}

export interface WeekTeamStats {
  teamId: Id;
  /** 1 = highest score of the week; equal scores share a rank (RANK()). */
  rank: number;
  /** Standard score against the week's league-wide scores (population standard deviation; 0 when all scores are equal). */
  zscore: number;
  /** Record against every other team's score that week. */
  allPlay: { w: number; l: number; t: number };
}

export interface WeekStats {
  median: number | null;
  mean: number | null;
  teams: WeekTeamStats[];
}

/** Median, mean, rank, z-score and all-play for one week. Pass only teams whose score counts that week. */
export function weekStats(scores: readonly WeekScore[]): WeekStats {
  const pts = scores.map((s) => round3(s.points));
  const n = pts.length;
  if (n === 0) return { median: null, mean: null, teams: [] };
  const mean = pts.reduce((a, b) => a + b, 0) / n;
  const variance = pts.reduce((a, b) => a + (b - mean) ** 2, 0) / n;
  const sd = Math.sqrt(variance);
  const teams = scores.map((s, i): WeekTeamStats => {
    const mine = pts[i]!;
    let w = 0;
    let l = 0;
    let t = 0;
    pts.forEach((other, j) => {
      if (j === i) return;
      if (mine > other) w++;
      else if (mine < other) l++;
      else t++;
    });
    return {
      teamId: s.teamId,
      // Strictly higher scores = the teams that beat this one, so ties share a rank.
      rank: 1 + pts.filter((other) => other > mine).length,
      zscore: sd === 0 ? 0 : (mine - mean) / sd,
      allPlay: { w, l, t },
    };
  });
  return { median: median(pts), mean: round3(mean), teams };
}
