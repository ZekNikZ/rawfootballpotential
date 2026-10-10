import { afterAll, beforeAll, describe, expect, it } from "vitest";
import type { FastifyInstance } from "fastify";
import { sql } from "@rfp/db";
import { buildApp } from "../src/app";
import { parseFeed } from "../src/info/blog";
import { createWorld, type World } from "./helpers";

// Responses are parsed JSON; tests assert on their shape, so they are deliberately untyped.
// eslint-disable-next-line @typescript-eslint/no-explicit-any
type Json = any;

let w: World;
let app: FastifyInstance;
beforeAll(async () => {
  w = await createWorld();
  app = buildApp({ db: w.db });
});
afterAll(async () => {
  await app?.close();
  await w?.close();
});

const get = async <T = Json>(url: string) => {
  const res = await app.inject({ method: "GET", url });
  return {
    status: res.statusCode,
    headers: res.headers,
    body: (res.body ? JSON.parse(res.body) : null) as T,
  };
};

describe("records over HTTP", () => {
  it("serves the catalog with data availability", async () => {
    const { status, body } = await get("/api/leagues/fx/records");
    expect(status).toBe(200);
    expect(body.records.length).toBeGreaterThan(50);
    const faab = body.records.find((r: Json) => r.id === "waiver.faab-high");
    expect(faab).toMatchObject({ availableFrom: 2030, requires: expect.arrayContaining(["faab"]) });
    expect(body.records.find((r: Json) => r.id === "draft.price-high").availableFrom).toBeNull();
    // the UI builds its filter controls from this list
    expect(body.records.find((r: Json) => r.id === "score.high").filters).toEqual(
      expect.arrayContaining(["seasons", "scope", "weeks", "onePer"])
    );
  });

  it("serves a record with ranks, typed values, entity refs and cache headers", async () => {
    const { status, headers, body } = await get(
      "/api/leagues/fx/records/score.high?limit=2&scope=regular"
    );
    expect(status).toBe(200);
    expect(headers["cache-control"]).toContain("max-age");
    expect(headers.etag).toBeTruthy();
    expect(body.params).toMatchObject({ scope: "regular", limit: 2 });
    expect(body.rows[0]).toMatchObject({ rank: 1, values: { value: 140, season: 2030, week: 3 } });
    const row = body.rows[0];
    expect(body.entities.teamSeasons[row.refs.teamSeasonId].name).toBe("Team 3");
    expect(body.entities.managers[row.refs.managerId].name).toBe("Manager 3");
    expect(body.availableFrom).toBe(2030);
    expect(body.seasonsIncluded).toEqual([2030, 2031]);
  });

  it("answers a conditional request with 304", async () => {
    const first = await get("/api/leagues/fx/records/blowout?limit=3");
    const res = await app.inject({
      method: "GET",
      url: "/api/leagues/fx/records/blowout?limit=3",
      headers: { "if-none-match": String(first.headers.etag) },
    });
    expect(res.statusCode).toBe(304);
    expect(res.body).toBe("");
  });

  it("rejects bad filters with 400 and unknown records or leagues with 404", async () => {
    expect((await get("/api/leagues/fx/records/score.high?scope=toilet-bowl")).status).toBe(400);
    expect((await get("/api/leagues/fx/records/score.high?limit=9999")).status).toBe(400);
    expect((await get("/api/leagues/fx/records/nope")).status).toBe(404);
    expect((await get("/api/leagues/nope/records/score.high")).status).toBe(404);
  });

  it("filters not supported by a record are reset, so they cannot change the answer or fragment the cache", async () => {
    const a = await get("/api/leagues/fx/records/career.place.best?median=only&scope=playoffs");
    const b = await get("/api/leagues/fx/records/career.place.best");
    expect(a.body.params).toEqual(b.body.params);
    expect(a.body.dataVersion).toBe(b.body.dataVersion);
  });
});

