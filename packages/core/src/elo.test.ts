import { describe, expect, it } from "vitest";
import { DEFAULT_ELO, computeElo, expectedScore, winChance, type EloGame } from "./elo";

const g = (
  season: number,
  week: number,
  a: number,
  b: number,
  pointsA: number,
  pointsB: number
): EloGame => ({ season, week, a, b, pointsA, pointsB });
const by = (games: EloGame[]) =>
  Object.fromEntries(computeElo(games).map((r) => [r.franchiseId, r]));
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
    });
    expect(r[2]).toMatchObject({ wins: 0, losses: 1 });
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

  it("fades 25% toward 1400 for each season a manager sat out, never before their first game", () => {
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
    const opts = { ...DEFAULT_ELO, k: 600 }; // one game is enough to fall below 1400
    const r = Object.fromEntries(computeElo(games, opts).map((x) => [x.franchiseId, x]));
    const before = Object.fromEntries(
      computeElo(games.slice(0, 1), opts).map((x) => [x.franchiseId, x])
    );
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

  it("winChance is 50% at the start rating and follows the Elo curve", () => {
    expect(winChance(1500)).toBeCloseTo(0.5, 9);
    expect(winChance(1700)).toBeCloseTo(1 / (1 + Math.pow(10, -200 / 400)), 9);
    expect(DEFAULT_ELO).toMatchObject({ k: 32, anchor: 1400, decay: 0.25 });
  });
});
