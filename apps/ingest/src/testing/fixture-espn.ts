// A hand-built ESPN season (what the scraper stores) for tests: 4 teams, weeks 1-2 regular, week 3 a final (winners
// bracket, place 1) and a toilet-bowl game. Each team starts a QB, an RB and a D/ST and has one bench RB.
//
//   week 1: T1 100 v T2 90   T3 80 v T4 70
//   week 2: T1  95 v T3 85   T2 100 v T4 60
//   week 3: T1 110 v T2 105 (final)   T3 90 v T4 70 (toilet bowl)
//
// Final ranks: T1 1, T2 2, T3 3, T4 4. Starters score 50% (QB), 30% (RB) and 20% (D/ST) of the team's points; the
// QB was projected 5 points lower than he scored.
import type { BundleResponse } from "../espn/parse";

export const ESPN_FIXTURE_LEAGUE_ID = "424242";
export const ESPN_TEAM_NAMES = ["Alpha", "Beta", "Gamma", "Delta"] as const;
/** ESPN pro team ids of each team's D/ST: KC, DAL, DET, BUF. */
export const ESPN_DEF_PRO_TEAMS = [12, 6, 8, 2] as const;

const SCORES: Record<number, [number, number][]> = {
  1: [
    [100, 90],
    [80, 70],
  ],
  2: [
    [95, 85],
    [100, 60],
  ],
  3: [
    [110, 105],
    [90, 70],
  ],
};
// [home team, away team] per game, in the same order as SCORES
const PAIRS: Record<number, [number, number][]> = {
  1: [
    [1, 2],
    [3, 4],
  ],
  2: [
    [1, 3],
    [2, 4],
  ],
  3: [
    [1, 2],
    [3, 4],
  ],
};

const teamPoints = (team: number, week: number): number => {
  const games = PAIRS[week]!;
  for (const [i, [a, b]] of games.entries()) {
    const [pa, pb] = SCORES[week]![i]!;
    if (a === team) return pa;
    if (b === team) return pb;
  }
  throw new Error("no game");
};

export const qbId = (t: number) => 1000 + t;
export const rbId = (t: number) => 2000 + t;
export const benchId = (t: number) => 3000 + t;
export const defId = (t: number) => -(16000 + ESPN_DEF_PRO_TEAMS[t - 1]!);

const stat = (source: number, week: number, total: number) => ({
  statSourceId: source,
  statSplitTypeId: 1,
  scoringPeriodId: week,
  appliedTotal: total,
});

const entry = (
  playerId: number,
  slotId: number,
  position: number,
  week: number,
  actual: number,
  projected: number | null,
  name: string,
  proTeamId = 1
) => ({
  playerId,
  lineupSlotId: slotId,
  playerPoolEntry: {
    player: {
      fullName: name,
      defaultPositionId: position,
      proTeamId,
      stats: [stat(0, week, actual), ...(projected === null ? [] : [stat(1, week, projected)])],
    },
  },
});

function roster(team: number, week: number) {
  const pts = teamPoints(team, week);
  const qb = pts * 0.5;
  return {
    id: team,
    roster: {
      entries: [
        entry(qbId(team), 0, 1, week, qb, qb - 5, `Quarterback ${team}`),
        entry(rbId(team), 2, 2, week, pts * 0.3, pts * 0.3 - 1, `Runner ${team}`),
        entry(
          defId(team),
          16,
          16,
          week,
          pts * 0.2,
          null,
          `D/ST ${team}`,
          ESPN_DEF_PRO_TEAMS[team - 1]!
        ),
        entry(benchId(team), 20, 2, week, 7, null, `Backup ${team}`),
      ],
    },
  };
}

const tx = (over: Record<string, unknown>) => ({
  bidAmount: 0,
  executionType: "EXECUTE",
  isPending: false,
  proposedDate: 1_600_000_000_000,
  ...over,
});

