// Power rating: an Elo rating built from actual head-to-head games, with the margin of victory counted and a fade for
// seasons a manager sat out. Pure; the record engine feeds it the games (doc §3.11.3, "Power rating").

export interface EloGame {
  season: number;
  week: number;
  /** The two franchises (the current manager of each owns the rating). Order does not matter. */
  a: number;
  b: number;
  pointsA: number;
  pointsB: number;
}

export interface EloOptions {
  /** How far one game can move a rating before the margin factor. */
  k: number;
  /** Rating of a manager's first game. */
  start: number;
  /** Where a rating fades toward during seasons the manager did not play in (below `start`: sitting out always costs). */
  anchor: number;
  /** Share of the distance to `anchor` lost per missed season. */
  decay: number;
  /** Margin factor ln(1 + margin / marginScale), in points. */
  marginScale: number;
}

/** Owner decisions of 2026-10-07: log margin, all games, 25% toward 1400 per missed season, K = 32. */
export const DEFAULT_ELO: EloOptions = {
  k: 32,
  start: 1500,
  anchor: 1400,
  decay: 0.25,
  marginScale: 10,
};

/** The league's average winning margin is about 31 points; dividing by ln(1 + 31 / 10) makes the factor average about 1. */
const MARGIN_NORM = Math.log(1 + 31 / 10);

export interface EloRating {
  franchiseId: number;
  rating: number;
  games: number;
  wins: number;
  losses: number;
  ties: number;
  /** Seasons with at least one game. */
  seasonsPlayed: number;
  /** Seasons after the first one in which the manager played no game (each faded the rating). */
  seasonsMissed: number;
}

export const expectedScore = (ratingA: number, ratingB: number): number =>
  1 / (1 + Math.pow(10, (ratingB - ratingA) / 400));

/** Chance of beating a manager rated `start` (an average manager). */
export const winChance = (rating: number, start = DEFAULT_ELO.start): number =>
  expectedScore(rating, start);

/**
 * Plays the games in order (season, week). Games of one week use the ratings from the start of that week. Before each
 * season, every manager who has already played but has no game that season fades toward `anchor`; seasons before a
 * manager's first game are not counted against them. Ratings are zero-sum apart from the fade.
 */
export function computeElo(
  games: readonly EloGame[],
  options: EloOptions = DEFAULT_ELO
): EloRating[] {
  const o = options;
  const bySeason = new Map<number, Map<number, EloGame[]>>();
  for (const g of games) {
    const weeks = bySeason.get(g.season) ?? new Map<number, EloGame[]>();
    weeks.set(g.week, [...(weeks.get(g.week) ?? []), g]);
    bySeason.set(g.season, weeks);
  }
  const state = new Map<number, EloRating>();
  const get = (id: number): EloRating => {
    let s = state.get(id);
    if (!s) {
      s = {
        franchiseId: id,
        rating: o.start,
        games: 0,
        wins: 0,
        losses: 0,
        ties: 0,
        seasonsPlayed: 0,
        seasonsMissed: 0,
      };
      state.set(id, s);
    }
    return s;
  };

  for (const season of [...bySeason.keys()].sort((x, y) => x - y)) {
    const weeks = bySeason.get(season)!;
    const playing = new Set<number>();
    for (const wk of weeks.values())
      for (const g of wk) {
        playing.add(g.a);
        playing.add(g.b);
      }
    for (const s of state.values()) {
      if (playing.has(s.franchiseId)) continue;
      s.rating = s.rating - o.decay * (s.rating - o.anchor);
      s.seasonsMissed++;
    }
    for (const id of playing) get(id).seasonsPlayed++;

    for (const wk of [...weeks.keys()].sort((x, y) => x - y)) {
      const delta = new Map<number, number>();
      for (const g of weeks.get(wk)!) {
        const a = get(g.a);
        const b = get(g.b);
        const ea = expectedScore(a.rating, b.rating);
        const sa = g.pointsA > g.pointsB ? 1 : g.pointsA < g.pointsB ? 0 : 0.5;
        let factor = 1;
        if (sa !== 0.5) {
          const margin = Math.abs(g.pointsA - g.pointsB);
          const lead = sa === 1 ? a.rating - b.rating : b.rating - a.rating;
          // A favourite winning big is expected to; the 2.2 / (0.001 x lead + 2.2) term damps that.
          factor =
            (Math.log(1 + margin / o.marginScale) / MARGIN_NORM) * (2.2 / (0.001 * lead + 2.2));
        }
        const d = o.k * factor * (sa - ea);
        delta.set(g.a, (delta.get(g.a) ?? 0) + d);
        delta.set(g.b, (delta.get(g.b) ?? 0) - d);
        a.games++;
        b.games++;
        if (sa === 1) {
          a.wins++;
          b.losses++;
        } else if (sa === 0) {
          b.wins++;
          a.losses++;
        } else {
          a.ties++;
          b.ties++;
        }
      }
      for (const [id, d] of delta) get(id).rating += d;
    }
  }
  return [...state.values()];
}
