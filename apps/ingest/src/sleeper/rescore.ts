import type { ScoringOverride } from "@rfp/db";
import type { SleeperMatchupEntry } from "./schemas";

/** Player id -> stat key -> value, as Sleeper's stats endpoint returns it for one week. */
export type WeekStats = Readonly<Record<string, Readonly<Record<string, number>>>>;

const round2 = (n: number) => Math.round(n * 100) / 100;

/** The stat -> points-per-unit overrides that apply in `week`. */
export function overridesForWeek(
  rules: readonly ScoringOverride[],
  week: number
): Record<string, number> {
  const out: Record<string, number> = {};
  for (const r of rules)
    if ((r.fromWeek ?? 1) <= week && week <= (r.toWeek ?? Infinity)) out[r.stat] = r.points;
  return out;
}

/** Points a player gained or lost because `overrides` differ from `current` scoring, for one stat line. */
export function scoringDelta(
  stats: Readonly<Record<string, number>> | undefined,
  current: Readonly<Record<string, number>>,
  overrides: Readonly<Record<string, number>>
): number {
  if (!stats) return 0;
  let delta = 0;
  for (const [stat, played] of Object.entries(overrides))
    delta += (stats[stat] ?? 0) * (played - (current[stat] ?? 0));
  return round2(delta);
}

/**
 * Re-scores a week's matchup entries as they were played. Sleeper serves past weeks with the league's current
 * scoring; when a scoring setting changed after the games, the stored `scoring_overrides` say what it was.
 * Player points, starter points and the team total all move by the same per-player deltas, so the three stay
 * consistent. A commissioner `custom_points` total keeps its adjustment relative to the new total.
 */
export function rescoreEntries(
  entries: readonly SleeperMatchupEntry[],
  week: number,
  stats: WeekStats,
  current: Readonly<Record<string, number>>,
  rules: readonly ScoringOverride[]
): SleeperMatchupEntry[] {
  const overrides = overridesForWeek(rules, week);
  if (Object.keys(overrides).length === 0) return [...entries];
  return entries.map((e) => {
    const delta = (pid: string) => scoringDelta(stats[pid], current, overrides);
    const playersPoints = e.players_points
      ? Object.fromEntries(
          Object.entries(e.players_points).map(([pid, pts]) => [
            pid,
            pts === null ? null : round2(pts + delta(pid)),
          ])
        )
      : e.players_points;
    const starters = e.starters ?? [];
    const startersPoints = e.starters_points?.map((pts, i) => {
      const pid = starters[i];
      return pts === null || pts === undefined || pid === undefined || pid === "0"
        ? pts
        : round2(pts + delta(pid));
    });
    const teamDelta = starters.reduce((sum, pid) => (pid === "0" ? sum : sum + delta(pid)), 0);
    return {
      ...e,
      players_points: playersPoints,
      starters_points: startersPoints,
      points: e.points == null ? e.points : round2(e.points + teamDelta),
      custom_points:
        e.custom_points == null ? e.custom_points : round2(e.custom_points + teamDelta),
    };
  });
}
