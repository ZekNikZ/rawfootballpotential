import { sleeperApi } from '../api';
import { NFLData } from '../types';

export async function loadNFLData(): Promise<NFLData> {
  const playerData: Record<string, Record<string, any>> = (await sleeperApi.get('/players/nfl'))
    .data;
  return {
    teams: Object.fromEntries(
      Object.entries(playerData)
        .filter(([key]) => !/\d+/.test(key))
        .map(([teamId, data]) => [
          teamId,
          {
            teamId,
            name: `${data.first_name} ${data.last_name}`,
            iconURL: `https://sleepercdn.com/images/team_logos/nfl/${teamId.toLowerCase()}.png`,
          },
        ])
    ),
    players: Object.fromEntries(
      Object.entries(playerData).map(([playerId, data]) => [
        playerId,
        {
          playerId,
          firstName: data.first_name,
          lastName: data.last_name,
          positions: data.fantasy_positions,
          age: data.age ?? null,
          teamId: data.team,
          nflDepth: data.depth_chart_order ?? null,
          nflDepthPosition: data.depth_chart_position ?? null,
          nflPosition: data.position,
          injuryStatus: data.injury_status,
          avatarURL: /\d+/.test(playerId)
            ? `https://sleepercdn.com/content/nfl/players/thumb/${playerId}.jpg`
            : `https://sleepercdn.com/images/team_logos/nfl/${playerId.toLowerCase()}.png`,
          jerseyNumber: data.number ?? null,
        },
      ])
    ),
  };
}
