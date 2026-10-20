import { afterAll, beforeAll, describe, expect, it } from "vitest";
import type { FastifyInstance } from "fastify";
import { buildApp } from "../src/app";
import { createWorld, type World } from "./helpers";

// The trade partners matrix, manager comparison, record-breaking feed, season recap, wrapped, Halls and search index,
// checked against the hand-built fixture league (see fixture-league.ts for every score). Franchises are looked up by
// the name of their team ("Team 1" ... "Team 6", one franchise each across both seasons).

// eslint-disable-next-line @typescript-eslint/no-explicit-any
type Json = any;

let w: World;
let app: FastifyInstance;
const franchise = new Map<string, number>();
const season = new Map<number, number>();

const get = async (url: string): Promise<{ status: number; body: Json }> => {
  const res = await app.inject({ method: "GET", url });
  return { status: res.statusCode, body: res.body ? JSON.parse(res.body) : null };
};

beforeAll(async () => {
  w = await createWorld();
  app = buildApp({ db: w.db });
  const idx = (await get("/api/leagues/fx/search-index")).body;
  for (const f of idx.franchises) franchise.set(f.team, f.id);
  const leagues = (await get("/api/leagues")).body.leagues;
  for (const s of leagues.find((l: Json) => l.slug === "fx").seasons) season.set(s.year, s.id);
});
afterAll(async () => {
  await app?.close();
  await w?.close();
});

const fid = (team: string) => franchise.get(team)!;

describe("search index", () => {
  it("lists every franchise with its team and manager names", async () => {
    const { franchises } = (await get("/api/leagues/fx/search-index")).body;
    expect(franchises).toHaveLength(6);
    const one = franchises.find((f: Json) => f.team === "Team 1");
    expect(one).toMatchObject({
      manager: "Manager 1",
      teamNames: ["Team 1"],
      managers: ["Manager 1"],
      firstSeason: 2030,
      lastSeason: 2031,
    });
  });
});

describe("trade partners", () => {
  it("counts trades and assets between franchises, zero-sum in value", async () => {
    const t = (await get("/api/leagues/fx/trade-partners")).body;
    const a = fid("Team 1");
    const b = fid("Team 2");
    // 2030 week 3: Team 1 receives a player and the 2031 round-2 pick, Team 2 receives a player.
    expect(t.matrix[a][b]).toMatchObject({ trades: 1, received: 2, sent: 1 });
    expect(t.matrix[b][a]).toMatchObject({ trades: 1, received: 1, sent: 2 });
    expect(t.matrix[a][b].net + t.matrix[b][a].net).toBeCloseTo(0, 5);
    // 2031 week 3: the three-team trade is a ring (3 sends to 4, 4 to 5, 5 to 3), so each pair moves one way.
    for (const [from, to] of [
      ["Team 3", "Team 4"],
      ["Team 4", "Team 5"],
      ["Team 5", "Team 3"],
    ] as const) {
      expect(t.matrix[fid(from)][fid(to)]).toMatchObject({ trades: 1, received: 0, sent: 1 });
      expect(t.matrix[fid(to)][fid(from)]).toMatchObject({ trades: 1, received: 1, sent: 0 });
    }
    // teams that never traded with each other have no cell
    expect(t.matrix[a]?.[fid("Team 6")]).toBeUndefined();
    expect(t.franchises.sort()).toEqual([1, 2, 3, 4, 5].map((n) => fid(`Team ${n}`)).sort());
  });

  it("follows the Seasons filter", async () => {
    const t = (await get("/api/leagues/fx/trade-partners?seasons=2031")).body;
    expect(t.matrix[fid("Team 1")]).toBeUndefined();
    expect(t.matrix[fid("Team 3")][fid("Team 4")].trades).toBe(1);
  });
});

describe("manager comparison", () => {
  it("lists their head-to-head games and the trades between them", async () => {
    const a = fid("Team 1");
    const b = fid("Team 2");
    const { status, body } = await get(`/api/leagues/fx/compare?a=${a}&b=${b}`);
    expect(status).toBe(200);
    // 2030 wk 1 tied 100-100; 2031 wk 1 won 110-90; 2031 wk 5 (third-place game) won 100-95.
    expect(
      body.meetings.map((m: Json) => [m.season, m.week, m.result, m.aPoints, m.bPoints, m.gameType])
    ).toEqual([
      [2030, 1, "T", 100, 100, "regular"],
      [2031, 1, "W", 110, 90, "regular"],
      [2031, 5, "W", 100, 95, "playoffs"],
    ]);
    expect(body.trades).toHaveLength(1);
    expect(body.trades[0]).toMatchObject({ season: 2030, week: 3 });
    expect(body.trades[0].aGets).toHaveLength(2);
    expect(body.trades[0].bGets).toHaveLength(1);
    expect(body.entities.franchises[a].teamName).toBe("Team 1");
  });

  it("is the same series from the other side, and rejects bad input", async () => {
    const a = fid("Team 1");
    const b = fid("Team 2");
    const { body } = await get(`/api/leagues/fx/compare?a=${b}&b=${a}`);
    expect(body.meetings.map((m: Json) => m.result)).toEqual(["T", "L", "L"]);
    expect((await get(`/api/leagues/fx/compare?a=${a}&b=${a}`)).status).toBe(400);
    expect((await get(`/api/leagues/fx/compare?a=${a}&b=99999`)).status).toBe(404);
    expect((await get(`/api/leagues/fx/compare?a=${a}`)).status).toBe(400);
  });
});