describe("head-to-head, trophies and franchise profile", () => {
  it("h2h matrix with the median pseudo-opponent", async () => {
    const { body } = await get("/api/leagues/fx/h2h");
    const id = (name: string) =>
      Number(
        Object.entries(body.entities.franchises).find(([, f]: Json) => f.teamName === name)![0]
      );
    const [t1, t2, t4] = [id("Team 1"), id("Team 2"), id("Team 4")];
    expect(body.matrix[t1][t4]).toEqual({ w: 2, l: 2, t: 0, games: 4 });
    expect(body.matrix[t1][t2]).toEqual({ w: 2, l: 0, t: 1, games: 3 });
    expect(body.matrix[t1].median).toEqual({ w: 5, l: 0, t: 1, games: 6 });
    expect(
      (await get("/api/leagues/fx/h2h?median=exclude")).body.matrix[t1].median
    ).toBeUndefined();
    expect((await get("/api/leagues/fx/h2h?scope=playoffs")).body.matrix[t1][t4]).toEqual({
      w: 1,
      l: 1,
      t: 0,
      games: 2,
    });
  });

  it("trophy case (doc §4.1) with correct season totals (doc §1.4 bug 3)", async () => {
    const { body } = await get("/api/leagues/fx/trophies");
    const t = body.trophies as Json[];
    const name = (e: Json) => body.entities.teamSeasons[e.teamSeasonId].name;
    const of = (type: string, season?: number) =>
      t.filter((e) => e.type === type && (season === undefined || e.season === season));

    expect(
      of("placement", 2030)
        .map((e) => [e.value, name(e)])
        .sort()
    ).toEqual([
      [1, "Team 3"],
      [2, "Team 1"],
      [3, "Team 2"],
      [6, "Team 5"],
    ]);
    expect(
      of("placement", 2031)
        .map((e) => [e.value, name(e)])
        .sort()
    ).toEqual([
      [1, "Team 3"],
      [2, "Team 4"],
      [3, "Team 1"],
      [6, "Team 5"],
    ]);
    // thresholds seeded as 125 / 65: scores strictly above / below
    expect(of("high-scorer-club").length).toBe(5);
    expect(of("benchwarmer-club").length).toBe(3);
    // season superlatives; ties all get the trophy
    expect(of("season-high-score", 2030).map((e) => [e.value, e.week])).toEqual([[140, 3]]);
    expect(of("season-high-score", 2031).map((e) => e.value)).toEqual([130, 130]);
    expect(of("season-narrowest-win", 2031).length).toBe(2);
    expect(of("season-largest-blowout", 2031).map((e) => e.value)).toEqual([65]);
    // PF is the true total of counted points (the legacy code summed only the winners' scores)
    expect(of("season-points-for", 2030).map((e) => [name(e), e.value])).toEqual([["Team 3", 605]]);
    // PA: the lowest total of opponents' points, not the loser's own score
    expect(of("season-points-against", 2030).map((e) => [name(e), e.value])).toEqual([
      ["Team 6", 235],
    ]);
    expect(of("season-points-against", 2031).map((e) => [name(e), e.value])).toEqual([
      ["Team 6", 255],
    ]);
    expect((await get("/api/leagues/fx/trophies?season=2031")).body.seasonsIncluded).toEqual([
      2031,
    ]);
  });

  it("placement history: one final place per franchise and completed season", async () => {
    const { status, body } = await get("/api/leagues/fx/placements");
    expect(status).toBe(200);
    const pts = body.points as Json[];
    const name = (p: Json) => body.entities.franchises[p.franchiseId].teamName;
    expect(body.seasonsIncluded).toEqual([2030, 2031]);
    expect(
      pts
        .filter((p) => p.season === 2030 && p.place <= 3)
        .map((p) => [p.place, name(p), p.teamCount])
    ).toEqual([
      [1, "Team 3", 6],
      [2, "Team 1", 6],
      [3, "Team 2", 6],
    ]);
    expect(pts.filter((p) => p.season === 2031)).toHaveLength(6);
    expect(new Set(body.franchises).size).toBe(body.franchises.length);
  });

  it("draft picks carry the bye week of the player's NFL team that season", async () => {
    const url = `/api/seasons/${w.fixture.seasonIds[2031]}/draft`;
    const picks = (await get(url)).body.drafts[0].picks as Json[];
    expect(picks.every((p) => p.byeWeek === null)).toBe(true); // no schedule data yet
    const first = picks[0];
    try {
      await w.db.execute(sql`update player set nfl_team = 'ZZZ' where id = ${first.playerId}`);
      await w.db.execute(
        sql`insert into nfl_team_week (season, week, nfl_team, is_bye) values (2031, 7, 'ZZZ', true), (2031, 8, 'ZZZ', false)`
      );
      const after = (await get(url)).body.drafts[0].picks as Json[];
      expect(after.find((p) => p.pickNo === first.pickNo)).toMatchObject({
        nflTeam: "ZZZ",
        byeWeek: 7,
      });
      expect(after.filter((p) => p.byeWeek !== null)).toHaveLength(
        picks.filter((p) => p.playerId === first.playerId).length
      );
    } finally {
      await w.db.execute(sql`delete from nfl_team_week where nfl_team = 'ZZZ'`);
      await w.db.execute(sql`update player set nfl_team = null where id = ${first.playerId}`);
    }
  });

  it("franchise profile: seasons, rank in every manager record, trophies", async () => {
    const list = await get("/api/leagues/fx/franchises");
    const t1 = Number(
      Object.entries(list.body.entities.franchises).find(
        ([, f]: Json) => f.teamName === "Team 1"
      )![0]
    );
    const { status, body } = await get(`/api/leagues/fx/franchises/${t1}`);
    expect(status).toBe(200);
    expect(
      body.seasons.map((s: Json) => [
        s.season,
        s.finalPlace,
        s.record.wins,
        s.record.losses,
        s.record.ties,
        s.pf,
      ])
    ).toEqual([
      [2030, 2, 5, 1, 2, 565],
      [2031, 3, 6, 2, 0, 545],
    ]);
    expect(body.entities.managers[body.seasons[0].managerId].name).toBe("Manager 1");
    const wins = body.records.find((r: Json) => r.id === "career.wins");
    expect(wins).toMatchObject({ rank: 1, of: 6 });
    expect(body.trophies.some((e: Json) => e.type === "placement" && e.value === 2)).toBe(true);
    expect((await get("/api/leagues/fx/franchises/99999")).status).toBe(404);

    const roster = await get(`/api/leagues/fx/franchises/${t1}/roster?season=2030`);
    expect(roster.status).toBe(200);
    expect(roster.body.season).toBe(2030);
    expect(["live", "final-week", "none"]).toContain(roster.body.source);
    for (const p of roster.body.players) expect(p.points).toEqual(expect.any(Number));
    expect((await get(`/api/leagues/fx/franchises/${t1}/roster?season=2010`)).status).toBe(404);
    expect((await get(`/api/leagues/fx/franchises/${t1}/roster`)).status).toBe(400);
  });
});

