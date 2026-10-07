import { describe, expect, it } from "vitest";
import { buildBundle } from "../src/bundle";
import { lastScoringPeriod, leagueUrl, weekRequests, type EspnResponse } from "../src/espn";
import { formatReport, gapReport } from "../src/gap-report";

const res = (
  endpoint: string,
  payload: unknown,
  params: Record<string, unknown> = {},
  status = 200
) => ({ endpoint, params, status, payload }) satisfies EspnResponse;

const entry = (playerId: number, slot: number, pts: number, projected = true) => ({
  playerId,
  lineupSlotId: slot,
  playerPoolEntry: {
    appliedStatTotal: pts,
    player: { fullName: `Player ${playerId}`, stats: projected ? [{ statSourceId: 1 }] : [] },
  },
});

const side = (teamId: number, entries: unknown[]) => ({
  teamId,
  totalPoints: 100,
  rosterForCurrentScoringPeriod: { entries },
});

function season(opts: { transactions?: unknown[]; projected?: boolean; tiers?: boolean } = {}) {
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
    res(
      "mBoxscore",
      {
        schedule: [
          {
            matchupPeriodId: w,
            home: side(1, [
              entry(10, 0, 20, opts.projected !== false),
              entry(11, 20, 3, opts.projected !== false),
            ]),
            away: side(2, [entry(12, 0, 15, opts.projected !== false)]),
          },
        ],
      },
      { scoringPeriodId: w }
    ),
    res(
      "mRosterWeek",
      { teams: [{ roster: { entries: [{}] } }, { roster: { entries: [{}] } }] },
      { scoringPeriodId: w }
    ),
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
    expect(by("Lineups")[0]?.detail).toContain("3 player entries");
    expect(by("Lineups")[0]?.detail).toContain("1 bench");
    expect(by("Projections")[0]?.level).toBe("warn"); // week 1 has them, the season has 2 periods but 1 box score
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

  it("counts transactions by type, failures and bids", () => {
    const rep = gapReport(
      2021,
      season({
        transactions: [
          { type: "WAIVER", status: "EXECUTED", bidAmount: 5 },
          { type: "WAIVER", status: "FAILED_INVALIDPLAYERS", bidAmount: 9 },
          { type: "FREE_AGENT", status: "EXECUTED", bidAmount: 0 },
        ],
      })
    );
    const tx = rep.checks.find((c) => c.area === "Transactions")!;
    expect(tx.level).toBe("ok");
    expect(tx.detail).toContain("WAIVER 2");
    expect(tx.detail).toContain("1 failed");
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
      ["mRosterWeek", 4],
      ["mTransactions2", 4],
    ]);
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
