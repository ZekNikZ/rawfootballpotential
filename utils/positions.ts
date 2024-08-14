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
  IDP_FLEX: ["LB", "DL", "DB", "DE", "CB"],
  LB: ["LB"],
  DL: ["DL"],
  DB: ["DB"],
  DE: ["DE"],
  CB: ["CB"],
};

export function optimizeScore(
  teamPlayers: NFLPlayerId[],
  allPlayers: Record<NFLPlayerId, NFLPlayer>,
  playerPoints: Record<NFLPlayerId, number>,
  rosterPositions: Position[],
  log?: boolean
): number {
  const players = teamPlayers
    .map((playerId) => ({
      playerId,
      position: allPlayers[playerId].nflPosition,
      score: playerPoints[playerId],
      used: false,
    }))
    .sort((a, b) => b.score - a.score);

  const positionEntries = rosterPositions
    .map((pos) => POSITION_MAP[pos])
    .sort((a, b) => a.length - b.length);

  if (log) {
    console.log(rosterPositions);
    console.log(players);
    console.log(positionEntries);
  }

  let totalScore = 0;
  for (let i = 0; i < positionEntries.length; i++) {
    const possiblePositions = positionEntries[i];
    const player = players.find(
      (player) => !player.used && possiblePositions.includes(player.position)
    );
    if (player) {
      if (log) {
        console.log(
          `Picked ${player.playerId} (${player.position}) for ${possiblePositions} with ${player.score}`
        );
      }
      player.used = true;
    } else {
      if (log) {
        console.log(`No valid pick for ${possiblePositions}`);
      }
    }
    const score = player?.score ?? 0;
    totalScore += score;
  }

  return totalScore;
}
