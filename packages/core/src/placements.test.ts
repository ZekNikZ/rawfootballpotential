import { describe, expect, it } from "vitest";
import { derivePlacements, type PlacementGame } from "./placements";

// 2024 redraft (14 teams, 7 playoff teams): real shape from Sleeper's brackets and week 17 scores.
describe("derivePlacements", () => {
  const w = (
    placement: number,
    teamA: number,
    pointsA: number,
    teamB: number,
    pointsB: number
  ): PlacementGame => ({
    bracket: "winners",
    placement,
    teamA,
    teamB,
    pointsA,
    pointsB,
  });
  const l = (
    placement: number,
    teamA: number,
    pointsA: number,
    teamB: number,
    pointsB: number
  ): PlacementGame => ({
    ...w(placement, teamA, pointsA, teamB, pointsB),
    bracket: "losers",
  });

  const games: PlacementGame[] = [
    w(1, 11, 138.74, 14, 121.78),
    w(3, 10, 133.76, 9, 154.38),
    w(5, 5, 126.28, 4, 101.78),
    l(1, 8, 111.7, 6, 148.94),
    l(3, 12, 138.28, 2, 122.32),
    l(5, 3, 112.16, 1, 136.42),
  ];

  it("places winners-bracket games by score and losers-bracket games from last place up", () => {
    const res = derivePlacements({
      teamCount: 14,
      playoffTeams: [10, 5, 14, 13, 9, 4, 11],
      regularSeasonOrder: [11, 10, 14, 9, 5, 4, 13, 8, 7, 12, 6, 3, 2, 1],
      games,
    });
    // Matches the hand-entered final placements in the legacy config for roster ids 1..14.
    const legacy = [9, 12, 10, 6, 5, 13, 8, 14, 3, 4, 1, 11, 7, 2];
    expect([1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12, 13, 14].map((id) => res.get(id))).toEqual(
      legacy
    );
  });

  it("falls back to regular-season order when no game decides a place", () => {
    const res = derivePlacements({
      teamCount: 4,
      playoffTeams: ["a", "b"],
      regularSeasonOrder: ["a", "b", "c", "d"],
      games: [],
    });
    expect([...res.entries()]).toEqual([
      ["a", 1],
      ["b", 2],
      ["c", 3],
      ["d", 4],
    ]);
  });
});
