import type { Id, ResultValue } from "./types";

export interface StreakRun {
  length: number;
  /** Index range (inclusive) within the ordered results. */
  start: number;
  end: number;
}

/** Runs of consecutive `target` results. A tie ends both win and loss streaks (doc §2). */
export function streakRuns(results: readonly ResultValue[], target: "W" | "L"): StreakRun[] {
  const runs: StreakRun[] = [];
  let start = -1;
  results.forEach((r, i) => {
    if (r === target) {
      if (start < 0) start = i;
    } else if (start >= 0) {
      runs.push({ length: i - start, start, end: i - 1 });
      start = -1;
    }
  });
  if (start >= 0) runs.push({ length: results.length - start, start, end: results.length - 1 });
  return runs;
}

export interface StreakRow {
  /** Season partition key (league_season_id or year). */
  season: Id;
  week: number;
  seq: number;
  result: ResultValue;
}

export interface StreakSummary {
  length: number;
  /** Every season that reached the longest length (ties list all holders). Empty when length is 0. */
  seasons: Id[];
}

const longestRun = (results: ResultValue[], target: "W" | "L") =>
  Math.max(0, ...streakRuns(results, target).map((r) => r.length));

/**
 * Longest streak for one franchise. Streaks are per season by default (doc §2): each season is ordered by
 * (week, seq) and measured on its own. With `acrossSeasons` the seasons are chained instead (a later record).
 * Pass rows already filtered by scope and median mode, so "include medians" streaks see both kinds.
 */
export function longestStreak(
  rows: readonly StreakRow[],
  target: "W" | "L",
  opts: { acrossSeasons?: boolean } = {}
): StreakSummary {
  const bySeason = new Map<Id, StreakRow[]>();
  for (const r of rows) {
    const list = bySeason.get(r.season) ?? [];
    list.push(r);
    bySeason.set(r.season, list);
  }
  const ordered = (list: StreakRow[]) =>
    [...list].sort((a, b) => a.week - b.week || a.seq - b.seq).map((r) => r.result);

  if (opts.acrossSeasons) {
    const seasons = [...bySeason.keys()];
    const best = longestRun(
      seasons.flatMap((s) => ordered(bySeason.get(s)!)),
      target
    );
    return { length: best, seasons: best > 0 ? seasons : [] };
  }

  let best = 0;
  let holders: Id[] = [];
  for (const [season, list] of bySeason) {
    const longest = longestRun(ordered(list), target);
    if (longest > best) {
      best = longest;
      holders = [season];
    } else if (longest === best && longest > 0) holders.push(season);
  }
  return { length: best, seasons: holders };
}
