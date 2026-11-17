/**
 * Playoff odds for a season still in its regular season.
 *
 * Two parts that never contradict each other:
 *  1. A seeded Monte Carlo simulation of the remaining weeks gives the in-between percentages. Every team's score in
 *     every remaining week is drawn from a normal distribution (mean = projected score, sd from the lineup); head-to-head
 *     games and the weekly median games (when the league has them) are decided by the same drawn scores, and teams are
 *     ranked the way the site's standings are: record (a tie counts half), then points for, then team id.
 *  2. An exact check decides 100% ("clinched": in the playoffs in every possible outcome) and 0% ("eliminated": out in
 *     every possible outcome). The simulation alone never reports either. The check is sound, never wrong, but it may
 *     miss a certainty it cannot prove: it is exhaustive over the remaining head-to-head results only when few remain
 *     (`maxFreeGames`), otherwise it uses cheaper bounds.
 *
 * Rules of the exact check (doc "Playoff odds"):
 *  - A tie on wins is assumed to go against the team being checked for a clinch, and in its favor for an elimination
 *    (points for is not bounded, so it can never prove anything).
 *  - Future exact ties (two equal scores in a game or at the median) are treated as impossible. Ties already in the
 *    records are respected (a tie is half a win).
 *  - Median results in a week: exactly half the teams win, half lose, and a team gets at most one per week. Needs an even
 *    number of teams in every remaining week; otherwise nothing is declared certain.
 */

export interface OddsTeam {
  id: number;
  /** Wins so far, a tie counting 0.5 (median games included when the league has them). */
  wins: number;
  /** Points for so far (head-to-head games only). */
  pf: number;
}

export interface OddsWeekTeam {
  id: number;
  /** Expected final score this week. */
  mean: number;
  /** Standard deviation of the final score (0 = already decided). */
  sd: number;
}

export interface OddsWeek {
  week: number;
  /** Head-to-head games still to be decided, as pairs of team ids. */
  games: readonly (readonly [number, number])[];
  /** Every team that scores this week (the median is taken over these). */
  teams: readonly OddsWeekTeam[];
}

export interface OddsInput {
  teams: readonly OddsTeam[];
  weeks: readonly OddsWeek[];
  /** The league also counts a win or loss against the weekly median. */
  medianEnabled: boolean;
  /** Teams that make the playoffs. */
  playoffTeams: number;
  /** Simulations (default 20,000). */
  sims?: number;
  seed?: number;
  /** The exact check enumerates results of at most this many unplayed games not involving the team (default 18). */
  maxFreeGames?: number;
}

export interface TeamOdds {
  teamId: number;
  /** Simulated chance of making the playoffs, 0-1 (exactly 1 / 0 when clinched / eliminated). */
  probability: number;
  clinched: boolean;
  eliminated: boolean;
}

const DEFAULT_SIMS = 20_000;
const DEFAULT_MAX_FREE_GAMES = 18;

