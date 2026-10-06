import type { Bracket, GameType, Id } from "./types";

/** One game of a source bracket (Sleeper: r = round, m = match, t1/t2 = roster ids once known, p = place decided). */
export interface BracketGame {
  round: number;
  match: number;
  team1: Id | null;
  team2: Id | null;
  /** Final place this game decides: 1 = championship, 3 = third-place game, 5 = fifth-place game, ... */
  placement?: number | null;
}

/** A week's real game as ingested (both teams known). */
export interface WeekGame {
  matchupId: Id;
  week: number;
  teamA: Id;
  teamB: Id;
}

export interface GameClassification {
  matchupId: Id;
  gameType: GameType;
  bracket: Bracket | null;
  bracketRound: number | null;
  placementAtStake: number | null;
  isChampionship: boolean;
}

export interface ClassifyInput {
  playoffWeekStart: number;
  /** Round 1 of every bracket is played in `playoffWeekStart`, round r in `playoffWeekStart + r - 1`. */
  winners: readonly BracketGame[];
  /** Undefined or empty for seasons without a losers bracket. */
  losers?: readonly BracketGame[] | undefined;
  games: readonly WeekGame[];
}

const pairKey = (a: Id, b: Id) => [String(a), String(b)].sort().join("|");

const NO_BRACKET = {
  bracket: null,
  bracketRound: null,
  placementAtStake: null,
  isChampionship: false,
} as const;

/**
 * Follow the bracket (doc §2): winners-bracket games, placement games included, are `playoffs`;
 * losers-bracket games are `toilet_bowl`; a playoff-week game found in neither bracket is `none`
 * (kept, but excluded from every scope). Weeks before `playoffWeekStart` are `regular`.
 * A game is matched to a bracket game by its week (round) and its pair of teams, never by guessing
 * from standings (doc §1.4 bug 6).
 */
export function classifyGames(input: ClassifyInput): GameClassification[] {
  const index = new Map<string, { bracket: Bracket; game: BracketGame }>();
  const add = (bracket: Bracket, games: readonly BracketGame[] | undefined) => {
    for (const g of games ?? []) {
      if (g.team1 === null || g.team2 === null) continue;
      const week = input.playoffWeekStart + g.round - 1;
      index.set(`${week}|${pairKey(g.team1, g.team2)}`, { bracket, game: g });
    }
  };
  add("losers", input.losers);
  add("winners", input.winners); // winners wins if a pair is (wrongly) in both

  return input.games.map((g): GameClassification => {
    if (g.week < input.playoffWeekStart) {
      return { matchupId: g.matchupId, gameType: "regular", ...NO_BRACKET };
    }
    const hit = index.get(`${g.week}|${pairKey(g.teamA, g.teamB)}`);
    if (!hit) return { matchupId: g.matchupId, gameType: "none" as GameType, ...NO_BRACKET };
    return {
      matchupId: g.matchupId,
      gameType: hit.bracket === "winners" ? "playoffs" : "toilet_bowl",
      bracket: hit.bracket,
      bracketRound: hit.game.round,
      placementAtStake: hit.game.placement ?? null,
      isChampionship: hit.bracket === "winners" && hit.game.placement === 1,
    };
  });
}
