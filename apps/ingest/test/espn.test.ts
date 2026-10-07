import {
  draft,
  draftPick,
  franchise,
  league,
  leagueSeason,
  manager,
  managerIdentity,
  matchup,
  player,
  teamSeason,
  teamSeasonManager,
  teamWeek,
  transaction,
  transactionItem,
  unmatchedPlayer,
  eq,
  sql,
  type Db,
} from "@rfp/db";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { classifyEspnGame, runEspnImport } from "../src/espn/normalize";
import { parseEspnBundle } from "../src/espn/parse";
import {
  ESPN_FIXTURE_LEAGUE_ID,
  ESPN_TEAM_NAMES,
  benchId,
  defId,
  espnFixtureResponses,
  qbId,
  rbId,
} from "../src/testing/fixture-espn";
import { createTempDb } from "../src/testing/temp-db";

let db: Db;
let close: () => Promise<void>;
let seasonId: number;
const teamIds: number[] = [];
const q = async <T extends Record<string, unknown>>(query: ReturnType<typeof sql>) =>
  (await db.execute<T>(query)).rows;

beforeAll(async () => {
  ({ db, close } = await createTempDb());
  const [lg] = await db
    .insert(league)
    .values({ slug: "redraft", name: "Redraft", type: "redraft", color: "blue" })
    .returning();
  // What the Mongo migration leaves behind for an ESPN season: placeholder id, legacy roster ids, no games yet.
  const [season] = await db
    .insert(leagueSeason)
    .values({
      leagueId: lg!.id,
      year: 2019,
      source: "espn",
      externalId: "mongo:L-Test-2019",
      status: "complete",
      regularSeasonWeeks: 2,
      playoffWeekStart: 3,
      lastWeek: 3,
      playoffTeams: 2,
      teamCount: 4,
    })
    .returning();
  seasonId = season!.id;
  for (const [i, name] of ESPN_TEAM_NAMES.entries()) {
    const [m] = await db
      .insert(manager)
      .values({ name: `Manager ${name}` })
      .returning();
    const [f] = await db.insert(franchise).values({ leagueId: lg!.id }).returning();
    const [t] = await db
      .insert(teamSeason)
      .values({
        leagueSeasonId: seasonId,
        franchiseId: f!.id,
        externalRosterId: `R-${name}`,
        name: i === 3 ? "  DELTA " : name, // matching ignores case and spacing
      })
      .returning();
    await db.insert(teamSeasonManager).values({ teamSeasonId: t!.id, managerId: m!.id });
    teamIds.push(t!.id);
  }
  // Players the dump knows: everything for teams 1-3, the four D/STs, and two free agents. Team 4's players are not
  // in it, so they come out as unmatched.
  await db.insert(player).values([
    ...[1, 2, 3].flatMap((t) => [
      { espnId: String(qbId(t)), fullName: `Quarterback ${t}`, position: "QB" },
      { espnId: String(rbId(t)), fullName: `Runner ${t}`, position: "RB" },
      { espnId: String(benchId(t)), fullName: `Backup ${t}`, position: "RB" },
    ]),
    { espnId: "5001", fullName: "Claimed RB", position: "RB" },
    { espnId: "5002", fullName: "Free RB", position: "RB" },
    ...["KC", "DAL", "DET", "BUF"].map((abbr) => ({
      sleeperId: abbr,
      fullName: `${abbr} defense`,
      position: "DEF",
    })),
  ]);
});
afterAll(async () => {
  await close?.();
});

describe("parseEspnBundle", () => {
  const data = parseEspnBundle(2019, ESPN_FIXTURE_LEAGUE_ID, espnFixtureResponses());

  it("reads the league shape, teams, owners and slots", () => {
    expect(data.settings).toMatchObject({
      teamCount: 4,
      regularSeasonWeeks: 2,
      playoffWeekStart: 3,
      lastWeek: 3,
      rosterSlots: ["QB", "RB", "DEF"],
      benchSlots: 1,
      irSlots: 0,
      hasFaab: false,
    });
    expect(data.teams.map((t) => [t.id, t.name, t.owners[0], t.rankFinal])).toEqual([
      [1, "Alpha", "{OWNER-1}", 1],
      [2, "Beta", "{OWNER-2}", 2],
      [3, "Gamma", "{OWNER-3}", 3],
      [4, "Delta", "{OWNER-4}", 4],
    ]);
    expect(data.members.get("{OWNER-2}")).toBe("Manager Beta");
  });

  it("keeps real transactions and drops votes, proposals, lineup moves and the draft", () => {
    expect(data.transactions.map((t) => [t.id, t.kind, t.complete, t.week])).toEqual([
      ["w-ok", "waiver", true, 1],
      ["w-fail", "waiver", false, 1],
      ["fa", "free_agent", true, 2],
      ["cut", "free_agent", true, 2],
      ["trade", "trade", true, 2],
    ]);
    expect(data.transactions.find((t) => t.id === "w-fail")?.reason).toBe("FAILED_ROSTERLIMIT");
    expect(data.anomalies).toEqual([]);
  });

  it("tells a snake draft from a linear one", () => {
    expect(data.draft).toMatchObject({ type: "snake", rounds: 2 });
    expect(data.draft?.picks).toHaveLength(8);
  });

  it("a one-sided playoff matchup is a bye, scored from pointsByScoringPeriod", () => {
    const rs = espnFixtureResponses();
    const sched = rs.find((r) => r.endpoint === "mMatchupScore")!;
    (sched.payload as { schedule: unknown[] }).schedule.push({
      matchupPeriodId: 3,
      playoffTierType: "WINNERS_BRACKET",
      home: { teamId: 9, pointsByScoringPeriod: { "3": 88.5 } },
    });
    const withBye = parseEspnBundle(2019, "1", rs);
    expect(withBye.games.filter((g) => g.sides.length === 1)).toHaveLength(1);
    expect(withBye.weekScores.get("9:3")).toBe(88.5);
  });
});