describe("record-breaking feed", () => {
  it("includes league-wide weeks at either end, with no team on the card", async () => {
    // Regular-season averages: 2031 wk2 (530 / 6 = 88.333) is the lowest week; 2030 wk3 and 2031 wk1 tie for the highest (100.833).
    const low = (
      await get(`/api/seasons/${season.get(2031)}/records-broken?week=2`)
    ).body.records.find((r: Json) => r.label === "Lowest-scoring league week");
    expect(low).toMatchObject({ rank: 1, value: 88.333, season: 2031, week: 2, team: null });
    const high = (
      await get(`/api/seasons/${season.get(2030)}/records-broken?week=3`)
    ).body.records.find((r: Json) => r.label === "Highest-scoring league week");
    expect(high).toMatchObject({ rank: 1, value: 100.833, tied: true, team: null });
  });

  it("lists the records a week set, judged against the whole history", async () => {
    // Team 3's 140 in 2030 week 3 is the highest score in the history (2031's best is 130).
    const { body } = await get(`/api/seasons/${season.get(2030)}/records-broken?week=3`);
    expect(body).toMatchObject({ season: 2030, week: 3 });
    const top = body.records.find((r: Json) => r.label === "Highest team score");
    expect(top).toMatchObject({ rank: 1, value: 140, team: "Team 3", season: 2030, week: 3 });
    expect(body.records.every((r: Json) => r.season === 2030 && r.week === 3)).toBe(true);
  });

  it("marks a tied record, and has nothing to say about a week that set none", async () => {
    // 60 is the lowest counted score three times over (2030 wk 2 Team 6, 2031 wk 2 Team 6, 2031 wk 3 Team 2).
    const low = (
      await get(`/api/seasons/${season.get(2030)}/records-broken?week=2`)
    ).body.records.find((r: Json) => r.label === "Lowest team score");
    expect(low).toMatchObject({ rank: 1, value: 60, tied: true, team: "Team 6" });
    const quiet = await get(`/api/seasons/${season.get(2031)}/records-broken?week=1`);
    expect(quiet.body.records.find((r: Json) => r.label === "Lowest-scoring league week")).toBe(
      undefined
    );
    expect(quiet.body.records.find((r: Json) => r.label === "Highest team score")).toBeUndefined();
  });
});

describe("season recap", () => {
  it("reports the title game, season awards and who moved most", async () => {
    const { body } = await get(`/api/seasons/${season.get(2030)}/recap`);
    expect(body.season).toBe(2030);
    // Week 5: Team 3 125, Team 1 105.
    expect(body.championship).toMatchObject({ winnerPoints: 125, loserPoints: 105, week: 5 });
    expect(body.championship.winner.team).toBe("Team 3");
    expect(body.championship.loser.team).toBe("Team 1");
    // Points for over weeks 1-5: Team 3 120+90+140+130+125 = 605, ahead of Team 1's 565.
    const pf = body.awards.find((a: Json) => a.label === "Most points scored");
    expect(pf).toMatchObject({ team: "Team 3", value: 605 });
    expect(body.mostImproved).toBeNull();
    expect(body.totals.games).toBeGreaterThan(0);

    const next = (await get(`/api/seasons/${season.get(2031)}/recap`)).body;
    // Team 4 went from 4th (2030) to 2nd (2031).
    expect(next.mostImproved).toMatchObject({ from: 4, to: 2 });
    expect(next.mostImproved.team.team).toBe("Team 4");
  });
});

describe("manager wrapped", () => {
  it("summarizes one franchise's season", async () => {
    const f = fid("Team 1");
    const { status, body } = await get(`/api/leagues/fx/franchises/${f}/wrapped?season=2030`);
    expect(status).toBe(200);
    expect(body.team.team).toBe("Team 1");
    // Runner-up of 6; scored 100+130+110+120+105 = 565 and allowed 100+90+100+110+125 = 525.
    expect(body.summary).toMatchObject({
      finalPlace: 2,
      teams: 6,
      pf: 565,
      pa: 525,
      previous: null,
    });
    expect(body.weeks.best).toMatchObject({ week: 2, points: 130, opponentPoints: 90 });
    expect(body.weeks.worst).toMatchObject({ week: 1, points: 100, opponentPoints: 100 });
    expect(body.weeks.biggestWin).toMatchObject({ week: 2 });
    expect(body.weeks.topScorerWeeks).toBe(1);
    expect(body.ranks.find((r: Json) => r.key === "pf")).toMatchObject({ rank: 2, of: 6 });
    expect(body.moves.trades).toBe(1);
    const next = (await get(`/api/leagues/fx/franchises/${f}/wrapped?season=2031`)).body;
    expect(next.summary.previous).toEqual({ season: 2030, place: 2, teams: 6 });
    expect(body.seasons).toEqual([2030, 2031]);
  });

  it("404s for a season the franchise did not play and 400s for bad input", async () => {
    const f = fid("Team 1");
    expect((await get(`/api/leagues/fx/franchises/${f}/wrapped?season=2010`)).status).toBe(404);
    expect((await get(`/api/leagues/fx/franchises/${f}/wrapped`)).status).toBe(400);
  });
});

describe("halls of fame and shame", () => {
  it("builds both halls from the records and the final standings", async () => {
    const { body } = await get("/api/leagues/fx/hall");
    expect(body.fame.length).toBeGreaterThan(3);
    expect(body.shame.length).toBeGreaterThan(3);
    // Team 3 won the title in both seasons.
    expect(body.fame[0]).toMatchObject({ title: "Most championships", unit: "titles" });
    expect(body.fame[0].holders[0]).toMatchObject({ rank: 1, value: 2, team: "Team 3" });
    expect(body.shame.find((e: Json) => e.title === "Lowest team score").holders[0].value).toBe(60);
  });
});
