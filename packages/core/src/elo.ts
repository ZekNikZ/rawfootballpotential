// Power rating (doc §3.11.3, "Power rating"). Pure, no I/O: the record engine feeds it the games.
//
// Two layers:
//  1. `computeElo`: an Elo rating over every counted head-to-head game, plus a zero-sum game against each week's median.
//  2. `computePower`: that rating, adjusted for how steady a manager's seasons were and for final placements, blended with
//     the average weighted placement, and put on a display scale calibrated to the league's full history.

export type GameKind = "regular" | "playoffs" | "toilet_bowl";

export interface EloGame {
  season: number;
  week: number;
  /** The two franchises (the current manager of each owns the rating). Order does not matter. */
  a: number;
  b: number;
  pointsA: number;
  pointsB: number;
  /** Defaults to "regular". */
  kind?: GameKind;
}

/** One team's score against the week's median score (a game against the league's average rating). */
export interface MedianGame {
  season: number;
  week: number;
  franchiseId: number;
  points: number;
  median: number;
}

export interface EloInput {
  games: readonly EloGame[];
  medians?: readonly MedianGame[];
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
  /** How much of the margin factor is used: 1 = full (a blowout counts a lot), 0 = only who won. */
  marginShare: number;
  /** Multiplier on the winner's gain in a playoff game (the loser's loss is unchanged; re-centred so a week sums to 0). */
  playoffWinWeight: number;
  /** Multiplier on the loser's loss in a toilet bowl (the winner's gain is unchanged; re-centred likewise). */
  toiletLossWeight: number;
  /** Weight of the median game relative to a head-to-head game; 0 turns medians off. */
  medianWeight: number;
}

/**
 * Owner decisions of 2026-10-07: K = 32, half margin, playoff wins and toilet-bowl losses at 1.5x, medians at half
 * weight in every season, 25% fade per missed season toward 1387.5 (1050 on the 4x scale the options were compared on).
 */
export const DEFAULT_ELO: EloOptions = {
  k: 32,
  start: 1500,
  anchor: 1387.5,
  decay: 0.25,
  marginScale: 10,
  marginShare: 0.5,
  playoffWinWeight: 1.5,
  toiletLossWeight: 1.5,
  medianWeight: 0.5,
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
  /** Average head-to-head point margin (points for minus against) of each season played, oldest first. */
  seasonMargins: number[];
}

export const expectedScore = (ratingA: number, ratingB: number): number =>
  1 / (1 + Math.pow(10, (ratingB - ratingA) / 400));

/** Chance of beating a manager rated `start` (an average manager). */
export const winChance = (rating: number, start = DEFAULT_ELO.start): number =>
  expectedScore(rating, start);

const mean = (v: readonly number[]): number => v.reduce((x, y) => x + y, 0) / v.length;

/**
 * Plays the games in order (season, week). Games of one week use the ratings from the start of that week. Before each
 * season, every manager who has already played but has no game that season fades toward `anchor`; seasons before a
 * manager's first game are not counted against them.
 *
 * The playoff and toilet-bowl weights and the median games are zero-sum: whatever a week adds beyond a plain game is
 * taken back evenly from the managers who played that week, so they never inflate or deflate the whole league.
 */
