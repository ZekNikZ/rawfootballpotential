import { afterAll, beforeAll, describe, expect, it } from "vitest";
import type { FastifyInstance } from "fastify";
import { sql } from "@rfp/db";
import { buildApp } from "../src/app";
import { seasonPlayoffOdds } from "../src/info/playoff-odds";
import { createWorld, type World } from "./helpers";

// eslint-disable-next-line @typescript-eslint/no-explicit-any
type Json = any;

let w: World;
let app: FastifyInstance;
let finished: number;
let rewound: number;
let regularWeeks: number;
let playoffTeams: number;
const AFTER = 2;

beforeAll(async () => {
  w = await createWorld();
  app = buildApp({ db: w.db });
  finished = w.fixture.seasonIds[2030]!;
  rewound = w.fixture.seasonIds[2031]!;
  // Put 2031 back in the middle of its regular season: games after week AFTER are not played yet.
  const [s] = (
    await w.db.execute<{ regular_season_weeks: number; playoff_teams: number }>(
      sql`select regular_season_weeks, playoff_teams from league_season where id = ${rewound}`
    )
  ).rows;
  regularWeeks = Number(s!.regular_season_weeks);
  playoffTeams = Number(s!.playoff_teams);
  await w.db.execute(
    sql`update league_season set status = 'in_season', last_completed_week = ${AFTER} where id = ${rewound}`
  );
  await w.db.execute(sql`delete from team_season_week where week > ${AFTER}
    and team_season_id in (select id from team_season where league_season_id = ${rewound})`);
  await w.db.execute(
    sql`update league_season_week set status = 'upcoming' where league_season_id = ${rewound} and week > ${AFTER}`
  );
  await w.db.execute(
    sql`update team_week set is_final = false, result = null where league_season_id = ${rewound} and week > ${AFTER}`
  );
});
afterAll(async () => {
  await app?.close();
  await w?.close();
});

describe("playoff odds on the standings", () => {
  it("has a schedule to play for in the rewound season", () => {
    expect(regularWeeks).toBeGreaterThan(AFTER);
    expect(playoffTeams).toBeGreaterThan(0);
  });

  it("is absent for a finished season", async () => {
    expect(await seasonPlayoffOdds(w.db, finished, { cache: false })).toBeNull();
    const res = await app.inject({ method: "GET", url: `/api/seasons/${finished}/standings` });
    expect(JSON.parse(res.body).playoffOdds).toBeNull();
  });

  it("gives every team a probability, and the probabilities add up to the playoff spots", async () => {
    const odds = await seasonPlayoffOdds(w.db, rewound, { cache: false });
    expect(odds).not.toBeNull();
    const entries = Object.values(odds!);
    expect(entries.length).toBeGreaterThanOrEqual(4);
    for (const o of entries) {
      expect(o.probability).toBeGreaterThanOrEqual(0);
      expect(o.probability).toBeLessThanOrEqual(1);
      expect(o.clinched && o.eliminated).toBe(false);
      if (o.clinched) expect(o.probability).toBe(1);
      if (o.eliminated) expect(o.probability).toBe(0);
    }
    // Everyone's chance is an expectation of the same cut line.
    expect(entries.reduce((s, o) => s + o.probability, 0)).toBeCloseTo(playoffTeams, 0);
  });

  it("is on the standings response for the latest week only", async () => {
    const latest = JSON.parse(
      (await app.inject({ method: "GET", url: `/api/seasons/${rewound}/standings` })).body
    ) as Json;
    expect(latest.week).toBe(AFTER);
    expect(Object.keys(latest.playoffOdds)).toHaveLength(latest.rows.length);
    const earlier = JSON.parse(
      (await app.inject({ method: "GET", url: `/api/seasons/${rewound}/standings?week=1` })).body
    ) as Json;
    expect(earlier.playoffOdds).toBeNull();
  });

  it("says nothing when the remaining schedule is not stored", async () => {
    await w.db.execute(
      sql`delete from matchup where league_season_id = ${rewound} and week = ${regularWeeks}`
    );
    expect(await seasonPlayoffOdds(w.db, rewound, { cache: false })).toBeNull();
  });
});
