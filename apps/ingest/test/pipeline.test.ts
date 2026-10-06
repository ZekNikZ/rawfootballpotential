import { league, leagueSeason, override, sql, eq, type Db } from "@rfp/db";
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import { deriveSeason } from "../src/derive/derive";
import { RateLimiter, RawStore, hours } from "../src/lib/raw-store";
import { SleeperClient } from "../src/sleeper/client";
import { teamWeekOverrideKey } from "../src/sleeper/games";
import { syncPlayers } from "../src/sleeper/players";
import { bootstrapSleeperSeason, syncSleeperSeason } from "../src/sleeper/sync";
import { LEAGUE_ID, route } from "./fixture-league";
import { createTempDb } from "./temp-db";

let db: Db;
let close: () => Promise<void>;
let client: SleeperClient;
let seasonId: number;
const fetchCalls: string[] = [];

const q = async <T extends Record<string, unknown>>(query: ReturnType<typeof sql>) =>
  (await db.execute<T>(query)).rows;

beforeAll(async () => {
  ({ db, close } = await createTempDb());
  vi.stubGlobal("fetch", async (input: string | URL | Request) => {
    const url = String(input instanceof Request ? input.url : input);
    fetchCalls.push(url);
    const body = route(url);
    return body === undefined
      ? new Response("not found", { status: 404 })
      : new Response(JSON.stringify(body), {
          status: 200,
          headers: { "content-type": "application/json" },
        });
  });
  client = new SleeperClient(new RawStore(db), new RateLimiter(100_000));
  const [lg] = await db
    .insert(league)
    .values({ slug: "fx", name: "Fixture", type: "redraft" })
    .returning();
  await syncPlayers(db, client, hours(1));
  seasonId = await bootstrapSleeperSeason(db, client, { leagueId: lg!.id, externalId: LEAGUE_ID });
  await syncSleeperSeason(db, client, seasonId, { mode: "full" });
  await deriveSeason(db, seasonId);
});

afterAll(async () => {
  vi.unstubAllGlobals();
  await close?.();
});

const results = (team: number) =>
  q<{ week: number; kind: string; result: string; game_type: string }>(sql`
    select gr.week, gr.kind::text, gr.result::text, gr.game_type::text
    from game_result gr join team_season ts on ts.id = gr.team_season_id
    where gr.league_season_id = ${seasonId} and ts.external_roster_id = ${String(team)}
    order by gr.week, gr.seq`);

describe("season normalization from Sleeper payloads", () => {
  it("derives season settings from the league payload", async () => {
    const [s] = await q<{
      regular: number;
      start: number;
      last: number;
      median: boolean;
      losers: boolean;
      faab: string;
      slots: string[];
    }>(sql`
      select regular_season_weeks regular, playoff_week_start start, last_week last, median_enabled median,
             has_losers_bracket losers, waiver_type::text faab, roster_slots slots from league_season where id = ${seasonId}`);
    expect(s).toMatchObject({
      regular: 3,
      start: 4,
      last: 5,
      median: true,
      losers: false,
      faab: "faab",
      slots: ["QB", "RB", "FLEX"],
    });
  });

  it("classifies games from the brackets; the unbracketed playoff-week game is 'none' (doc §2)", async () => {
    const rows = await q<{ game_type: string; n: string }>(
      sql`select game_type::text, count(*) n from matchup where league_season_id = ${seasonId} group by 1`
    );
    expect(Object.fromEntries(rows.map((r) => [r.game_type, Number(r.n)]))).toEqual({
      regular: 9,
      playoffs: 4,
      none: 1,
    });
    const [champ] = await q<{ champ: boolean; placement: number }>(
      sql`select is_championship champ, placement_at_stake placement from matchup where league_season_id = ${seasonId} and is_championship`
    );
    expect(champ).toMatchObject({ champ: true, placement: 1 });
  });

  it("teams with no game keep their score but never count (doc §1.4 bug 7)", async () => {
    const idle = await q<{
      team: string;
      points: number;
      counts: boolean;
      matchup_id: number | null;
    }>(sql`
      select ts.external_roster_id team, tw.points::float, tw.counts, tw.matchup_id from team_week tw
      join team_season ts on ts.id = tw.team_season_id where tw.league_season_id = ${seasonId} and tw.week = 5 and ts.external_roster_id in ('5','6') order by 1`);
    expect(idle).toEqual([
      { team: "5", points: 70, counts: false, matchup_id: null },
      { team: "6", points: 60, counts: false, matchup_id: null },
    ]);
    // week-4 'none' game: both sides recorded, neither counts
    const none = await q<{ n: string }>(
      sql`select count(*) n from team_week where league_season_id = ${seasonId} and week = 4 and not counts`
    );
    expect(Number(none[0]?.n)).toBe(2);
    const counted = await q<{ n: string }>(
      sql`select count(*) n from rec_team_week where league_season_id = ${seasonId}`
    );
    expect(Number(counted[0]?.n)).toBe(26); // 18 regular + 4 + 4 playoff
  });
});

