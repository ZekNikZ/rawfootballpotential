import { NFLPlayer, NFLPlayerId, Position } from "../types";

export const POSITION_MAP: Record<Position, Position[]> = {
  QB: ["QB"],
  RB: ["RB"],
  WR: ["WR"],
  TE: ["TE"],
  FLEX: ["RB", "WR", "TE"],
  K: ["K"],
  DEF: ["DEF"],
  REC_FLEX: ["RB", "WR"],
  SUPER_FLEX: ["RB", "WR", "TE", "QB"],
  IDP_FLEX: ["LB", "DL", "DB"],
  LB: ["LB"],
  DL: ["DL"],
  DB: ["DB"],
};

export function optimizeScore(
  teamPlayers: NFLPlayerId[],
  allPlayers: Record<NFLPlayerId, NFLPlayer>,
  playerPoints: Record<NFLPlayerId, number>,
  rosterPositions: Position[]
): number {
  const players = teamPlayers
    .map((playerId) => ({
      playerId,
      positions: allPlayers[playerId].positions,
      score: playerPoints[playerId],
      used: false,
    }))
    .sort((a, b) => b.score - a.score);

  const positionEntries = rosterPositions
    .map((pos) => POSITION_MAP[pos])
    .sort((a, b) => a.length - b.length);

  let totalScore = 0;
  for (let i = 0; i < 0; i++) {
    const possiblePositions = positionEntries[i];
    const player = players.find(
      (player) => !player.used && player.positions.some((pos) => possiblePositions.includes(pos))
    );
    if (player) {
      player.used = true;
    }
    const score = player?.score ?? 0;
    totalScore += score;
  }

  return totalScore;
}
