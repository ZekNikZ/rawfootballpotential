import { describe, expect, it } from "vitest";
import { playoffOdds, type OddsInput, type OddsWeek } from "./playoff-odds";

const week = (
  w: number,
  games: [number, number][],
  ids: number[],
  mean = 100,
  sd = 20
): OddsWeek => ({ week: w, games, teams: ids.map((id) => ({ id, mean, sd })) });

const ids = (n: number) => Array.from({ length: n }, (_, i) => i + 1);

describe("playoffOdds", () => {
  it("ranks a finished season by record, then points for, then id", () => {
    const out = playoffOdds({
      teams: [
        { id: 1, wins: 5, pf: 500 },
        { id: 2, wins: 5, pf: 520 },
        { id: 3, wins: 4, pf: 900 },
        { id: 4, wins: 5, pf: 520 },
      ],
      weeks: [],
      medianEnabled: false,
      playoffTeams: 2,
    });
    const byId = Object.fromEntries(out.map((o) => [o.teamId, o]));
    expect(byId[2]).toMatchObject({ probability: 1, clinched: true });
    expect(byId[4]).toMatchObject({ probability: 1, clinched: true }); // ties 2 on record and points: lower id first
    expect(byId[1]?.eliminated).toBe(true);
    expect(byId[3]?.eliminated).toBe(true);
  });

  it("is deterministic and its probabilities add up to the number of playoff spots", () => {
    const input: OddsInput = {
      teams: ids(6).map((id) => ({ id, wins: 4, pf: 400 + id })),
      weeks: [
        week(
          8,
          [
            [1, 2],
            [3, 4],
            [5, 6],
          ],
          ids(6)
        ),
        week(
          9,
          [
            [1, 3],
            [2, 5],
            [4, 6],
          ],
          ids(6)
        ),
      ],
      medianEnabled: false,
      playoffTeams: 3,
    };
    const a = playoffOdds(input);
    const b = playoffOdds(input);
    expect(a).toEqual(b);
    expect(a.reduce((s, t) => s + t.probability, 0)).toBeCloseTo(3, 6);
    for (const t of a) {
      expect(t.clinched).toBe(false);
      expect(t.eliminated).toBe(false);
    }
  });

  it("gives a stronger team a higher chance", () => {
    const strong = ids(4).map((id) => ({
      id,
      mean: id === 1 ? 130 : 100,
      sd: 15,
    }));
    const out = playoffOdds({
      teams: ids(4).map((id) => ({ id, wins: 3, pf: 300 })),
      weeks: [
        {
          week: 5,
          games: [
            [1, 2],
            [3, 4],
          ],
          teams: strong,
        },
        {
          week: 6,
          games: [
            [1, 3],
            [2, 4],
          ],
          teams: strong,
        },
        {
          week: 7,
          games: [
            [1, 4],
            [2, 3],
          ],
          teams: strong,
        },
      ],
      medianEnabled: false,
      playoffTeams: 2,
    });
    const p = Object.fromEntries(out.map((o) => [o.teamId, o.probability]));
    expect(p[1]).toBeGreaterThan(0.9);
    expect(p[1]).toBeGreaterThan(p[2]!);
  });

  it("declares clinched and eliminated only when it is mathematically certain", () => {
    // 6 teams, 3 spots, one week left: team 1 is 3 wins clear of 4-6; team 6 cannot catch the third spot.
    const out = playoffOdds({
      teams: [
        { id: 1, wins: 10, pf: 1000 },
        { id: 2, wins: 9, pf: 900 },
        { id: 3, wins: 8, pf: 800 },
        { id: 4, wins: 5, pf: 700 },
        { id: 5, wins: 4, pf: 600 },
        { id: 6, wins: 3, pf: 500 },
      ],
      weeks: [
        week(
          13,
          [
            [1, 6],
            [2, 5],
            [3, 4],
          ],
          ids(6)
        ),
      ],
      medianEnabled: false,
      playoffTeams: 3,
    });
    const o = Object.fromEntries(out.map((t) => [t.teamId, t]));
    expect(o[1]).toMatchObject({ clinched: true, probability: 1 });
    expect(o[2]).toMatchObject({ clinched: true, probability: 1 });
    expect(o[3]).toMatchObject({ clinched: true, probability: 1 });
    expect(o[4]).toMatchObject({ eliminated: true, probability: 0 });
    expect(o[5]).toMatchObject({ eliminated: true, probability: 0 });
    expect(o[6]).toMatchObject({ eliminated: true, probability: 0 });
  });

  it("does not clinch on a tie it can lose (points for is unbounded)", () => {
    // Team 1 is tied on wins with 2 and 3 going into the last games; 2 spots: nobody is certain.
    const out = playoffOdds({
      teams: [
        { id: 1, wins: 6, pf: 1000 },
        { id: 2, wins: 6, pf: 900 },
        { id: 3, wins: 6, pf: 800 },
      ],
      weeks: [week(14, [[1, 2]], [1, 2, 3])],
      medianEnabled: false,
      playoffTeams: 1,
    });
    expect(out.every((t) => !t.clinched)).toBe(true);
  });

  it("handles median games", () => {
    const out = playoffOdds({
      teams: ids(4).map((id) => ({ id, wins: id === 1 ? 9 : 3, pf: 100 * id })),
      weeks: [
        week(
          13,
          [
            [1, 2],
            [3, 4],
          ],
          ids(4)
        ),
        week(
          14,
          [
            [1, 3],
            [2, 4],
          ],
          ids(4)
        ),
      ],
      medianEnabled: true,
      playoffTeams: 1,
    });
    // Team 1 leads by 6 wins and only 4 are available to anyone else: clinched.
    expect(out.find((t) => t.teamId === 1)).toMatchObject({ clinched: true, probability: 1 });
    for (const t of out.filter((x) => x.teamId !== 1)) expect(t.eliminated).toBe(true);
  });

  it("declares nothing certain when the median cannot be split evenly", () => {
    const out = playoffOdds({
      teams: ids(3).map((id) => ({ id, wins: id === 1 ? 20 : 0, pf: 0 })),
      weeks: [week(14, [[2, 3]], ids(3))],
      medianEnabled: true,
      playoffTeams: 1,
    });
    expect(out.every((t) => !t.clinched && !t.eliminated)).toBe(true);
  });
});

