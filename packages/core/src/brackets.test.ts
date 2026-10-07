import { describe, expect, it } from "vitest";
import { classifyGames, type BracketGame, type WeekGame } from "./brackets";

// 6-team playoff, weeks 15-17. Teams 1..12 are roster ids.
const winners: BracketGame[] = [
  { round: 1, match: 1, team1: 3, team2: 6 },
  { round: 1, match: 2, team1: 4, team2: 5 },
  { round: 2, match: 3, team1: 1, team2: 4 },
  { round: 2, match: 4, team1: 2, team2: 3 },
  { round: 3, match: 5, team1: 1, team2: 2, placement: 1 },
  { round: 3, match: 6, team1: 4, team2: 3, placement: 3 },
  { round: 3, match: 7, team1: 5, team2: 6, placement: 5 },
];
const losers: BracketGame[] = [
  { round: 1, match: 1, team1: 7, team2: 10 },
  { round: 1, match: 2, team1: 8, team2: 9 },
  { round: 2, match: 3, team1: 7, team2: 8, placement: 7 },
];
const game = (matchupId: number, week: number, teamA: number, teamB: number): WeekGame => ({
  matchupId,
  week,
  teamA,
  teamB,
});

describe("classifyGames (doc §2, §1.4 bug 6)", () => {
  const games = [
    game(1, 14, 1, 12), // regular season
    game(2, 15, 6, 3), // winners r1 (teams listed in either order)
    game(3, 15, 7, 10), // losers r1
    game(4, 17, 2, 1), // championship
    game(5, 17, 3, 4), // third-place game: still playoffs
    game(6, 17, 6, 5), // fifth-place game
    game(7, 16, 7, 8), // losers r2 placement
  ];
  const out = new Map(
    classifyGames({ playoffWeekStart: 15, winners, losers, games }).map((c) => [c.matchupId, c])
  );

  it("weeks before the playoffs are regular", () => {
    expect(out.get(1)?.gameType).toBe("regular");
  });

  it("winners bracket games (incl. placement games) are playoffs", () => {
    expect(out.get(2)).toMatchObject({ gameType: "playoffs", bracket: "winners", bracketRound: 1 });
    expect(out.get(5)).toMatchObject({
      gameType: "playoffs",
      placementAtStake: 3,
      isChampionship: false,
    });
    expect(out.get(6)).toMatchObject({ gameType: "playoffs", placementAtStake: 5 });
  });

  it("flags the championship game", () => {
    expect(out.get(4)).toMatchObject({
      gameType: "playoffs",
      placementAtStake: 1,
      isChampionship: true,
    });
  });

  it("losers bracket games are toilet_bowl", () => {
    expect(out.get(3)).toMatchObject({ gameType: "toilet_bowl", bracket: "losers" });
    expect(out.get(7)).toMatchObject({
      gameType: "toilet_bowl",
      placementAtStake: 7,
      isChampionship: false,
    });
  });

  it("a playoff-week game in neither bracket is 'none'", () => {
    const res = classifyGames({
      playoffWeekStart: 15,
      winners,
      games: [game(9, 16, 11, 12)],
    });
    expect(res[0]).toMatchObject({ gameType: "none", bracket: null });
  });

  it("seasons without a losers bracket: only winners games are classified, the rest are 'none'", () => {
    const res = classifyGames({
      playoffWeekStart: 15,
      winners,
      losers: undefined,
      games: [game(1, 15, 3, 6), game(2, 15, 7, 10)],
    });
    expect(res.map((r) => r.gameType)).toEqual(["playoffs", "none"]);
  });

  it("does not match the right pair in the wrong week", () => {
    const res = classifyGames({ playoffWeekStart: 15, winners, games: [game(1, 16, 3, 6)] });
    expect(res[0]?.gameType).toBe("none");
  });

  it("is not fooled by current standings: classification depends only on the bracket", () => {
    // Bug 6 guessed playoff vs toilet bowl from "team 1 in playoffQualifiedTeams". Here team 7 would be
    // a non-qualifier either way and team 3 a qualifier; swapping team order must not change anything.
    const a = classifyGames({ playoffWeekStart: 15, winners, losers, games: [game(1, 15, 3, 6)] });
    const b = classifyGames({ playoffWeekStart: 15, winners, losers, games: [game(1, 15, 6, 3)] });
    expect(a).toEqual(b);
  });
});
