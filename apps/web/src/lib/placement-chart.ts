/** Pure helpers for the placement-over-time chart. */

export interface PlacementPoint {
  season: number;
  place: number;
  teamCount: number;
}

/** 1 for first place, 0 for last: a 2nd in a 14-team league outranks a 2nd in a 9-team league. */
export const weightedPlacement = (place: number, teamCount: number): number =>
  teamCount > 1 ? (teamCount - place) / (teamCount - 1) : 1;

/** Splits a franchise's points into runs of consecutive seasons, so a season sat out leaves a gap in the line. */
export function splitRuns(points: readonly PlacementPoint[], seasons: readonly number[]) {
  const index = new Map(seasons.map((s, i) => [s, i]));
  const runs: PlacementPoint[][] = [];
  let last = -2;
  for (const p of [...points].sort((a, b) => a.season - b.season)) {
    const i = index.get(p.season);
    if (i === undefined) continue;
    if (i === last + 1 && runs.length > 0) runs[runs.length - 1]!.push(p);
    else runs.push([p]);
    last = i;
  }
  return runs;
}

/** Evenly spread hues (golden angle) so neighbouring series stay distinguishable. */
export const seriesColor = (i: number): string => `hsl(${Math.round((i * 137.508) % 360)} 62% 48%)`;