/** Deterministic PRNG (mulberry32): the same inputs always give the same percentages. */
function rng(seed: number): () => number {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

function medianOf(values: number[]): number {
  const s = [...values].sort((a, b) => a - b);
  const mid = Math.floor(s.length / 2);
  return s.length % 2 === 1 ? s[mid]! : (s[mid - 1]! + s[mid]!) / 2;
}

/** Order used everywhere: wins, then points for, then id (the standings' sort). Returns true when a ranks above b. */
function above(
  aw: number,
  apf: number,
  aid: number,
  bw: number,
  bpf: number,
  bid: number
): boolean {
  if (aw !== bw) return aw > bw;
  if (apf !== bpf) return apf > bpf;
  return aid < bid;
}

function simulate(input: OddsInput, index: Map<number, number>): number[] {
  const n = input.teams.length;
  const sims = input.sims ?? DEFAULT_SIMS;
  const rand = rng(input.seed ?? 20_260_001);
  const baseWins = input.teams.map((t) => t.wins);
  const basePf = input.teams.map((t) => t.pf);
  const ids = input.teams.map((t) => t.id);
  const made = new Array<number>(n).fill(0);
  const wins = new Array<number>(n).fill(0);
  const pf = new Array<number>(n).fill(0);
  const score = new Array<number>(n).fill(0);
  const order = Array.from({ length: n }, (_, i) => i);
  const weeks = input.weeks.map((w) => ({
    teams: w.teams.map((t) => ({ i: index.get(t.id)!, mean: t.mean, sd: t.sd })),
    games: w.games.map(([a, b]) => [index.get(a)!, index.get(b)!] as const),
  }));
  let spare: number | null = null;
  const normal = () => {
    if (spare !== null) {
      const v = spare;
      spare = null;
      return v;
    }
    let u = 0;
    while (u === 0) u = rand();
    const r = Math.sqrt(-2 * Math.log(u));
    const th = 2 * Math.PI * rand();
    spare = r * Math.sin(th);
    return r * Math.cos(th);
  };

  for (let s = 0; s < sims; s++) {
    for (let i = 0; i < n; i++) {
      wins[i] = baseWins[i]!;
      pf[i] = basePf[i]!;
    }
    for (const w of weeks) {
      for (const t of w.teams) score[t.i] = t.sd > 0 ? t.mean + t.sd * normal() : t.mean;
      for (const [a, b] of w.games) {
        const sa = score[a]!;
        const sb = score[b]!;
        if (sa > sb) wins[a]! += 1;
        else if (sa < sb) wins[b]! += 1;
        else {
          wins[a]! += 0.5;
          wins[b]! += 0.5;
        }
        pf[a]! += sa;
        pf[b]! += sb;
      }
      if (input.medianEnabled) {
        const med = medianOf(w.teams.map((t) => score[t.i]!));
        for (const t of w.teams) {
          const sc = score[t.i]!;
          if (sc > med) wins[t.i]! += 1;
          else if (sc === med) wins[t.i]! += 0.5;
        }
      }
    }
    order.sort((x, y) => (above(wins[x]!, pf[x]!, ids[x]!, wins[y]!, pf[y]!, ids[y]!) ? -1 : 1));
    for (let k = 0; k < Math.min(input.playoffTeams, n); k++) made[order[k]!]! += 1;
  }
  return made.map((m) => m / sims);
}

/** Final order when nothing is left to play. */
function decided(input: OddsInput): TeamOdds[] {
  const ranked = [...input.teams].sort((a, b) =>
    above(a.wins, a.pf, a.id, b.wins, b.pf, b.id) ? -1 : 1
  );
  const inIds = new Set(ranked.slice(0, input.playoffTeams).map((t) => t.id));
  return input.teams.map((t) => ({
    teamId: t.id,
    probability: inIds.has(t.id) ? 1 : 0,
    clinched: inIds.has(t.id),
    eliminated: !inIds.has(t.id),
  }));
}

interface Certainty {
  clinched: boolean;
  eliminated: boolean;
}

/** Sound proof of "in every outcome" / "in no outcome". See the header for the rules. */
function certainties(input: OddsInput, index: Map<number, number>): Certainty[] {
  const n = input.teams.length;
  const N = input.playoffTeams;
  const none = input.teams.map<Certainty>(() => ({ clinched: false, eliminated: false }));
  if (N >= n) return input.teams.map(() => ({ clinched: true, eliminated: false }));
  if (N <= 0) return input.teams.map(() => ({ clinched: false, eliminated: true }));

  const R = input.medianEnabled ? input.weeks.length : 0;
  if (input.medianEnabled && input.weeks.some((w) => w.teams.length !== n || n % 2 !== 0))
    return none;
  const H = n / 2; // median winners per week

  const base = input.teams.map((t) => t.wins);
  const games = input.weeks.flatMap((w) =>
    w.games.map(([a, b]) => [index.get(a)!, index.get(b)!] as const)
  );
  const gamesOf = new Array<number>(n).fill(0);
  for (const [a, b] of games) {
    gamesOf[a]! += 1;
    gamesOf[b]! += 1;
  }
  const cap = input.maxFreeGames ?? DEFAULT_MAX_FREE_GAMES;

  /** Most teams (of those with `need` median wins) that can be lifted to the threshold: a Gale-Ryser budget. */
  const bucket = new Array<number>(R + 1).fill(0);
  const reachable = (v: number[], skip: number, threshold: number): number => {
    bucket.fill(0);
    for (let i = 0; i < n; i++) {
      if (i === skip) continue;
      const need = Math.max(0, Math.ceil(threshold - v[i]!));
      if (need <= R) bucket[need]! += 1;
    }
    let count = bucket[0]!;
    let budget = H * R;
    for (let c = 1; c <= R; c++) {
      const take = Math.min(bucket[c]!, Math.floor(budget / c));
      count += take;
      budget -= take * c;
      if (take < bucket[c]!) break;
    }
    return count;
  };

  /** Fewest other teams that must finish strictly above `M` when team `skip` wins everything. */
  const extraBucket = new Array<number>(R + 1).fill(0);
  const forcedAbove = (v: number[], skip: number, M: number): number => {
    extraBucket.fill(0);
    let count = 0;
    let free = 0;
    for (let i = 0; i < n; i++) {
      if (i === skip) continue;
      if (v[i]! > M) {
        count += 1;
        free += R;
      } else {
        const s = Math.min(R, Math.floor(M - v[i]!));
        free += s;
        extraBucket[R - s]! += 1;
      }
    }
    let q = (H - 1) * R - free;
    for (let e = R; e >= 1 && q > 0; e--) {
      const take = Math.min(extraBucket[e]!, Math.ceil(q / e));
      count += take;
      q -= take * e;
    }
    return count;
  };

  return input.teams.map((_, T) => {
    const result: Certainty = { clinched: false, eliminated: false };
    const mine = games.filter(([a, b]) => a === T || b === T);
    const free = games.filter(([a, b]) => a !== T && b !== T);

    // ---- clinched: T loses everything; others win their games against T ----
    const worst = base[T]!;
    const reachableCount = (v: number[]) => reachable(v, T, worst);
    let reach = 0;
    for (let i = 0; i < n; i++) if (i !== T && base[i]! + gamesOf[i]! + R >= worst) reach += 1;
    if (reach <= N - 1) result.clinched = true;
    else if (free.length <= cap) {
      const start = base.slice();
      for (const [a, b] of mine) start[a === T ? b : a]! += 1;
      const v = new Array<number>(n);
      let sound = true;
      for (let mask = 0; mask < 1 << free.length; mask++) {
        for (let i = 0; i < n; i++) v[i] = start[i]!;
        for (let g = 0; g < free.length; g++) {
          const [a, b] = free[g]!;
          v[mask & (1 << g) ? a : b]! += 1;
        }
        if (reachableCount(v) >= N) {
          sound = false;
          break;
        }
      }
      result.clinched = sound;
    }
    // ---- eliminated: T wins everything; others lose their games against T ----
    const best = base[T]! + gamesOf[T]! + R;
    let surely = 0;
    for (let i = 0; i < n; i++) if (i !== T && base[i]! > best) surely += 1;
    if (surely >= N) result.eliminated = true;
    else if (free.length <= cap) {
      const v = new Array<number>(n);
      let proven = true;
      for (let mask = 0; mask < 1 << free.length; mask++) {
        for (let i = 0; i < n; i++) v[i] = base[i]!;
        for (let g = 0; g < free.length; g++) {
          const [a, b] = free[g]!;
          v[mask & (1 << g) ? a : b]! += 1;
        }
        if (forcedAbove(v, T, best) < N) {
          proven = false;
          break;
        }
      }
      result.eliminated = proven;
    }
    return result;
  });
}

/** Playoff odds for every team: simulated percentages, with exact clinched / eliminated overriding them. */
export function playoffOdds(input: OddsInput): TeamOdds[] {
  if (input.teams.length === 0) return [];
  if (input.weeks.every((w) => w.games.length === 0 && !input.medianEnabled)) return decided(input);
  const index = new Map(input.teams.map((t, i) => [t.id, i]));
  const sim = simulate(input, index);
  const cert = certainties(input, index);
  return input.teams.map((t, i) => {
    const c = cert[i]!;
    const clinched = c.clinched && !c.eliminated;
    const eliminated = c.eliminated && !c.clinched;
    return {
      teamId: t.id,
      probability: clinched ? 1 : eliminated ? 0 : sim[i]!,
      clinched,
      eliminated,
    };
  });
}