/**
 * Ground truth by brute force on tiny leagues: every ordering of every remaining week's scores is possible, so "in the
 * playoffs in all of them" is exactly "clinched". The exact check must never claim a certainty that is false, and should
 * find most real ones.
 */
describe("playoffOdds exact check against brute force", () => {
  let seed = 12345;
  const rand = () => {
    seed = (Math.imul(seed, 1664525) + 1013904223) >>> 0;
    return seed / 4294967296;
  };
  const pick = (n: number) => Math.floor(rand() * n);

  function permutations(n: number): number[][] {
    if (n === 1) return [[0]];
    const out: number[][] = [];
    for (const p of permutations(n - 1))
      for (let i = 0; i <= p.length; i++) out.push([...p.slice(0, i), n - 1, ...p.slice(i)]);
    return out;
  }

  const permCache = new Map<number, number[][]>();
  const permsOf = (n: number) => {
    if (!permCache.has(n)) permCache.set(n, permutations(n));
    return permCache.get(n)!;
  };

  function truth(
    n: number,
    base: number[],
    pairs: [number, number][][],
    median: boolean,
    N: number
  ) {
    const clinched = new Array(n).fill(true);
    const eliminated = new Array(n).fill(true);
    const walk = (w: number, wins: number[]) => {
      if (w === pairs.length) {
        for (let t = 0; t < n; t++) {
          const geq = wins.filter((x, i) => i !== t && x >= wins[t]!).length;
          const gt = wins.filter((x, i) => i !== t && x > wins[t]!).length;
          if (geq >= N) clinched[t] = false;
          if (gt < N) eliminated[t] = false;
        }
        return;
      }
      if (!median) {
        // Without medians only each game's winner matters.
        const games = pairs[w]!;
        for (let mask = 0; mask < 1 << games.length; mask++) {
          const next = wins.slice();
          games.forEach(([a, b], g) => (next[mask & (1 << g) ? a : b]! += 1));
          walk(w + 1, next);
        }
        return;
      }
      for (const perm of permsOf(n)) {
        const next = wins.slice();
        for (const [a, b] of pairs[w]!) next[perm[a]! > perm[b]! ? a : b]! += 1;
        for (let t = 0; t < n; t++) if (perm[t]! >= n / 2) next[t]! += 1;
        walk(w + 1, next);
      }
    };
    walk(0, base);
    return { clinched, eliminated };
  }

  function randomLeague(n: number, weeks: number, median: boolean) {
    const base = Array.from({ length: n }, () => pick(7) + (rand() < 0.1 ? 0.5 : 0));
    const pairs: [number, number][][] = [];
    for (let w = 0; w < weeks; w++) {
      const order = Array.from({ length: n }, (_, i) => i).sort(() => rand() - 0.5);
      const games: [number, number][] = [];
      for (let i = 0; i < n; i += 2) games.push([order[i]!, order[i + 1]!]);
      pairs.push(games);
    }
    const N = 1 + pick(n - 1);
    const input: OddsInput = {
      teams: base.map((wins, i) => ({ id: i + 1, wins, pf: 100 * (i + 1) })),
      weeks: pairs.map((games, w) => ({
        week: w + 1,
        games: games.map(([a, b]) => [a + 1, b + 1] as [number, number]),
        teams: Array.from({ length: n }, (_, i) => ({ id: i + 1, mean: 100, sd: 10 })),
      })),
      medianEnabled: median,
      playoffTeams: N,
      sims: 5,
    };
    return { base, pairs, N, input };
  }

  for (const [n, weeks, median] of [
    [4, 2, false],
    [4, 3, false],
    [6, 2, false],
    [4, 2, true],
    [4, 3, true],
  ] as const) {
    it(`never claims a false certainty (${n} teams, ${weeks} weeks, median ${median})`, () => {
      let trueCertain = 0;
      let found = 0;
      for (let trial = 0; trial < 60; trial++) {
        const { base, pairs, N, input } = randomLeague(n, weeks, median);
        const real = truth(n, base, pairs, median, N);
        const out = playoffOdds(input);
        out.forEach((o, i) => {
          if (o.clinched) expect(real.clinched[i], `clinched ${trial}/${i}`).toBe(true);
          if (o.eliminated) expect(real.eliminated[i], `eliminated ${trial}/${i}`).toBe(true);
          if (real.clinched[i]) {
            trueCertain++;
            if (o.clinched) found++;
          }
          if (real.eliminated[i]) {
            trueCertain++;
            if (o.eliminated) found++;
          }
        });
      }
      // The check is exhaustive over head-to-head results here, so it should find nearly every real certainty.
      expect(found / Math.max(1, trueCertain)).toBeGreaterThan(0.9);
    }, 120_000);
  }
});
