import type { Id } from "./types";

export interface TeamManager {
  managerId: Id;
  role: "primary" | "co";
  /** Weeks the manager ran the team; null = open ended. */
  fromWeek?: number | null;
  toWeek?: number | null;
}

export interface FranchiseSeason {
  year: number;
  managers: readonly TeamManager[];
}

export interface DisplayScope {
  /** Distinct seasons the record covers. */
  seasons: readonly number[];
  /** For a single game: the week, so a mid-season owner change shows who managed that week. */
  week?: number;
}

export interface DisplayedManager {
  primary: Id | null;
  co: Id[];
}

function pick(managers: readonly TeamManager[], week?: number): DisplayedManager {
  const active = managers.filter((m) => {
    if (week === undefined) return true;
    return (m.fromWeek == null || m.fromWeek <= week) && (m.toWeek == null || m.toWeek >= week);
  });
  const pool = active.length > 0 ? active : managers;
  const primaries = pool.filter((m) => m.role === "primary");
  // With no week given and several primaries (an owner change), the latest one is the team's manager.
  const primary =
    primaries.length === 0
      ? null
      : [...primaries].sort((a, b) => (a.fromWeek ?? 0) - (b.fromWeek ?? 0)).at(-1)!.managerId;
  return { primary, co: pool.filter((m) => m.role === "co").map((m) => m.managerId) };
}

/**
 * The manager shown for a franchise (doc §2): that season's manager when the record covers one season (a single
 * game or a season total); the franchise's current manager (its most recent season) when it spans several.
 */
export function displayManager(
  history: readonly FranchiseSeason[],
  scope: DisplayScope
): DisplayedManager {
  const years = [...new Set(scope.seasons)];
  if (years.length === 1) {
    const season = history.find((s) => s.year === years[0]);
    if (season) return pick(season.managers, scope.week);
  }
  const latest = [...history].sort((a, b) => a.year - b.year).at(-1);
  return latest ? pick(latest.managers) : { primary: null, co: [] };
}