describe("derived results (worked out by hand)", () => {
  it("head-to-head tie and median tie are stored as T (doc §2)", async () => {
    const t1 = await results(1);
    expect(t1.filter((r) => r.week === 1).map((r) => `${r.kind}:${r.result}`)).toEqual([
      "h2h:T",
      "median:T",
    ]);
    const t2 = await results(2);
    expect(t2.filter((r) => r.week === 1).map((r) => `${r.kind}:${r.result}`)).toEqual([
      "h2h:T",
      "median:T",
    ]);
  });

  it("median is the true median of that week's scores (even team count averages the middle two)", async () => {
    const [m] = await q<{ week_median: number }>(sql`
      select st.week_median::float from team_week_stats st join team_week tw on tw.id = st.team_week_id
      join team_season ts on ts.id = tw.team_season_id where tw.league_season_id = ${seasonId} and tw.week = 2 and ts.external_roster_id = '1'`);
    expect(m?.week_median).toBe(92.5);
    const t3 = await results(3);
    expect(t3.filter((r) => r.week === 2).map((r) => `${r.kind}:${r.result}`)).toEqual([
      "h2h:L",
      "median:L",
    ]);
  });

  it("median games exist only in regular-season weeks", async () => {
    const [n] = await q<{ n: string }>(
      sql`select count(*) n from game_result where league_season_id = ${seasonId} and kind = 'median' and game_type <> 'regular'`
    );
    expect(Number(n?.n)).toBe(0);
    const [total] = await q<{ n: string }>(
      sql`select count(*) n from game_result where league_season_id = ${seasonId}`
    );
    expect(Number(total?.n)).toBe(44); // 13 games x 2 sides + 18 median rows
  });

  it("standings after the regular season (record incl. median, ties half; PF breaks ties)", async () => {
    const rows = await q<{ team: string; rank: number; w: number; l: number; t: number }>(sql`
      select ts.external_roster_id team, tsw.rank, tsw.wins w, tsw.losses l, tsw.ties t
      from team_season_week tsw join team_season ts on ts.id = tsw.team_season_id
      where ts.league_season_id = ${seasonId} and tsw.week = 3 order by tsw.rank`);
    expect(rows.map((r) => `${r.team}:${r.w}-${r.l}-${r.t}`)).toEqual([
      "1:4-0-2",
      "3:4-2-0",
      "4:3-3-0",
      "6:3-3-0",
      "2:1-3-2",
      "5:1-5-0",
    ]);
  });

  it("final placements come from the bracket and regular-season order", async () => {
    const rows = await q<{ team: string; final_place: number; made: boolean }>(
      sql`select external_roster_id team, final_place, made_playoffs made from team_season where league_season_id = ${seasonId} order by final_place`
    );
    expect(rows.map((r) => `${r.final_place}:${r.team}`)).toEqual([
      "1:3",
      "2:1",
      "3:2",
      "4:4",
      "5:6",
      "6:5",
    ]);
    expect(rows.filter((r) => r.made).length).toBe(4);
    const trophies = await q<{ kind: string; team: string }>(
      sql`select t.kind::text, ts.external_roster_id team from trophy t join team_season ts on ts.id = t.team_season_id where ts.league_season_id = ${seasonId} and t.kind in ('winners_circle','podium','losers_circle') order by 1, 2`
    );
    expect(trophies).toEqual([
      { kind: "losers_circle", team: "5" },
      { kind: "podium", team: "1" },
      { kind: "podium", team: "2" },
      { kind: "winners_circle", team: "3" },
    ]);
  });

  it("optimal lineup uses the bench RB in the FLEX slot on odd weeks; lineup IQ = starters / optimal", async () => {
    const rows = await q<{ week: number; optimal: number; iq: number; perfect: boolean }>(sql`
      select tw.week, st.optimal_points::float optimal, st.lineup_iq::float iq, st.is_perfect perfect
      from team_week_stats st join team_week tw on tw.id = st.team_week_id join team_season ts on ts.id = tw.team_season_id
      where tw.league_season_id = ${seasonId} and ts.external_roster_id = '1' order by tw.week`);
    const wk1 = rows.find((r) => r.week === 1)!;
    expect(wk1.optimal).toBeGreaterThan(100); // 100 actual + 7 bench-over-FLEX gain
    expect(wk1.perfect).toBe(false);
    expect(wk1.iq).toBeCloseTo(100 / wk1.optimal, 2);
    expect(rows.find((r) => r.week === 2)).toMatchObject({ perfect: true, iq: 1 });
  });
});