export function computeElo(input: EloInput, options: EloOptions = DEFAULT_ELO): EloRating[] {
  const o = options;
  const bySeason = new Map<
    number,
    { games: Map<number, EloGame[]>; medians: Map<number, MedianGame[]> }
  >();
  const season = (s: number) => {
    let e = bySeason.get(s);
    if (!e) bySeason.set(s, (e = { games: new Map(), medians: new Map() }));
    return e;
  };
  for (const g of input.games) {
    const m = season(g.season).games;
    m.set(g.week, [...(m.get(g.week) ?? []), g]);
  }
  if (o.medianWeight > 0)
    for (const g of input.medians ?? []) {
      const m = season(g.season).medians;
      m.set(g.week, [...(m.get(g.week) ?? []), g]);
    }

  interface State extends EloRating {
    marginSum: number;
    marginGames: number;
  }
  const state = new Map<number, State>();
  const get = (id: number): State => {
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
        seasonMargins: [],
        marginSum: 0,
        marginGames: 0,
      };
      state.set(id, s);
    }
    return s;
  };
  /** Margin factor of a decided game: log margin, damped when the favourite wins big, shared out per `marginShare`. */
  const factor = (margin: number, lead: number): number => {
    const full =
      (Math.log(1 + margin / o.marginScale) / MARGIN_NORM) * (2.2 / (0.001 * lead + 2.2));
    return 1 + o.marginShare * (full - 1);
  };

  for (const s of [...bySeason.keys()].sort((x, y) => x - y)) {
    const { games, medians } = bySeason.get(s)!;
    const playing = new Set<number>();
    for (const wk of games.values())
      for (const g of wk) {
        playing.add(g.a);
        playing.add(g.b);
      }
    for (const st of state.values()) {
      if (playing.has(st.franchiseId)) continue;
      st.rating = st.rating - o.decay * (st.rating - o.anchor);
      st.seasonsMissed++;
    }
    for (const id of playing) {
      const st = get(id);
      st.seasonsPlayed++;
      st.marginSum = 0;
      st.marginGames = 0;
    }

    const weeks = [...new Set([...games.keys(), ...medians.keys()])].sort((x, y) => x - y);
    for (const wk of weeks) {
      const delta = new Map<number, number>();
      const add = (id: number, d: number) => delta.set(id, (delta.get(id) ?? 0) + d);

      const extra = new Map<number, number>();
      const played = new Set<number>();
      for (const g of games.get(wk) ?? []) {
        const a = get(g.a);
        const b = get(g.b);
        const ea = expectedScore(a.rating, b.rating);
        const sa = g.pointsA > g.pointsB ? 1 : g.pointsA < g.pointsB ? 0 : 0.5;
        const f =
          sa === 0.5
            ? 1
            : factor(
                Math.abs(g.pointsA - g.pointsB),
                sa === 1 ? a.rating - b.rating : b.rating - a.rating
              );
        const d = o.k * f * (sa - ea);
        const kind = g.kind ?? "regular";
        const wa =
          kind === "playoffs" && sa === 1
            ? o.playoffWinWeight
            : kind === "toilet_bowl" && sa === 0
              ? o.toiletLossWeight
              : 1;
        const wb =
          kind === "playoffs" && sa === 0
            ? o.playoffWinWeight
            : kind === "toilet_bowl" && sa === 1
              ? o.toiletLossWeight
              : 1;
        add(g.a, d * wa);
        add(g.b, -d * wb);
        extra.set(g.a, (extra.get(g.a) ?? 0) + d * (wa - 1));
        extra.set(g.b, (extra.get(g.b) ?? 0) - d * (wb - 1));
        played.add(g.a);
        played.add(g.b);
        a.games++;
        b.games++;
        a.marginSum += g.pointsA - g.pointsB;
        b.marginSum += g.pointsB - g.pointsA;
        a.marginGames++;
        b.marginGames++;
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
      let weighted = 0;
      for (const v of extra.values()) weighted += v;
      if (weighted !== 0) for (const id of played) add(id, -weighted / played.size);

      // Medians: each team against the week's average rating, at `medianWeight`, re-centred to sum to zero.
      const mg = medians.get(wk) ?? [];
      if (mg.length > 0) {
        const avg = mean(mg.map((m) => get(m.franchiseId).rating));
        const raw = mg.map((m) => {
          const r = get(m.franchiseId).rating;
          const sa = m.points > m.median ? 1 : m.points < m.median ? 0 : 0.5;
          const f =
            sa === 0.5 ? 1 : factor(Math.abs(m.points - m.median), sa === 1 ? r - avg : avg - r);
          return o.k * o.medianWeight * f * (sa - expectedScore(r, avg));
        });
        const centre = mean(raw);
        mg.forEach((m, i) => add(m.franchiseId, raw[i]! - centre));
      }

      for (const [id, d] of delta) get(id).rating += d;
    }
    for (const id of playing) {
      const st = get(id);
      st.seasonMargins.push(st.marginSum / st.marginGames);
    }
  }
  return [...state.values()].map(({ marginSum: _s, marginGames: _g, ...rating }) => rating);
}

// ---- Power rating -------------------------------------------------------------------------------------------------

export interface Placement {
  season: number;
  franchiseId: number;
  place: number;
  teamCount: number;
}

export interface PowerInput extends EloInput {
  /** Final places of completed seasons. */
  placements: readonly Placement[];
}

export interface PowerOptions {
  elo: EloOptions;
  /** Rating points removed per point of season-to-season margin spread above the median manager's (1 = per point). */
  consistencyWeight: number;
  /** Seasons needed before consistency counts. */
  consistencyMinSeasons: number;
  /** Careers shorter than this are pulled toward average: n / (n + shrink). */
  shrink: number;
  /** Rating points for a season's weighted placement of 100% versus 0% (a first place earns half, a last place loses half). */
  placementSpan: number;
  /** Multiplier on the summed placement bonus. */
  placementWeight: number;
  /** Share of the final score taken from the average weighted placement. */
  blend: number;
  /** Display scale: the league average maps to `center`, one standard deviation to `perSd` points. */
  center: number;
  perSd: number;
}

/** Owner decisions of 2026-10-07; the numbers are the 4x-scale experiment values divided by 4. */
export const DEFAULT_POWER: PowerOptions = {
  elo: DEFAULT_ELO,
  consistencyWeight: 0.75,
  consistencyMinSeasons: 3,
  shrink: 2,
  placementSpan: 40,
  placementWeight: 1.5,
  blend: 0.25,
  center: 1500,
  perSd: 250,
};

/** What the display scale is measured against: the league's full history, reused for filtered views. */
export interface PowerCalibration {
  eMean: number;
  eSd: number;
  wMean: number;
  wSd: number;
  bMean: number;
  bSd: number;
}

