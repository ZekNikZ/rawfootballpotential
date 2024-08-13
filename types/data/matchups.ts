import { LeagueId, MatchupId, NFLPlayerId, TeamId } from "./ids";

export interface Matchup {
  matchupId: MatchupId;
  leagueId: LeagueId;
  week: number;
  team1: MatchupTeam;
  team2: MatchupTeam | "BYE" | "TBD";
}

type MatchupTeam = {
  teamId: TeamId;
  points: number;
} & (
  | {
      hasPlayerData: false;
    }
  | {
      hasPlayerData: true;
      players: (NFLPlayerId | null)[];
      bench: NFLPlayerId[];
      injuryReserve: NFLPlayerId[];
      playerPoints: Record<NFLPlayerId, number>;
      playerProjectedPoints?: Record<NFLPlayerId, number>;
    }
);

export interface Bracket {
  matchupes: BracketMatchup[];
}

// TODO: Might just wanna get rid of this entirely
export interface BracketMatchup {
  round: number;
  matchupId: MatchupId;
  team1:
    | { source: "determined"; rosterId: TeamId }
    | {
        source: "previous-matchup";
        matchupId: MatchupId;
        result: "loser" | "winner";
      }
    | { source: "TBD" };
  team2:
    | { source: "determined"; rosterId: TeamId }
    | {
        source: "previous-matchup";
        matchupId: MatchupId;
        result: "loser" | "winner";
      }
    | { source: "TBD" }
    | { source: "BYE" };
  winner: TeamId | null;
  loser: TeamId | null;
  determinesPlacement: number | null;
}