describe("classifyEspnGame", () => {
  const data = parseEspnBundle(2019, "1", espnFixtureResponses());
  const game = (tier: string, week: number, a: number, b: number) =>
    classifyEspnGame(
      {
        week,
        tier: tier as never,
        sides: [
          { teamId: a, points: 1 },
          { teamId: b, points: 2 },
        ],
      },
      data
    );
  it("types games from ESPN's tiers and reads the place at stake from the final ranks", () => {
    expect(game("NONE", 2, 1, 3)).toMatchObject({ gameType: "regular", bracket: null });
    expect(game("NONE", 3, 1, 3)).toMatchObject({ gameType: "none" });
    expect(game("WINNERS_BRACKET", 3, 1, 2)).toMatchObject({
      gameType: "playoffs",
      bracket: "winners",
      bracketRound: 1,
      placementAtStake: 1,
      isChampionship: true,
    });
    // the toilet bowl is played for last place: ranks 3 and 4 of 4 -> p = 4 + 1 - 4 = 1
    expect(game("LOSERS_CONSOLATION_LADDER", 3, 3, 4)).toMatchObject({
      gameType: "toilet_bowl",
      bracket: "losers",
      placementAtStake: 1,
      isChampionship: false,
    });
    // before the last week no place is decided yet
    expect(game("WINNERS_BRACKET", 2, 1, 2).placementAtStake).toBeNull();
  });
});

