import { describe, expect, it } from "vitest";
import {
  DEFAULT_ELO,
  DEFAULT_POWER,
  computeElo,
  computePower,
  expectedScore,
  weightedPlacement,
  winChance,
  type EloGame,
  type EloOptions,
  type GameKind,
  type MedianGame,
  type Placement,
} from "./elo";

const g = (
  season: number,
  week: number,
  a: number,
  b: number,
  pointsA: number,
  pointsB: number,
  kind?: GameKind
): EloGame => ({ season, week, a, b, pointsA, pointsB, ...(kind ? { kind } : {}) });
const med = (
  season: number,
  week: number,
  franchiseId: number,
  points: number,
  median: number
): MedianGame => ({ season, week, franchiseId, points, median });

/** The plain model of the first version: full margin, no weights, no medians, 1400 floor. */
const PLAIN: EloOptions = {
  ...DEFAULT_ELO,
  marginShare: 1,
  playoffWinWeight: 1,
  toiletLossWeight: 1,
  medianWeight: 0,
  anchor: 1400,
};
const by = (games: EloGame[], o: EloOptions = PLAIN, medians: MedianGame[] = []) =>
  Object.fromEntries(computeElo({ games, medians }, o).map((r) => [r.franchiseId, r]));
const norm = Math.log(1 + 31 / 10);

