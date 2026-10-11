/**
 * Live win probability for a head-to-head game, from projections and how much of each player's NFL game is left.
 *
 * Each team's final score is modelled as normal: mean = points so far + sum of (projection x fraction of the game left),
 * variance = sum of (position sd)^2 x fraction left, players independent. P(win) = Phi(margin / sd of the margin), so a
 * lead that survives only a few unplayed players is near-certain, and the same lead with everyone left is not.
 * The per-position sd is the measured spread of (actual - projection) for starters in this league's history.
 */

export type LiveStarter = {
  position: string | null;
  /** Projected points for the whole game. */
  projected: number | null;
  /** Fraction of the player's NFL game still to play: 1 = not started, 0 = final or on bye. */
  fractionLeft: number;
};

/** Sd of (actual - projected) for one starter over a full game, by position (starters, 2020-2025 history). */
const POSITION_SD: Record<string, number> = {
  QB: 9.2,
  RB: 8.5,
  WR: 8.7,
  TE: 8.4,
  K: 4.5,
  DEF: 6.4,
  DL: 8.4,
  LB: 8.2,
  DB: 7.1,
  P: 4,
};
const DEFAULT_SD = 8;

/** A game lasts about this long from kickoff to final whistle. */
const GAME_HOURS = 3.25;
/** An in-progress game never reads as finished (overtime, delays): at least this much stays. */
const MIN_LEFT_LIVE = 0.04;

/** Standard normal CDF (Abramowitz and Stegun 7.1.26, absolute error under 1.5e-7). */
export function normalCdf(z: number): number {
  const x = Math.abs(z) / Math.SQRT2;
  const t = 1 / (1 + 0.3275911 * x);
  const poly =
    ((((1.061405429 * t - 1.453152027) * t + 1.421413741) * t - 0.284496736) * t + 0.254829592) * t;
  const erf = 1 - poly * Math.exp(-x * x);
  return z >= 0 ? 0.5 * (1 + erf) : 0.5 * (1 - erf);
}

/**
 * Fraction of an NFL game left. There is no game clock in the data, so an in-progress game is estimated from the time
 * since kickoff. A game still marked scheduled after its kickoff counts as in progress (the status can lag).
 */
export function gameFractionLeft(
  status: "scheduled" | "in_progress" | "final" | null,
  kickoff: Date | null,
  now: Date
): number {
  if (status === "final") return 0;
  if (status === null) return 0;
  const started = status === "in_progress" || (kickoff !== null && kickoff <= now);
  if (!started) return 1;
  if (kickoff === null) return 0.5;
  const elapsed = (now.getTime() - kickoff.getTime()) / 3_600_000;
  return Math.min(1, Math.max(MIN_LEFT_LIVE, 1 - elapsed / GAME_HOURS));
}

export type TeamForecast = {
  /** Points scored so far. */
  points: number;
  starters: readonly LiveStarter[];
};

/** Expected final score and the sd of that score. */
export function forecastTeam(team: TeamForecast): { mean: number; variance: number } {
  let mean = team.points;
  let variance = 0;
  for (const s of team.starters) {
    if (s.fractionLeft <= 0) continue;
    mean += (s.projected ?? 0) * s.fractionLeft;
    const sd = POSITION_SD[s.position ?? ""] ?? DEFAULT_SD;
    variance += sd * sd * s.fractionLeft;
  }
  return { mean, variance };
}

/**
 * Chance that `a` beats `b`, 0-1. Null when neither side has any projection to go on. Stays strictly between 0 and 1
 * while anyone still has points to play, so the display never promises a win that is not yet locked in.
 */
export function winProbability(a: TeamForecast, b: TeamForecast): number | null {
  const hasProjection = [...a.starters, ...b.starters].some(
    (s) => s.fractionLeft > 0 && s.projected !== null
  );
  const fa = forecastTeam(a);
  const fb = forecastTeam(b);
  const margin = fa.mean - fb.mean;
  const variance = fa.variance + fb.variance;
  if (variance === 0) return margin > 0 ? 1 : margin < 0 ? 0 : 0.5;
  if (!hasProjection) return null;
  const p = normalCdf(margin / Math.sqrt(variance));
  return Math.min(0.999, Math.max(0.001, p));
}
