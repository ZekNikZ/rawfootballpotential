import { NFLData, NFLPlayerId } from "../../types";
import { BaseService } from "./base.service";

export class NFLService extends BaseService<unknown> {
  constructor() {
    super("nfl");
  }

  async getNFLData(): Promise<NFLData> {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const playerData: Record<string, Record<string, any>> = await (
      await fetch("https://api.sleeper.app/v1/players/nfl")
    ).json();

    return {
      teams: Object.fromEntries(
        Object.entries(playerData)
          .filter(([key]) => !/\d+/.test(key))
          .map(([teamId, data]) => [
            `NT-${teamId}`,
            {
              nflTeamId: `NT-${teamId}`,
              shortCode: teamId,
              name: `${data.first_name} ${data.last_name}`,
              avatar: `https://sleepercdn.com/images/team_logos/nfl/${teamId.toLowerCase()}.png`,
            },
          ])
      ),
      players: Object.fromEntries(
        Object.entries(playerData).map(([playerId, data]) => [
          playerId as NFLPlayerId,
          {
            playerId: playerId as NFLPlayerId,
            firstName: data.first_name,
            lastName: data.last_name,
            fullName: data.full_name,
            positions: data.fantasy_positions,
            age: data.age ?? null,
            nflTeamId: data.team,
            nflDepth: data.depth_chart_order ?? null,
            nflDepthPosition: data.depth_chart_position ?? null,
            nflPosition: data.position,
            injuryStatus: data.injury_status,
            avatar: /\d+/.test(playerId)
              ? `https://sleepercdn.com/content/nfl/players/thumb/${playerId}.jpg`
              : `https://sleepercdn.com/images/team_logos/nfl/${playerId.toLowerCase()}.png`,
            jerseyNumber: data.number ?? null,
          },
        ])
      ),
    };
  }
}

export const nflService = new NFLService();