describe("computeElo", () => {
  it("moves two equal managers by K x margin factor x 0.5, zero-sum", () => {
    const r = by([g(2030, 1, 1, 2, 100, 90)]); // margin 10, even ratings
    const d = 32 * (Math.log(1 + 10 / 10) / norm) * 0.5;
    expect(r[1]!.rating).toBeCloseTo(1500 + d, 9);
    expect(r[2]!.rating).toBeCloseTo(1500 - d, 9);
    expect(r[1]).toMatchObject({
      games: 1,
      wins: 1,
      losses: 0,
      seasonsPlayed: 1,
      seasonsMissed: 0,
      seasonMargins: [10],
    });
    expect(r[2]).toMatchObject({ wins: 0, losses: 1, seasonMargins: [-10] });
  });

  it("half margin uses half of the margin factor and half of the plain result", () => {
    const full = by([g(2030, 1, 1, 2, 100, 90)])[1]!.rating - 1500;
    const f = Math.log(2) / norm; // margin factor of a 10-point win, ratings even
    const half = by([g(2030, 1, 1, 2, 100, 90)], { ...PLAIN, marginShare: 0.5 })[1]!.rating - 1500;
    expect(half).toBeCloseTo(32 * (1 + 0.5 * (f - 1)) * 0.5, 9);
    expect(full).toBeCloseTo(32 * f * 0.5, 9);
    // no margin at all: a win is a win
    const flat = by([g(2030, 1, 1, 2, 100, 10)], { ...PLAIN, marginShare: 0 })[1]!.rating - 1500;
    expect(flat).toBeCloseTo(16, 9);
  });

  it("a bigger margin moves ratings more, and a repeat win by the favourite moves them less", () => {
    const small = by([g(2030, 1, 1, 2, 100, 95)])[1]!.rating;
    const big = by([g(2030, 1, 1, 2, 160, 95)])[1]!.rating;
    expect(big).toBeGreaterThan(small);
    const twice = by([g(2030, 1, 1, 2, 120, 90), g(2030, 2, 1, 2, 120, 90)])[1]!.rating;
    const once = by([g(2030, 1, 1, 2, 120, 90)])[1]!.rating;
    expect(twice - once).toBeLessThan(once - 1500);
  });

  it("games of one week use the ratings from the start of the week", () => {
    const r = by([g(2030, 1, 1, 2, 100, 90), g(2030, 1, 3, 4, 100, 90)]);
    expect(r[1]!.rating).toBeCloseTo(r[3]!.rating, 9);
    expect(r[2]!.rating).toBeCloseTo(r[4]!.rating, 9);
  });

  it("a tie moves the lower-rated manager up with no margin factor", () => {
    const r = by([g(2030, 1, 1, 2, 100, 90), g(2030, 2, 1, 2, 100, 100)]);
    const after1 = by([g(2030, 1, 1, 2, 100, 90)]);
    const e = expectedScore(after1[2]!.rating, after1[1]!.rating);
    expect(r[2]!.rating - after1[2]!.rating).toBeCloseTo(32 * (0.5 - e), 9);
    expect(r[2]).toMatchObject({ ties: 1, wins: 0, losses: 1 });
  });

  it("fades 25% toward the anchor for each season a manager sat out, never before their first game", () => {
    const games = [
      g(2030, 1, 1, 2, 100, 90), // 1 and 2 play 2030
      g(2030, 1, 3, 4, 100, 90),
      g(2031, 1, 3, 4, 100, 90), // 2031: only 3 and 4 play
      g(2032, 1, 3, 5, 100, 90), // 2032: 5 debuts, 1 and 2 are still away
    ];
    const r = by(games);
    const after2030 = by(games.slice(0, 2));
    const faded = (x: number, seasons: number) => 1400 + (x - 1400) * 0.75 ** seasons;
    expect(r[1]!.rating).toBeCloseTo(faded(after2030[1]!.rating, 2), 9);
    expect(r[1]).toMatchObject({ seasonsPlayed: 1, seasonsMissed: 2 });
    expect(r[1]!.rating).toBeLessThan(after2030[1]!.rating); // a strong manager loses rating by sitting out
    expect(r[2]!.rating).toBeCloseTo(faded(after2030[2]!.rating, 2), 9);
    expect(r[5]).toMatchObject({ seasonsPlayed: 1, seasonsMissed: 0 }); // joined late: nothing missed
  });

  it("a manager already below the anchor is lifted toward it while away", () => {
    const games = [g(2030, 1, 1, 2, 100, 50), g(2031, 1, 3, 4, 100, 90)];
    const opts = { ...PLAIN, k: 600 }; // one game is enough to fall below 1400
    const r = by(games, opts);
    const before = by(games.slice(0, 1), opts);
    expect(before[2]!.rating).toBeLessThan(1400);
    expect(r[2]!.rating).toBeGreaterThan(before[2]!.rating);
    expect(r[2]!.rating).toBeLessThan(1400);
  });

  it("orders seasons chronologically whatever the input order, and is zero-sum without fades", () => {
    const games = [g(2031, 2, 2, 1, 80, 120), g(2030, 1, 1, 2, 100, 90), g(2031, 1, 1, 2, 70, 90)];
    const a = by(games);
    const b = by([...games].reverse());
    expect(a[1]!.rating).toBeCloseTo(b[1]!.rating, 9);
    expect(a[1]!.rating + a[2]!.rating).toBeCloseTo(3000, 9);
  });

  it("playoff wins count more, toilet-bowl losses count more, and the week stays zero-sum", () => {
    const week = (kind: GameKind) => [
      g(2030, 1, 1, 2, 100, 90, kind),
      g(2030, 1, 3, 4, 100, 90, kind),
      g(2030, 1, 5, 6, 100, 90, kind),
    ];
    const o = { ...PLAIN, playoffWinWeight: 1.5, toiletLossWeight: 1.5 };
    const base = by(week("regular"), o);
    const po = by(week("playoffs"), o);
    const tb = by(week("toilet_bowl"), o);
    const sum = (r: ReturnType<typeof by>) => Object.values(r).reduce((s, x) => s + x.rating, 0);
    expect(sum(po)).toBeCloseTo(9000, 9);
    expect(sum(tb)).toBeCloseTo(9000, 9);
    // the winner gains more than in a regular game, the loser (before re-centring) loses the same
    expect(po[1]!.rating).toBeGreaterThan(base[1]!.rating);
    expect(tb[2]!.rating).toBeLessThan(base[2]!.rating);
    // the extra half-weight taken from the three losers (3 x 0.5 x d) is handed back evenly to the six who played
    const d = base[1]!.rating - 1500;
    expect(tb[1]!.rating - 1500).toBeCloseTo(d + (3 * 0.5 * d) / 6, 9);
    expect(tb[2]!.rating - 1500).toBeCloseTo(-1.5 * d + (3 * 0.5 * d) / 6, 9);
  });

  it("median games are zero-sum each week, in any season, and a win over the median lifts a rating", () => {
    const games = [g(2030, 1, 1, 2, 100, 90), g(2030, 1, 3, 4, 100, 90)];
    const medians = [
      med(2030, 1, 1, 110, 100),
      med(2030, 1, 2, 90, 100),
      med(2030, 1, 3, 101, 100),
      med(2030, 1, 4, 99, 100),
    ];
    const o = { ...PLAIN, medianWeight: 0.5 };
    const r = by(games, o, medians);
    const without = by(games, o);
    expect(Object.values(r).reduce((s, x) => s + x.rating, 0)).toBeCloseTo(6000, 9);
    expect(r[1]!.rating).toBeGreaterThan(without[1]!.rating);
    expect(r[2]!.rating).toBeLessThan(without[2]!.rating);
    // medianWeight 0 ignores the median games entirely
    expect(by(games, PLAIN, medians)[1]!.rating).toBeCloseTo(without[1]!.rating, 9);
    // median games do not count as games
    expect(r[1]!.games).toBe(1);
  });

  it("winChance is 50% at the start rating and follows the Elo curve", () => {
    expect(winChance(1500)).toBeCloseTo(0.5, 9);
    expect(winChance(1700)).toBeCloseTo(1 / (1 + Math.pow(10, -200 / 400)), 9);
    expect(DEFAULT_ELO).toMatchObject({ k: 32, anchor: 1387.5, decay: 0.25, marginShare: 0.5 });
  });
});

