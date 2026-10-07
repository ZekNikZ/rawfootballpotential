import { describe, expect, it } from "vitest";
import { buildBundle } from "../src/bundle";
import {
  lastScoringPeriod,
  leagueUrl,
  playerCardRequest,
  playerIdsIn,
  teamWeekRequest,
  weekRequests,
  type EspnResponse,
} from "../src/espn";
import { formatReport, gapReport } from "../src/gap-report";

const res = (
  endpoint: string,
  payload: unknown,
  params: Record<string, unknown> = {},
  status = 200
) => ({ endpoint, params, status, payload }) satisfies EspnResponse;

const stat = (source: number, week: number) => ({
  statSourceId: source,
  statSplitTypeId: 1,
  scoringPeriodId: week,
  appliedTotal: 10,
});

const entry = (playerId: number, slot: number, week: number, projected = true) => ({
  playerId,
  lineupSlotId: slot,
  playerPoolEntry: {
    player: {
      fullName: `Player ${playerId}`,
      stats: [stat(0, week), ...(projected ? [stat(1, week)] : [])],
    },
  },
});

const teamRoster = (id: number, entries: unknown[]) => ({ id, roster: { entries } });

function season(
  opts: {
    transactions?: unknown[];
    cardTransactions?: unknown[];
    projected?: boolean;
    tiers?: boolean;
  } = {}
) {
  const w = 1;
  return [
    res("mSettings", {
      status: { finalScoringPeriod: 2 },
      settings: {
        size: 2,
        scheduleSettings: { matchupPeriodCount: 1, playoffTeamCount: 2 },
        scoringSettings: { scoringItems: [{}, {}] },
        rosterSettings: { lineupSlotCounts: { "0": 1, "20": 2 } },
        acquisitionSettings: { isUsingAcquisitionBudget: true, acquisitionBudget: 100 },
      },
    }),
    res("mTeam", {
      members: [{ id: "{A}" }, { id: "{B}" }],
      teams: [
        { id: 1, name: "One", owners: ["{A}"], rankCalculatedFinal: 1, playoffSeed: 1 },
        { id: 2, name: "Two", owners: [], rankCalculatedFinal: 2, playoffSeed: 2 },
      ],
    }),
    res("mMatchupScore", {
      schedule: [
        {
          matchupPeriodId: 1,
          playoffTierType: opts.tiers ? "WINNERS_BRACKET" : "NONE",
          home: { totalPoints: 10 },
          away: { totalPoints: 9 },
        },
      ],
    }),
    res("mDraftDetail", {
      draftDetail: { picks: [{ bidAmount: 12, keeper: false }, { bidAmount: 0 }] },
    }),
    res("mBoxscore", { schedule: [] }, { scoringPeriodId: 1 }),
    res(
      "rosterTeamWeek",
      {
        teams: [
          teamRoster(1, [
            entry(10, 0, 1, opts.projected !== false),
            entry(11, 20, 1, opts.projected !== false),
          ]),
        ],
      },
      { scoringPeriodId: 1, forTeamId: 1 }
    ),
    res(
      "rosterTeamWeek",
      { teams: [teamRoster(2, [entry(12, 0, 1, opts.projected !== false)])] },
      { scoringPeriodId: 1, forTeamId: 2 }
    ),
    res("playerCards", {
      players: [
        { id: 10, player: { fullName: "Player 10" }, transactions: opts.cardTransactions ?? [] },
      ],
    }),
    res("mTransactions2", { transactions: opts.transactions ?? [] }, { scoringPeriodId: w }),
  ];
}