describe("import into the database", () => {
  let summary: Awaited<ReturnType<typeof runEspnImport>>;
  beforeAll(async () => {
    summary = await runEspnImport(db, seasonId, espnFixtureResponses(), "test-bundle");
  });

  it("updates the season in place from ESPN's settings and adopts the real league id", async () => {
    const [s] = await db.select().from(leagueSeason).where(eq(leagueSeason.id, seasonId));
    expect(s).toMatchObject({
      externalId: ESPN_FIXTURE_LEAGUE_ID,
      rosterSlots: ["QB", "RB", "DEF"],
      benchSlots: 1,
      hasPlayerData: true,
      hasProjections: true,
      hasTransactions: true,
      hasDraft: true,
      hasFaab: false,
      hasAuctionDraft: false,
      hasLosersBracket: true,
    });
    // the team rows kept their ids and legacy roster ids
    expect(
      (await db.select().from(teamSeason).where(eq(teamSeason.leagueSeasonId, seasonId)))
        .map((t) => t.id)
        .sort()
    ).toEqual([...teamIds].sort());
    expect(summary.teams).toBe(4);
  });

  it("builds matchups with brackets, and a team-week per team and week", async () => {
    expect(summary.games).toEqual({ regular: 4, playoffs: 1, toilet_bowl: 1 });
    const final = (
      await db.select().from(matchup).where(eq(matchup.leagueSeasonId, seasonId))
    ).find((m) => m.isChampionship);
    expect(final).toMatchObject({
      week: 3,
      gameType: "playoffs",
      bracket: "winners",
      placementAtStake: 1,
    });
    const weeks = await db.select().from(teamWeek).where(eq(teamWeek.leagueSeasonId, seasonId));
    expect(weeks).toHaveLength(12);
    expect(weeks.every((w) => w.counts && w.isFinal)).toBe(true);
    expect(weeks.find((w) => w.teamSeasonId === teamIds[0] && w.week === 3)?.points).toBe(110);
    expect(summary.scoreMismatches).toEqual([]); // the schedule and the starters agree
  });

  it("derives final places from the brackets, matching ESPN's own ranks", async () => {
    const places = await db
      .select()
      .from(teamSeason)
      .where(eq(teamSeason.leagueSeasonId, seasonId));
    expect(teamIds.map((id) => places.find((t) => t.id === id)?.finalPlace)).toEqual([1, 2, 3, 4]);
    expect(summary.placementMismatches).toEqual([]);
    expect(summary.derive?.lineupAnomalies).toBe(0);
  });

  it("matches players by ESPN id (and D/STs by NFL team), and queues the ones it cannot", async () => {
    expect(summary.players.created).toBe(3);
    expect(summary.unmatchedPlayers.map((p) => p.espnId).sort()).toEqual(
      [String(qbId(4)), String(rbId(4)), String(benchId(4))].sort()
    );
    const queue = await db.select().from(unmatchedPlayer);
    expect(queue.map((u) => u.status)).toEqual(["open", "open", "open"]);
    const defs = await q<{ name: string }>(sql`
      select p.full_name name from player_week pw join player p on p.id = pw.player_id
      where pw.slot = 'DEF' group by 1 order by 1`);
    expect(defs.map((d) => d.name)).toEqual([
      "BUF defense",
      "DAL defense",
      "DET defense",
      "KC defense",
    ]);
    expect(defId(1)).toBe(-16012);
  });

  it("stores lineups with slots, actual and projected points", async () => {
    expect(summary.playerWeeks).toBe(48);
    const rows = await q<{
      slot: string;
      kind: string;
      points: string;
      projected: string | null;
    }>(sql`
      select pw.slot, pw.slot_kind kind, pw.points, pw.projected_points projected
      from player_week pw join team_week tw on tw.id = pw.team_week_id
      join player p on p.id = pw.player_id
      where tw.team_season_id = ${teamIds[0]!} and tw.week = 3 order by pw.slot`);
    expect(rows).toEqual([
      { slot: "BN", kind: "bench", points: "7.000", projected: null },
      { slot: "DEF", kind: "starter", points: "22.000", projected: null },
      { slot: "QB", kind: "starter", points: "55.000", projected: "50.000" },
      { slot: "RB", kind: "starter", points: "33.000", projected: "32.000" },
    ]);
  });

  it("stores transactions: claims, a failed claim, a drop, a trade", async () => {
    expect(summary.transactions).toEqual({
      total: 5,
      failed: 1,
      byKind: { waiver: 2, free_agent: 2, trade: 1 },
    });
    const txs = await db.select().from(transaction).where(eq(transaction.leagueSeasonId, seasonId));
    const byExt = new Map(txs.map((t) => [t.externalId, t]));
    expect(byExt.get("w-fail")).toMatchObject({
      status: "failed",
      failureReason: "FAILED_ROSTERLIMIT",
      week: 1,
    });
    expect(byExt.get("w-ok")).toMatchObject({
      status: "complete",
      type: "waiver",
      creatorTeamSeasonId: teamIds[1],
    });
    const tradeItems = await db
      .select()
      .from(transactionItem)
      .where(eq(transactionItem.transactionId, byExt.get("trade")!.id));
    expect(tradeItems.map((i) => [i.direction, i.fromTeamSeasonId, i.toTeamSeasonId])).toEqual([
      ["move", teamIds[0], teamIds[1]],
      ["move", teamIds[1], teamIds[0]],
    ]);
    const cut = await db
      .select()
      .from(transactionItem)
      .where(eq(transactionItem.transactionId, byExt.get("cut")!.id));
    expect(cut.map((i) => i.direction)).toEqual(["drop"]);
  });

  it("stores the draft: snake order, board slots and picks", async () => {
    expect(summary.draftPicks).toBe(8);
    const [d] = await db.select().from(draft).where(eq(draft.leagueSeasonId, seasonId));
    expect(d).toMatchObject({ type: "snake", rounds: 2, kind: "redraft", status: "complete" });
    expect(d?.slotOrder).toEqual({
      "1": teamIds[0],
      "2": teamIds[1],
      "3": teamIds[2],
      "4": teamIds[3],
    });
    const picks = await db.select().from(draftPick).where(eq(draftPick.draftId, d!.id));
    const last = picks.find((p) => p.pickNo === 5)!; // round 2, first pick, made by team 4 (the last slot)
    expect(last).toMatchObject({
      round: 2,
      slot: 4,
      teamSeasonId: teamIds[3],
      originalTeamSeasonId: teamIds[3],
    });
  });

  it("links ESPN owner ids to the managers", async () => {
    const ids = await db.select().from(managerIdentity);
    expect(ids.map((i) => i.externalUserId).sort()).toEqual([
      "{OWNER-1}",
      "{OWNER-2}",
      "{OWNER-3}",
      "{OWNER-4}",
    ]);
    expect(ids.every((i) => i.source === "espn")).toBe(true);
  });

  it("is idempotent: importing again changes nothing", async () => {
    const before = {
      weeks: (await q<{ n: string }>(sql`select count(*) n from team_week`))[0]!.n,
      pw: (await q<{ n: string }>(sql`select count(*) n from player_week`))[0]!.n,
      tx: (await q<{ n: string }>(sql`select count(*) n from transaction`))[0]!.n,
      players: (await q<{ n: string }>(sql`select count(*) n from player`))[0]!.n,
    };
    const again = await runEspnImport(db, seasonId, espnFixtureResponses(), "test-bundle");
    expect(again.unmatchedPlayers).toEqual([]); // created last time, matched by ESPN id now
    expect({
      weeks: (await q<{ n: string }>(sql`select count(*) n from team_week`))[0]!.n,
      pw: (await q<{ n: string }>(sql`select count(*) n from player_week`))[0]!.n,
      tx: (await q<{ n: string }>(sql`select count(*) n from transaction`))[0]!.n,
      players: (await q<{ n: string }>(sql`select count(*) n from player`))[0]!.n,
    }).toEqual(before);
  });

  it("refuses to guess when a team cannot be matched", async () => {
    const rs = espnFixtureResponses();
    const teams = rs.find((r) => r.endpoint === "mTeam")!.payload as {
      teams: { name: string; rankCalculatedFinal: number }[];
    };
    teams.teams[0]!.name = "Renamed";
    teams.teams[0]!.rankCalculatedFinal = 99;
    await expect(runEspnImport(db, seasonId, rs, null)).rejects.toThrow(
      /Could not match ESPN teams/
    );
  });
});