const place = (season: number, franchiseId: number, p: number, teamCount: number): Placement => ({
  season,
  franchiseId,
  place: p,
  teamCount,
});

describe("computePower", () => {
  // Three seasons, six managers; 1 always beats 2, 3 beats 4, 5 beats 6, by different margins.
  const games: EloGame[] = [];
  for (const s of [2030, 2031, 2032])
    for (const w of [1, 2]) {
      games.push(
        g(s, w, 1, 2, 120, 100),
        g(s, w, 3, 4, 100 + 10 * s - 20300, 95),
        g(s, w, 5, 6, 90, 100)
      );
    }
  const placements: Placement[] = [2030, 2031, 2032].flatMap((s) => [
    place(s, 1, 1, 6),
    place(s, 3, 2, 6),
    place(s, 5, 6, 6),
  ]);

  it("puts the league average at 1500 and one standard deviation at 250 points", () => {
    const { rows } = computePower({ games, placements }, DEFAULT_POWER);
    // the display score is a z-score blend of two measures, re-standardised, so it averages 1500 with sd 250
    const r = rows.map((x) => x.rating);
    const mu = r.reduce((s, x) => s + x, 0) / r.length;
    expect(mu).toBeCloseTo(1500, 6);
    expect(Math.sqrt(r.reduce((s, x) => s + (x - mu) ** 2, 0) / r.length)).toBeCloseTo(250, 6);
  });

  it("ranks the better results first and reports record, win share and weighted placement", () => {
    const { rows } = computePower({ games, placements }, DEFAULT_POWER);
    const byId = Object.fromEntries(rows.map((x) => [x.franchiseId, x]));
    expect(byId[1]!.rating).toBeGreaterThan(byId[2]!.rating);
    expect(byId[1]).toMatchObject({ wins: 6, losses: 0, games: 6, winPct: 1, placePct: 1 });
    expect(byId[6]).toMatchObject({ winPct: 1, placePct: null });
    expect(byId[5]).toMatchObject({ winPct: 0, placePct: 0 });
    expect(byId[2]!.placePct).toBeNull();
  });

  it("a better final placement raises the rating, all else equal", () => {
    const low = computePower({
      games,
      placements: placements.map((p) => (p.franchiseId === 2 ? p : p)),
    });
    const bonus = [...placements, place(2030, 2, 1, 6), place(2031, 2, 1, 6), place(2032, 2, 1, 6)];
    const high = computePower({ games, placements: bonus });
    const pick = (res: typeof low, id: number) =>
      res.rows.find((x) => x.franchiseId === id)!.rating;
    expect(pick(high, 2)).toBeGreaterThan(pick(low, 2));
  });

  it("a fixed calibration keeps a filtered run on the full run's scale", () => {
    const full = computePower({ games, placements });
    const only2032 = {
      games: games.filter((x) => x.season === 2032),
      placements: placements.filter((p) => p.season === 2032),
    };
    const own = computePower(only2032);
    const on = computePower(only2032, DEFAULT_POWER, full.calibration);
    const spread = (rows: typeof own.rows) =>
      Math.max(...rows.map((x) => x.rating)) - Math.min(...rows.map((x) => x.rating));
    expect(spread(own.rows)).toBeGreaterThan(0);
    // standing on its own it re-stretches to sd 250; on the full scale the same ordering is kept
    const order = (rows: typeof own.rows) =>
      [...rows].sort((a, b) => b.rating - a.rating).map((x) => x.franchiseId);
    expect(order(on.rows)).toEqual(order(own.rows));
    expect(on.calibration).toEqual(full.calibration);
    expect(on.rows).toHaveLength(own.rows.length);
  });

  it("returns nothing for no games", () => {
    expect(computePower({ games: [], placements: [] }).rows).toEqual([]);
  });

  it("weights a place by league size", () => {
    expect(weightedPlacement(1, 14)).toBe(1);
    expect(weightedPlacement(14, 14)).toBe(0);
    expect(weightedPlacement(2, 14)).toBeGreaterThan(weightedPlacement(2, 9));
    expect(weightedPlacement(1, 1)).toBe(1);
  });
});