describe("season info pages (may include live data)", () => {
  const sid = () => w.fixture.seasonIds[2030]!;

  it("weekly superlatives: ties share them, and they agree with the matchups page", async () => {
    const { status, body } = await get(`/api/seasons/${sid()}/superlatives?week=3`);
    expect(status).toBe(200);
    expect(body.week).toBe(3);
    const games = (await get(`/api/seasons/${sid()}/matchups?week=3`)).body.games;
    const scores: number[] = games.flatMap((g: Json) => g.teams.map((t: Json) => t.points));
    const item = (key: string) => body.items.find((i: Json) => i.key === key);
    expect(item("high").holders[0].value).toBe(Math.max(...scores));
    expect(item("low").holders[0].value).toBe(Math.min(...scores));
    const margins = games.map((g: Json) => Math.abs(g.teams[0].points - g.teams[1].points));
    expect(item("blowout").holders[0].value).toBeCloseTo(Math.max(...margins), 2);
    expect(item("closest").holders[0].value).toBeCloseTo(
      Math.min(...margins.filter((m: number) => m > 0)),
      2
    );
    expect((await get(`/api/seasons/${sid()}/superlatives?week=99`)).status).toBe(400);
  });

  it("top performers: best player scores of the week, highest first", async () => {
    const { status, body } = await get(`/api/seasons/${sid()}/top-performers?week=3&limit=5`);
    expect(status).toBe(200);
    expect(body.week).toBe(3);
    expect(body.players.length).toBeGreaterThan(0);
    expect(body.players.length).toBeLessThanOrEqual(5);
    const pts: number[] = body.players.map((p: Json) => p.points);
    expect(pts).toEqual([...pts].sort((a, b) => b - a));
    expect(pts.every((p) => p > 0)).toBe(true);
    expect(body.entities.teamSeasons[body.players[0].teamSeasonId]).toBeDefined();
    // With no week given it is the latest finished week, the same one the superlatives use.
    const dflt = (await get(`/api/seasons/${sid()}/top-performers`)).body;
    const sup = (await get(`/api/seasons/${sid()}/superlatives`)).body;
    expect(dflt.week).toBe(sup.week);
    expect(sup.items[0].holders[0]).toHaveProperty("avatar");
  });

  it("standings after Json week", async () => {
    const { body } = await get(`/api/seasons/${sid()}/standings?week=3`);
    expect(body.weeks).toEqual([1, 2, 3, 4, 5]);
    expect(
      body.rows.map((r: Json) => [
        r.rank,
        body.entities.teamSeasons[r.team_season_id].name,
        r.wins,
        r.losses,
        r.ties,
      ])
    ).toEqual([
      [1, "Team 1", 4, 0, 2],
      [2, "Team 3", 4, 2, 0],
      [3, "Team 4", 3, 3, 0],
      [4, "Team 6", 3, 3, 0],
      [5, "Team 2", 1, 3, 2],
      [6, "Team 5", 1, 5, 0],
    ]);
    expect((await get(`/api/seasons/${sid()}/standings`)).body.week).toBe(5);
    expect((await get(`/api/seasons/99999/standings`)).status).toBe(404);
  });

  it("matchups: games with scores, the bracket round, idle teams and lineups", async () => {
    const wk4 = (await get(`/api/seasons/${sid()}/matchups?week=4`)).body;
    expect(wk4.games.map((g: Json) => [g.gameType, g.bracket, g.counts])).toEqual([
      ["playoffs", "winners", true],
      ["playoffs", "winners", true],
      ["none", null, false],
    ]);
    const wk5 = (await get(`/api/seasons/${sid()}/matchups?week=5&players=1`)).body;
    expect(wk5.games.find((g: Json) => g.isChampionship)).toMatchObject({ placementAtStake: 1 });
    expect(wk5.idle.map((t: Json) => t.points).sort()).toEqual([60, 70]);
    const team = wk5.games[0].teams[0];
    expect(team.lineup.filter((p: Json) => p.slotKind === "starter").length).toBe(3);
    expect(team.lineup.length).toBe(4);
  });

  it("teams, transactions (failed claims are shown but marked), draft and picks", async () => {
    const t = (await get(`/api/seasons/${sid()}/teams`)).body;
    expect(t.teams.length).toBe(6);
    const tx = (await get(`/api/seasons/${sid()}/transactions`)).body;
    expect(tx.total).toBe(3);
    expect(tx.transactions.map((x: Json) => x.status)).toEqual(["complete", "failed", "complete"]); // newest first; the two week-2 claims share a timestamp, so newest id first;
    expect((await get(`/api/seasons/${sid()}/transactions?type=trade`)).body.total).toBe(1);
    // estimated trade value: one entry per team in the trade, nets cancel out; other types have none
    const trade = (await get(`/api/seasons/${sid()}/transactions?type=trade`)).body.transactions[0];
    expect(trade.tradeValue.map((v: Json) => v.teamSeasonId).sort()).toEqual(
      trade.items
        .filter((i: Json) => i.kind === "player")
        .map((i: Json) => i.toTeamSeasonId)
        .sort()
    );
    const netSum = trade.tradeValue.reduce((a: number, v: Json) => a + v.net, 0);
    expect(Math.abs(netSum)).toBeLessThan(0.11);
    expect(
      tx.transactions
        .filter((x: Json) => x.type !== "trade")
        .every((x: Json) => x.tradeValue === null)
    ).toBe(true);
    const failed = tx.transactions.find((x: Json) => x.status === "failed");
    expect(failed.failureReason).toBe("Player was claimed by another team.");
    expect(
      (await get(`/api/seasons/${w.fixture.seasonIds[2031]}/draft`)).body.drafts[0].picks.length
    ).toBe(18);
    expect((await get(`/api/seasons/${sid()}/draft`)).body.drafts).toEqual([]);
    expect((await get("/api/leagues/fx/picks")).body.picks).toEqual([]);
  });
});