describe("a two-week playoff matchup (ESPN 2020)", () => {
  let id: number;
  let summary: Awaited<ReturnType<typeof runEspnImport>>;
  beforeAll(async () => {
    const [lg] = await db.select().from(league);
    const [s] = await db
      .insert(leagueSeason)
      .values({
        leagueId: lg!.id,
        year: 2018,
        source: "espn",
        externalId: "mongo:L-Test-2018",
        status: "complete",
        regularSeasonWeeks: 2,
        playoffWeekStart: 3,
        lastWeek: 3,
        playoffTeams: 2,
        teamCount: 4,
      })
      .returning();
    id = s!.id;
    for (const name of ESPN_TEAM_NAMES) {
      const [f] = await db.insert(franchise).values({ leagueId: lg!.id }).returning();
      await db
        .insert(teamSeason)
        .values({ leagueSeasonId: id, franchiseId: f!.id, externalRosterId: `R2-${name}`, name });
    }
    // Matchup period 3 is scoring periods 3 and 4: the week-3 games carry the combined score.
    const rs = espnFixtureResponses();
    const settings = rs.find((r) => r.endpoint === "mSettings")!.payload as {
      id: number;
      status: { finalScoringPeriod: number };
      settings: { scheduleSettings: Record<string, unknown> };
    };
    settings.id = 424243; // each ESPN season here is its own league
    settings.status.finalScoringPeriod = 4;
    settings.settings.scheduleSettings.matchupPeriods = { "1": [1], "2": [2], "3": [3, 4] };
    for (const t of [1, 2, 3, 4])
      rs.push({
        endpoint: "rosterTeamWeek",
        params: { scoringPeriodId: 4, forTeamId: t },
        status: 200,
        payload: rs.find((r) => r.params.scoringPeriodId === 3 && r.params.forTeamId === t)!
          .payload,
      });
    summary = await runEspnImport(db, id, rs, null);
  });

  it("marks the games as spanning two weeks and keeps their combined score", async () => {
    const games = await db.select().from(matchup).where(eq(matchup.leagueSeasonId, id));
    expect(games.filter((g) => g.week === 3).map((g) => g.spanWeeks)).toEqual([2, 2]);
    expect(games.filter((g) => g.week < 3).every((g) => g.spanWeeks === 1)).toBe(true);
    const rows = await q<{ span: number; points: string }>(sql`
      select span_weeks span, points from rec_team_week_all where league_season_id = ${id} and week = 3 order by points desc`);
    expect(rows.map((r) => r.span)).toEqual([2, 2, 2, 2]);
    expect(Number(rows[0]!.points)).toBe(110);
  });

  it("stores no lineups for those weeks, and the results still count", async () => {
    const lineups = await q<{ week: number; n: string }>(sql`
      select tw.week, count(*) n from player_week pw join team_week tw on tw.id = pw.team_week_id
      where tw.league_season_id = ${id} group by 1 order by 1`);
    expect(lineups.map((l) => l.week)).toEqual([1, 2]);
    expect(summary.scoreMismatches).toEqual([]);
    const places = await db.select().from(teamSeason).where(eq(teamSeason.leagueSeasonId, id));
    expect(places.map((t) => t.finalPlace).sort()).toEqual([1, 2, 3, 4]);
  });
});