describe("transactions", () => {
  it("stores failed claims but flags them, with FAAB bids on the add items", async () => {
    const rows = await q<{ id: string; status: string; type: string; reason: string | null }>(
      sql`select external_id id, status::text, type::text, failure_reason reason from transaction where league_season_id = ${seasonId} order by external_id`
    );
    expect(rows).toEqual([
      {
        id: "t-fail",
        status: "failed",
        type: "waiver",
        reason: "Player was claimed by another team.",
      },
      { id: "t-trade", status: "complete", type: "trade", reason: null },
      { id: "t-win", status: "complete", type: "waiver", reason: null },
    ]);
    const bids = await q<{ id: string; bid: number }>(
      sql`select t.external_id id, i.faab_bid bid from transaction_item i join transaction t on t.id = i.transaction_id where i.direction = 'add' and i.faab_bid is not null order by 1`
    );
    expect(bids).toEqual([
      { id: "t-fail", bid: 15 },
      { id: "t-win", bid: 12 },
    ]);
  });

  it("trades become one move item per player plus pick and FAAB items", async () => {
    const kinds = await q<{ kind: string; direction: string; n: string }>(
      sql`select i.kind::text, i.direction::text, count(*) n from transaction_item i join transaction t on t.id = i.transaction_id where t.external_id = 't-trade' group by 1, 2 order by 1`
    );
    expect(kinds.map((k) => `${k.kind}:${k.direction}:${k.n}`)).toEqual([
      "faab:move:1",
      "pick:move:1",
      "player:move:2",
    ]);
  });

  it("rec_transaction hides failed claims (only successful ones count, doc §2)", async () => {
    const rows = await q<{ n: string }>(
      sql`select count(*) n from rec_transaction where league_season_id = ${seasonId}`
    );
    expect(Number(rows[0]?.n)).toBe(2);
  });
});

describe("re-running ingest", () => {
  it("uses the raw cache: a completed season is not fetched again", async () => {
    const before = fetchCalls.length;
    expect(before).toBeGreaterThan(10);
    await syncSleeperSeason(db, client, seasonId, { mode: "full" });
    expect(fetchCalls.length).toBe(before);
  });

  it("is idempotent: re-sync + re-derive yields identical rows", async () => {
    const digest = async () =>
      (
        await q<{ d: string }>(sql`
        select md5(string_agg(x, '|' order by x)) d from (
          select concat_ws(',', team_season_id, week, seq, kind, result, points_for, points_against) x from game_result where league_season_id = ${seasonId}
          union all select concat_ws(',', team_week_id, optimal_points, week_rank) from team_week_stats
          union all select concat_ws(',', team_season_id, week, wins, rank) from team_season_week) q`)
      )[0]?.d;
    const before = await digest();
    await syncSleeperSeason(db, client, seasonId, { mode: "full" });
    expect(await digest()).toBe(before); // matchup ids are stable, so derived rows survive a re-sync
    await deriveSeason(db, seasonId);
    await deriveSeason(db, seasonId);
    expect(await digest()).toBe(before);
  });

  it("a score override survives re-ingest (applied during normalize)", async () => {
    await db.insert(override).values({
      entity: "team_week",
      entityId: teamWeekOverrideKey(seasonId, 6, 1),
      field: "points",
      value: 150,
      reason: "test: commissioner correction",
    });
    await syncSleeperSeason(db, client, seasonId, { mode: "full" });
    await deriveSeason(db, seasonId);
    const [row] = await q<{ points: number; overridden: boolean }>(sql`
      select tw.points::float, tw.points_overridden overridden from team_week tw join team_season ts on ts.id = tw.team_season_id
      where tw.league_season_id = ${seasonId} and tw.week = 1 and ts.external_roster_id = '6'`);
    expect(row).toEqual({ points: 150, overridden: true });
    // and it flows into the derived result: 150 beats team 5's 90
    expect((await results(6)).find((r) => r.week === 1 && r.kind === "h2h")?.result).toBe("W");
  });
});

describe("as-played scoring (Sleeper re-serves old weeks with today's scoring)", () => {
  it("re-scores the weeks a rule covers, so a tie becomes a loss; later weeks are untouched", async () => {
    // Week 1 was played with interceptions at -1 (the fixture league has no pass_int scoring today): team 1 threw 2.
    await db
      .update(leagueSeason)
      .set({ scoringOverrides: [{ stat: "pass_int", points: -1, toWeek: 1 }] })
      .where(eq(leagueSeason.id, seasonId));
    await syncSleeperSeason(db, client, seasonId, { mode: "full" });
    await deriveSeason(db, seasonId);
    const t1 = await results(1);
    expect(t1.find((r) => r.week === 1 && r.kind === "h2h")?.result).toBe("L"); // 98 vs 100, was a 100-100 tie
    const [pts] = await q<{ w1: number; w2: number }>(sql`
      select (max(tw.points) filter (where tw.week = 1))::float w1, (max(tw.points) filter (where tw.week = 2))::float w2
      from team_week tw join team_season ts on ts.id = tw.team_season_id where tw.league_season_id = ${seasonId} and ts.external_roster_id = '1'`);
    expect(pts).toEqual({ w1: 98, w2: 130 });
    const [qb] = await q<{ points: number }>(sql`
      select pw.points::float from player_week pw join team_week tw on tw.id = pw.team_week_id join team_season ts on ts.id = tw.team_season_id
      join player p on p.id = pw.player_id where tw.week = 1 and ts.external_roster_id = '1' and p.sleeper_id = 'q1'`);
    expect(qb?.points).toBe(48); // was 50 (half of 100), minus 2 interceptions x 1
  });
});