export interface PowerRow {
  franchiseId: number;
  /** The displayed Power Rating. */
  rating: number;
  /** The Elo before adjustments (see `computeElo`). */
  elo: number;
  games: number;
  wins: number;
  losses: number;
  ties: number;
  seasonsPlayed: number;
  seasonsMissed: number;
  /** Head-to-head win share (ties count half), null with no games. */
  winPct: number | null;
  /** Career average of (teams - place) / (teams - 1) over completed seasons, null with none. */
  placePct: number | null;
}

const popSd = (v: readonly number[]): number => {
  const mu = mean(v);
  return Math.sqrt(mean(v.map((x) => (x - mu) ** 2)));
};
const sampleSd = (v: readonly number[]): number =>
  v.length < 2 ? 0 : Math.sqrt(v.reduce((s, x) => s + (x - mean(v)) ** 2, 0) / (v.length - 1));

/** 1 for first place, 0 for last: a 2nd in a 14-team league outranks a 2nd in a 9-team league. */
export const weightedPlacement = (place: number, teamCount: number): number =>
  teamCount > 1 ? (teamCount - place) / (teamCount - 1) : 1;

/**
 * The Power Rating of every franchise that played. The rating is the Elo, minus a penalty for uneven seasons (the
 * spread of a manager's season margins above the median manager's, for careers of `consistencyMinSeasons`+), plus the
 * summed placement bonus; that score and the average weighted placement are z-scored, blended, and mapped to
 * `center` + `perSd` x z. `calibration` fixes the z-scores to another run's (the league's full history), so a view of
 * a few seasons is not stretched to look as decisive as the whole record; without it the run calibrates on itself.
 */
export function computePower(
  input: PowerInput,
  options: PowerOptions = DEFAULT_POWER,
  calibration?: PowerCalibration
): { rows: PowerRow[]; calibration: PowerCalibration } {
  const o = options;
  const elo = computeElo(input, o.elo);
  if (elo.length === 0) {
    return {
      rows: [],
      calibration: calibration ?? { eMean: 0, eSd: 1, wMean: 0, wSd: 1, bMean: 0, bSd: 1 },
    };
  }

  const spreads = new Map(elo.map((e) => [e.franchiseId, sampleSd(e.seasonMargins)]));
  const steady = elo
    .filter((e) => e.seasonsPlayed >= o.consistencyMinSeasons)
    .map((e) => spreads.get(e.franchiseId)!)
    .sort((a, b) => a - b);
  const medianSpread = steady[Math.floor(steady.length / 2)] ?? 0;

  const placed = new Map<number, number[]>();
  for (const p of input.placements) {
    const list = placed.get(p.franchiseId) ?? [];
    list.push(weightedPlacement(p.place, p.teamCount));
    placed.set(p.franchiseId, list);
  }

  const parts = elo.map((e) => {
    const n = e.seasonsPlayed;
    const penalty =
      n >= o.consistencyMinSeasons
        ? o.consistencyWeight * (spreads.get(e.franchiseId)! - medianSpread) * (n / (n + o.shrink))
        : 0;
    const wps = placed.get(e.franchiseId) ?? [];
    const bonus = o.placementWeight * wps.reduce((s, w) => s + o.placementSpan * (w - 0.5), 0);
    const placeAvg = wps.length > 0 ? mean(wps) : null;
    const shrunk =
      placeAvg === null ? 0.5 : 0.5 + (placeAvg - 0.5) * (wps.length / (wps.length + o.shrink));
    return { e, score: e.rating - penalty + bonus, shrunk, placeAvg };
  });

  const scores = parts.map((p) => p.score);
  const shrunk = parts.map((p) => p.shrunk);
  const cal0 = {
    eMean: mean(scores),
    eSd: popSd(scores) || 1,
    wMean: mean(shrunk),
    wSd: popSd(shrunk) || 1,
  };
  const c = calibration ?? { ...cal0, bMean: 0, bSd: 1 };
  const blendOf = (p: (typeof parts)[number]) =>
    (1 - o.blend) * ((p.score - c.eMean) / c.eSd) + o.blend * ((p.shrunk - c.wMean) / c.wSd);
  const blended = parts.map(blendOf);
  const cal: PowerCalibration = calibration ?? {
    ...cal0,
    bMean: mean(blended),
    bSd: popSd(blended) || 1,
  };

  const rows = parts.map((p, i) => ({
    franchiseId: p.e.franchiseId,
    rating: o.center + (o.perSd * (blended[i]! - cal.bMean)) / cal.bSd,
    elo: p.e.rating,
    games: p.e.games,
    wins: p.e.wins,
    losses: p.e.losses,
    ties: p.e.ties,
    seasonsPlayed: p.e.seasonsPlayed,
    seasonsMissed: p.e.seasonsMissed,
    winPct: p.e.games > 0 ? (p.e.wins + p.e.ties / 2) / p.e.games : null,
    placePct: p.placeAvg,
  }));
  return { rows, calibration: cal };
}