describe("gapReport", () => {
  it("reports what is there and what is missing, with what each gap is needed for", () => {
    const rep = gapReport(2021, season({ transactions: [] }));
    const by = (area: string) => rep.checks.filter((c) => c.area === area);
    expect(by("League settings")[0]?.level).toBe("ok");
    expect(by("Owners")[0]).toMatchObject({ level: "gap" }); // team 2 has no owner id
    expect(by("Playoff bracket")[0]?.level).toBe("gap");
    expect(by("Transactions")[0]).toMatchObject({ level: "gap" });
    expect(by("Draft")[0]?.detail).toContain("2 picks, 1 with a price");
    expect(by("Lineups")[0]?.detail).toContain(
      "2/4 team-weeks have a roster (3 player entries, 1 bench"
    );
    expect(by("Lineups")[0]?.level).toBe("warn"); // 2 teams x 2 scoring periods expected, only week 1 fetched
    expect(by("Projections")[0]?.level).toBe("warn");
    expect(rep.numbers).toMatchObject({ teams: 2, lineupEntries: 3, draftPicks: 2, faab: "yes" });
    expect(formatReport(rep)).toMatch(/GAP .*Owners/);
  });

  it("flags missing projections, failed requests and a missing bracket", () => {
    const rs = season({ projected: false, tiers: true });
    rs.push(res("mBoxscore", null, { scoringPeriodId: 2 }, 401));
    const rep = gapReport(2021, rs);
    expect(rep.checks.find((c) => c.area === "Projections")?.level).toBe("gap");
    expect(rep.checks.find((c) => c.area === "Requests")?.detail).toContain(
      "mBoxscore wk2 (HTTP 401)"
    );
    expect(rep.checks.find((c) => c.area === "Playoff bracket")?.level).toBe("ok");
  });

  it("counts transactions from the feed and from player cards, once each", () => {
    const waiver = {
      id: "a",
      type: "WAIVER",
      status: "EXECUTED",
      bidAmount: 5,
      scoringPeriodId: 3,
    };
    const rep = gapReport(
      2021,
      season({
        transactions: [
          { id: "b", type: "FREEAGENT", status: "EXECUTED", bidAmount: 0, scoringPeriodId: 4 },
        ],
        // the same transaction rides on every player it touches; the draft is one transaction with DRAFT items
        cardTransactions: [
          waiver,
          waiver,
          {
            id: "c",
            type: "WAIVER",
            status: "FAILED_INVALIDPLAYERS",
            bidAmount: 9,
            scoringPeriodId: 3,
          },
          { id: "d", type: "DRAFT", status: "EXECUTED", items: [{ type: "DRAFT" }] },
        ],
      })
    );
    const tx = rep.checks.find((c) => c.area === "Transactions")!;
    expect(tx.level).toBe("ok");
    expect(tx.detail).toContain("3 (");
    expect(tx.detail).toContain("WAIVER 2");
    expect(tx.detail).toContain("in 2 weeks");
    expect(tx.detail).toContain("1 not executed");
    expect(tx.detail).toContain("2 with a bid");
  });
});

describe("requests and bundles", () => {
  it("builds the league URLs and per-week requests", () => {
    expect(leagueUrl(2021, "50111898", ["mTeam", "mStandings"], { scoringPeriodId: "3" })).toBe(
      "https://lm-api-reads.fantasy.espn.com/apis/v3/games/ffl/seasons/2021/segments/0/leagues/50111898?view=mTeam&view=mStandings&scoringPeriodId=3"
    );
    expect(weekRequests(2021, "1", 4).map((r) => [r.endpoint, r.params.scoringPeriodId])).toEqual([
      ["mBoxscore", 4],
      ["mTransactions2", 4],
    ]);
  });

  it("asks for a team's week the way ESPN's team page does", () => {
    const r = teamWeekRequest(2021, "50111898", 7, 5);
    expect(r.url).toContain("view=mRoster&forTeamId=7&scoringPeriodId=5");
    expect(JSON.parse(r.headers!["x-fantasy-filter"]!)).toEqual({
      players: { filterRanksForScoringPeriodIds: { value: [5] } },
    });
  });

  it("batches player cards and finds every player id a bundle mentions, transactions included", () => {
    const card = playerCardRequest(2021, "1", [1, 2, 3], 18);
    expect(JSON.parse(card.headers!["x-fantasy-filter"]!).players.filterIds.value).toEqual([
      1, 2, 3,
    ]);
    const ids = playerIdsIn([
      res("rosterTeamWeek", {
        teams: [{ roster: { entries: [{ playerId: 10 }, { playerId: 11 }] } }],
      }),
      res("mDraftDetail", { draftDetail: { picks: [{ playerId: 12 }] } }),
      res("playerCards", {
        players: [{ transactions: [{ items: [{ playerId: 13 }, { playerId: 0 }] }] }],
      }),
    ]);
    expect([...ids].sort()).toEqual([10, 11, 12, 13]);
  });

  it("reads the number of scoring periods, falling back to 17", () => {
    expect(lastScoringPeriod({ status: { finalScoringPeriod: 17 } })).toBe(17);
    expect(lastScoringPeriod({ status: { finalScoringPeriod: 99 } })).toBe(17);
    expect(lastScoringPeriod(null)).toBe(17);
  });

  it("a bundle passes the same schema the server checks on import", () => {
    const b = buildBundle({ league: "redraft", year: 2021, espnLeagueId: "50111898" }, season());
    expect(b.manifest).toMatchObject({ format: 1, year: 2021 });
    expect(() => buildBundle({ league: "redraft", year: 2021, espnLeagueId: "1" }, [])).toThrow();
  });
});