export function espnFixtureResponses(): BundleResponse[] {
  const ok = (endpoint: string, payload: unknown, params: Record<string, unknown> = {}) => ({
    endpoint,
    params,
    status: 200,
    payload,
  });
  const schedule = [1, 2, 3].flatMap((week) =>
    PAIRS[week]!.map(([home, away], i) => ({
      id: week * 10 + i,
      matchupPeriodId: week,
      playoffTierType:
        week < 3 ? "NONE" : i === 0 ? "WINNERS_BRACKET" : "LOSERS_CONSOLATION_LADDER",
      home: { teamId: home, totalPoints: SCORES[week]![i]![0] },
      away: { teamId: away, totalPoints: SCORES[week]![i]![1] },
    }))
  );
  const teams = ESPN_TEAM_NAMES.map((name, i) => ({
    id: i + 1,
    name,
    abbrev: name.slice(0, 3).toUpperCase(),
    logo: `https://example.test/${name}.png`,
    owners: [`{OWNER-${i + 1}}`],
    divisionId: 0,
    playoffSeed: i + 1,
    rankCalculatedFinal: i + 1,
  }));
  const members = ESPN_TEAM_NAMES.map((name, i) => ({
    id: `{OWNER-${i + 1}}`,
    displayName: `Manager ${name}`,
  }));
  const settings = {
    id: Number(ESPN_FIXTURE_LEAGUE_ID),
    status: { finalScoringPeriod: 3 },
    settings: {
      size: 4,
      scheduleSettings: { matchupPeriodCount: 2, playoffTeamCount: 2 },
      scoringSettings: { scoringItems: [{ statId: 3 }] },
      rosterSettings: { lineupSlotCounts: { "0": 1, "2": 1, "16": 1, "20": 1, "21": 0 } },
      acquisitionSettings: { isUsingAcquisitionBudget: false },
      draftSettings: { type: "OFFLINE" },
    },
  };
  const picks = [
    ...[1, 2, 3, 4].map((t, i) => ({
      overallPickNumber: i + 1,
      roundId: 1,
      roundPickNumber: i + 1,
      teamId: t,
      playerId: qbId(t),
      keeper: false,
    })),
    ...[4, 3, 2, 1].map((t, i) => ({
      overallPickNumber: i + 5,
      roundId: 2,
      roundPickNumber: i + 1,
      teamId: t,
      playerId: rbId(t),
      keeper: false,
    })),
  ];
  const responses: BundleResponse[] = [
    ok("mSettings", settings),
    ok("mTeam", { teams, members }),
    ok("mMatchupScore", { schedule }),
    ok("mDraftDetail", { draftDetail: { picks } }),
  ];
  for (let week = 1; week <= 3; week++)
    for (let team = 1; team <= 4; team++)
      responses.push(
        ok(
          "rosterTeamWeek",
          { teams: [roster(team, week)] },
          { scoringPeriodId: week, forTeamId: team }
        )
      );
  const items = (...i: [string, number, number, number][]) =>
    i.map(([type, playerId, fromTeamId, toTeamId]) => ({ type, playerId, fromTeamId, toTeamId }));
  responses.push(
    ok(
      "mTransactions2",
      {
        transactions: [
          tx({
            id: "w-ok",
            type: "WAIVER",
            status: "EXECUTED",
            scoringPeriodId: 1,
            teamId: 2,
            proposedDate: 1_600_000_001_000,
            items: items(["ADD", 5001, 0, 2], ["DROP", benchId(2), 2, 0]),
          }),
          tx({
            id: "w-fail",
            type: "WAIVER",
            status: "FAILED_ROSTERLIMIT",
            scoringPeriodId: 1,
            teamId: 3,
            proposedDate: 1_600_000_002_000,
            items: items(["ADD", 5001, 0, 3]),
          }),
          tx({
            id: "fa",
            type: "FREEAGENT",
            status: "EXECUTED",
            scoringPeriodId: 2,
            teamId: 1,
            proposedDate: 1_600_000_003_000,
            items: items(["ADD", 5002, 0, 1], ["DROP", benchId(1), 1, 0]),
          }),
          tx({
            id: "cut",
            type: "ROSTER",
            status: "EXECUTED",
            scoringPeriodId: 2,
            teamId: 4,
            proposedDate: 1_600_000_004_000,
            items: items(["DROP", benchId(4), 4, 0]),
          }),
          tx({
            id: "trade",
            type: "TRADE_ACCEPT",
            status: "EXECUTED",
            scoringPeriodId: 2,
            teamId: 1,
            executionType: "PROCESS",
            proposedDate: 1_600_000_005_000,
            items: items(["TRADE", qbId(1), 1, 2], ["TRADE", rbId(2), 2, 1]),
          }),
          tx({
            id: "trade-vote",
            type: "TRADE_UPHOLD",
            status: "EXECUTED",
            scoringPeriodId: 2,
            teamId: 3,
            relatedTransactionId: "trade",
            items: [],
          }),
          tx({
            id: "trade-prop",
            type: "TRADE_PROPOSAL",
            status: "CANCELED",
            scoringPeriodId: 2,
            teamId: 1,
            items: items(["TRADE", qbId(1), 1, 3]),
          }),
          tx({
            id: "lineup",
            type: "FUTURE_ROSTER",
            status: "EXECUTED",
            scoringPeriodId: 2,
            teamId: 1,
            items: [{ type: "LINEUP", playerId: qbId(1), fromTeamId: 0, toTeamId: 0 }],
          }),
          tx({
            id: "draft",
            type: "DRAFT",
            status: "EXECUTED",
            scoringPeriodId: 1,
            teamId: 1,
            items: items(["DRAFT", qbId(1), 0, 0]),
          }),
        ],
      },
      { scoringPeriodId: 1 }
    )
  );
  return responses;
}