describe("site, health and blog", () => {
  it("health reports the database", async () => {
    const { status, body } = await get("/healthz");
    expect(status).toBe(200);
    expect(body).toMatchObject({ ok: true, db: true });
  });

  it("lists leagues with seasons and data flags", async () => {
    const { body } = await get("/api/leagues");
    expect(body.leagues[0]).toMatchObject({ slug: "fx", type: "redraft" });
    expect(body.leagues[0].seasons.map((s: Json) => s.year)).toEqual([2030, 2031]);
    expect(body.leagues[0].seasons[1].data).toMatchObject({
      playerData: true,
      draft: true,
      faab: true,
      auctionDraft: false,
    });
  });

  it("parses the Wix RSS feed", () => {
    const xml = `<?xml version="1.0"?><rss version="2.0" xmlns:dc="http://purl.org/dc/elements/1.1/"><channel><title>x</title>
      <item><title><![CDATA[Week 7, Shifting Tides]]></title><description><![CDATA[The greatest write up.]]></description>
      <link>https://example.com/post/week-7</link><pubDate>Sun, 19 Oct 2025 14:08:26 GMT</pubDate>
      <enclosure url="https://img.example.com/a.png" length="0" type="image/png"/><dc:creator>Talented Jimmy</dc:creator></item></channel></rss>`;
    expect(parseFeed(xml)).toEqual([
      {
        title: "Week 7, Shifting Tides",
        link: "https://example.com/post/week-7",
        date: "2025-10-19T14:08:26.000Z",
        author: "Talented Jimmy",
        previewText: "The greatest write up.",
        imgSrc: "https://img.example.com/a.png",
      },
    ]);
  });

  it("proxies the blog feed, caches it, and serves the stale copy when the source is down", async () => {
    const original = globalThis.fetch;
    let calls = 0;
    const xml = `<rss version="2.0"><channel><item><title>Hello</title><link>https://x/y</link><pubDate>Mon, 01 Jan 2024 00:00:00 GMT</pubDate></item></channel></rss>`;
    globalThis.fetch = (async () => {
      calls++;
      return new Response(xml, { status: 200 });
    }) as typeof fetch;
    try {
      const a = await get("/api/blog");
      expect(a.body.posts[0]).toMatchObject({ title: "Hello", link: "https://x/y" });
      await get("/api/blog");
      expect(calls).toBe(1); // second request served from raw_payload
    } finally {
      globalThis.fetch = original;
    }
  });
});
