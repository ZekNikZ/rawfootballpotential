// A hand-built 6-team Sleeper league ("9001", season 2030) with answers worked out by hand in pipeline.test.ts.
// Weeks 1-3 regular season (median on), week 4-5 playoffs (4 teams, no losers bracket), team 5 and 6 miss the
// playoffs: they play an unbracketed game in week 4 and sit idle (matchup_id null) in week 5.

export const LEAGUE_ID = "9001";

const cents = (n: number) => Math.round(n * 100) / 100;

/** [roster, score] per matchup id, by week. */
const WEEKS: Record<number, Record<number, [[number, number], [number, number]]>> = {
  1: {
    1: [
      [1, 100],
      [2, 100],
    ],
    2: [
      [3, 120],
      [4, 80],
    ],
    3: [
      [5, 90],
      [6, 110],
    ],
  },
  2: {
    1: [
      [1, 130],
      [3, 90],
    ],
    2: [
      [2, 95],
      [4, 105],
    ],
    3: [
      [5, 70],
      [6, 60],
    ],
  },
  3: {
    1: [
      [1, 110],
      [4, 100],
    ],
    2: [
      [2, 85],
      [3, 140],
    ],
    3: [
      [5, 75],
      [6, 95],
    ],
  },
  4: {
    1: [
      [1, 120],
      [4, 110],
    ],
    2: [
      [2, 100],
      [3, 130],
    ],
    3: [
      [5, 80],
      [6, 90],
    ],
  },
  5: {
    1: [
      [1, 105],
      [3, 125],
    ],
    2: [
      [2, 95],
      [4, 90],
    ],
  },
};
/** Week 5: teams 5 and 6 have no game (matchup_id null) but still score. */
const IDLE: Record<number, [number, number][]> = {
  5: [
    [5, 70],
    [6, 60],
  ],
};

function entry(roster: number, matchupId: number | null, score: number, week: number) {
  // Starters QB / RB / FLEX (a WR); bench RB scores more than the FLEX starter on odd weeks.
  const q = cents(score * 0.5);
  const r = cents(score * 0.3);
  const w = cents(score - q - r);
  const x = week % 2 === 1 ? cents(w + 7) : 0;
  return {
    roster_id: roster,
    matchup_id: matchupId,
    points: score,
    custom_points: null,
    starters: [`q${roster}`, `r${roster}`, `w${roster}`],
    starters_points: [q, r, w],
    players: [`q${roster}`, `r${roster}`, `w${roster}`, `x${roster}`],
    players_points: { [`q${roster}`]: q, [`r${roster}`]: r, [`w${roster}`]: w, [`x${roster}`]: x },
  };
}

export function matchupsFor(week: number) {
  const out: ReturnType<typeof entry>[] = [];
  for (const [id, [a, b]] of Object.entries(WEEKS[week] ?? {})) {
    out.push(entry(a[0], Number(id), a[1], week), entry(b[0], Number(id), b[1], week));
  }
  for (const [roster, score] of IDLE[week] ?? []) out.push(entry(roster, null, score, week));
  return out;
}

export const league = {
  league_id: LEAGUE_ID,
  previous_league_id: null,
  name: "Fixture League",
  season: "2030",
  status: "complete",
  total_rosters: 6,
  roster_positions: ["QB", "RB", "FLEX", "BN", "BN"],
  scoring_settings: { pass_yd: 0.04, rec: 1 },
  metadata: {},
  settings: {
    num_teams: 6,
    playoff_week_start: 4,
    playoff_teams: 4,
    playoff_round_type: 0,
    league_average_match: 1,
    waiver_type: 2,
    waiver_budget: 100,
    reserve_slots: 0,
    taxi_slots: 0,
  },
};

export const users = [1, 2, 3, 4, 5, 6].map((i) => ({
  user_id: `u${i}`,
  display_name: `Manager ${i}`,
  avatar: null,
  metadata: { team_name: `Team ${i}` },
}));

export const rosters = [1, 2, 3, 4, 5, 6].map((i) => ({
  roster_id: i,
  owner_id: `u${i}`,
  co_owners: null,
  players: [`q${i}`, `r${i}`, `w${i}`, `x${i}`],
  starters: [`q${i}`, `r${i}`, `w${i}`],
  reserve: null,
  taxi: null,
  settings: { wins: 0, losses: 0, ties: 0, fpts: 0, fpts_against: 0, division: 1 },
}));

export const winnersBracket = [
  { r: 1, m: 1, t1: 1, t2: 4, w: 1, l: 4 },
  { r: 1, m: 2, t1: 2, t2: 3, w: 3, l: 2 },
  { r: 2, m: 3, t1: 1, t2: 3, w: 3, l: 1, p: 1 },
  { r: 2, m: 4, t1: 4, t2: 2, w: 2, l: 4, p: 3 },
];

export const transactionsByWeek: Record<number, unknown[]> = {
  2: [
    {
      transaction_id: "t-win",
      type: "waiver",
      status: "complete",
      leg: 2,
      created: 1000,
      status_updated: 2000,
      creator: "u3",
      roster_ids: [3],
      adds: { nw1: 3 },
      drops: { x3: 3 },
      settings: { waiver_bid: 12 },
    },
    {
      transaction_id: "t-fail",
      type: "waiver",
      status: "failed",
      leg: 2,
      created: 1100,
      status_updated: 2000,
      creator: "u4",
      roster_ids: [4],
      adds: { nw1: 4 },
      drops: null,
      settings: { waiver_bid: 15 },
      metadata: { notes: "Player was claimed by another team." },
    },
  ],
  3: [
    {
      transaction_id: "t-trade",
      type: "trade",
      status: "complete",
      leg: 3,
      created: 3000,
      status_updated: 3100,
      creator: "u1",
      roster_ids: [1, 2],
      adds: { w2: 1, w1: 2 },
      drops: { w2: 2, w1: 1 },
      draft_picks: [{ season: "2031", round: 2, roster_id: 2, previous_owner_id: 2, owner_id: 1 }],
      waiver_budget: [{ sender: 1, receiver: 2, amount: 5 }],
    },
  ],
};

export const playersDump = Object.fromEntries(
  [
    ...[1, 2, 3, 4, 5, 6].flatMap((i) => [
      [`q${i}`, "QB"],
      [`r${i}`, "RB"],
      [`w${i}`, "WR"],
      [`x${i}`, "RB"],
    ]),
    ["nw1", "WR"],
  ].map(([id, pos]) => [
    id!,
    {
      player_id: id,
      full_name: `Player ${id}`,
      position: pos,
      fantasy_positions: [pos],
      team: "KC",
      active: true,
    },
  ])
);

/** URL -> JSON body (undefined = 404) for the fake Sleeper API. */
export function route(url: string): unknown | undefined {
  const u = new URL(url);
  const p = u.pathname.replace(/^\/v1/, "");
  if (u.pathname.startsWith("/projections/")) return [];
  const st = p.match(/^\/stats\/nfl\/regular\/2030\/(\d+)$/);
  if (st) return Number(st[1]) === 1 ? { q1: { pass_int: 2 } } : {};
  if (p === "/state/nfl") return { week: 1, season: "2031", season_type: "off", display_week: 1 };
  if (p === "/players/nfl") return playersDump;
  if (p === `/league/${LEAGUE_ID}`) return league;
  if (p === `/league/${LEAGUE_ID}/users`) return users;
  if (p === `/league/${LEAGUE_ID}/rosters`) return rosters;
  if (p === `/league/${LEAGUE_ID}/winners_bracket`) return winnersBracket;
  if (p === `/league/${LEAGUE_ID}/losers_bracket`) return [];
  if (p === `/league/${LEAGUE_ID}/drafts`) return [];
  if (p === `/league/${LEAGUE_ID}/traded_picks`) return [];
  let m = p.match(new RegExp(`^/league/${LEAGUE_ID}/matchups/(\\d+)$`));
  if (m) return matchupsFor(Number(m[1]));
  m = p.match(new RegExp(`^/league/${LEAGUE_ID}/transactions/(\\d+)$`));
  if (m) return transactionsByWeek[Number(m[1])] ?? [];
  return undefined;
}
