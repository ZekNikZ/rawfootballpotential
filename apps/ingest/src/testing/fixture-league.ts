// Hand-built Sleeper leagues for tests, with every answer worked out by hand in the tests that use them.
//
// Both seasons: 6 teams (rosters 1-6, owners u1-u6, so redraft franchise = manager across seasons), weeks 1-3 regular
// season with the median on, weeks 4-5 playoffs for rosters 1-4 (no losers bracket). Rosters 5 and 6 miss the playoffs:
// in week 4 they play a game that is not in any bracket (game_type 'none'), in week 5 they are idle (matchup_id null).
// Starters QB q / RB r / FLEX w (a WR); bench RB x. On odd weeks x outscores w by 7 (so the optimal lineup is better).

export type MatchupScores = Record<number, [[number, number], [number, number]]>;

export interface FixtureSeason {
  leagueId: string;
  year: number;
  previousLeagueId: string | null;
  /** week -> matchup id -> [[roster, score], [roster, score]] */
  weeks: Record<number, MatchupScores>;
  /** week -> idle [roster, score] */
  idle: Record<number, [number, number][]>;
  winners: unknown[];
  transactions: Record<number, unknown[]>;
  /** Players each team drafted, in rounds 1..3, when the season has a completed draft. */
  draft: boolean;
}

const WINNERS_BRACKET = [
  { r: 1, m: 1, t1: 1, t2: 4, w: 1, l: 4 },
  { r: 1, m: 2, t1: 2, t2: 3, w: 3, l: 2 },
  { r: 2, m: 3, t1: 1, t2: 3, w: 3, l: 1, p: 1 },
  { r: 2, m: 4, t1: 4, t2: 2, w: 2, l: 4, p: 3 },
];

export const FIXTURE_2030: FixtureSeason = {
  leagueId: "9001",
  year: 2030,
  previousLeagueId: null,
  weeks: {
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
  },
  idle: {
    5: [
      [5, 70],
      [6, 60],
    ],
  },
  winners: WINNERS_BRACKET,
  draft: false,
  transactions: {
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
        draft_picks: [
          { season: "2031", round: 2, roster_id: 2, previous_owner_id: 2, owner_id: 1 },
        ],
        waiver_budget: [{ sender: 1, receiver: 2, amount: 5 }],
      },
    ],
  },
};

export const FIXTURE_2031: FixtureSeason = {
  leagueId: "9002",
  year: 2031,
  previousLeagueId: "9001",
  weeks: {
    1: {
      1: [
        [1, 110],
        [2, 90],
      ],
      2: [
        [3, 100],
        [4, 105],
      ],
      3: [
        [5, 80],
        [6, 120],
      ],
    },
    2: {
      1: [
        [1, 130],
        [3, 95],
      ],
      2: [
        [2, 70],
        [4, 85],
      ],
      3: [
        [5, 90],
        [6, 60],
      ],
    },
    3: {
      1: [
        [1, 100],
        [4, 115],
      ],
      2: [
        [2, 60],
        [3, 125],
      ],
      3: [
        [5, 85],
        [6, 95],
      ],
    },
    4: {
      1: [
        [1, 105],
        [4, 120],
      ],
      2: [
        [2, 90],
        [3, 100],
      ],
      3: [
        [5, 70],
        [6, 75],
      ],
    },
    5: {
      1: [
        [4, 110],
        [3, 130],
      ],
      2: [
        [1, 100],
        [2, 95],
      ],
    },
  },
  idle: {
    5: [
      [5, 65],
      [6, 55],
    ],
  },
  winners: [
    { r: 1, m: 1, t1: 1, t2: 4, w: 4, l: 1 },
    { r: 1, m: 2, t1: 2, t2: 3, w: 3, l: 2 },
    { r: 2, m: 3, t1: 4, t2: 3, w: 3, l: 4, p: 1 },
    { r: 2, m: 4, t1: 1, t2: 2, w: 1, l: 2, p: 3 },
  ],
  draft: true,
  transactions: {
    1: [
      {
        transaction_id: "u-claim",
        type: "waiver",
        status: "complete",
        leg: 1,
        created: 10,
        status_updated: 20,
        creator: "u2",
        roster_ids: [2],
        adds: { nw2: 2 },
        drops: { x2: 2 },
        settings: { waiver_bid: 30 },
      },
    ],
    2: [
      {
        transaction_id: "u-fa",
        type: "free_agent",
        status: "complete",
        leg: 2,
        created: 30,
        status_updated: 30,
        creator: "u2",
        roster_ids: [2],
        adds: { nw1: 2 },
        drops: { w2: 2 },
        settings: null,
      },
    ],
    3: [
      {
        transaction_id: "u-trade3",
        type: "trade",
        status: "complete",
        leg: 3,
        created: 40,
        status_updated: 50,
        creator: "u3",
        roster_ids: [3, 4, 5],
        adds: { w3: 4, w4: 5, w5: 3 },
        drops: { w3: 3, w4: 4, w5: 5 },
        draft_picks: [],
        waiver_budget: [],
      },
    ],
    4: [
      {
        transaction_id: "u-reclaim",
        type: "waiver",
        status: "complete",
        leg: 4,
        created: 60,
        status_updated: 70,
        creator: "u2",
        roster_ids: [2],
        adds: { w2: 2 },
        drops: { nw1: 2 },
        settings: { waiver_bid: 7 },
      },
    ],
  },
};

const cents = (n: number) => Math.round(n * 100) / 100;

function entry(roster: number, matchupId: number | null, score: number, week: number) {
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

export function matchupsFor(season: FixtureSeason, week: number) {
  const out: ReturnType<typeof entry>[] = [];
  for (const [id, [a, b]] of Object.entries(season.weeks[week] ?? {})) {
    out.push(entry(a[0], Number(id), a[1], week), entry(b[0], Number(id), b[1], week));
  }
  for (const [roster, score] of season.idle[week] ?? []) out.push(entry(roster, null, score, week));
  return out;
}

const leagueFor = (s: FixtureSeason) => ({
  league_id: s.leagueId,
  previous_league_id: s.previousLeagueId,
  name: "Fixture League",
  season: String(s.year),
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
});

export const fixtureUsers = [1, 2, 3, 4, 5, 6].map((i) => ({
  user_id: `u${i}`,
  display_name: `Manager ${i}`,
  avatar: null,
  metadata: { team_name: `Team ${i}` },
}));

const rostersFor = () =>
  [1, 2, 3, 4, 5, 6].map((i) => ({
    roster_id: i,
    owner_id: `u${i}`,
    co_owners: null,
    players: [`q${i}`, `r${i}`, `w${i}`, `x${i}`],
    starters: [`q${i}`, `r${i}`, `w${i}`],
    reserve: null,
    taxi: null,
    settings: { wins: 0, losses: 0, ties: 0, fpts: 0, fpts_against: 0, division: 1 },
  }));

export const fixturePlayers = Object.fromEntries(
  [
    ...[1, 2, 3, 4, 5, 6].flatMap((i) => [
      [`q${i}`, "QB"],
      [`r${i}`, "RB"],
      [`w${i}`, "WR"],
      [`x${i}`, "RB"],
    ]),
    ["nw1", "WR"],
    ["nw2", "RB"],
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

const draftFor = (s: FixtureSeason) => {
  if (!s.draft) return { drafts: [], picks: [] as unknown[] };
  const id = `d${s.leagueId}`;
  const draft = {
    draft_id: id,
    status: "complete",
    type: "snake",
    start_time: 1,
    season: String(s.year),
    draft_order: Object.fromEntries([1, 2, 3, 4, 5, 6].map((i) => [`u${i}`, i])),
    slot_to_roster_id: Object.fromEntries([1, 2, 3, 4, 5, 6].map((i) => [String(i), i])),
    settings: { rounds: 3 },
  };
  const picks = [1, 2, 3].flatMap((round) =>
    [1, 2, 3, 4, 5, 6].map((slot) => ({
      pick_no: (round - 1) * 6 + slot,
      round,
      draft_slot: slot,
      roster_id: slot,
      player_id: `${["q", "r", "w"][round - 1]}${slot}`,
      is_keeper: null,
      metadata: {},
    }))
  );
  return { drafts: [draft], picks };
};

/**
 * Raw stat lines: every rostered player's line scores (rec: 1) exactly what the matchups say he scored, and the player
 * dropped in the fixture ("nw1") has a line of his own while on nobody's roster. Roster 1's QB also threw 2
 * interceptions in 2030 week 1 (the as-played scoring test).
 */
const statsFor = (s: FixtureSeason, week: number) => {
  const out: Record<string, Record<string, number>> = { nw1: { rec: 6 } };
  for (const e of matchupsFor(s, week))
    for (const [pid, pts] of Object.entries(e.players_points)) if (pts) out[pid] = { rec: pts };
  if (s.year === 2030 && week === 1) out.q1 = { ...out.q1, pass_int: 2 };
  return out;
};

/** URL -> JSON body (undefined = 404) for the fake Sleeper API serving the given seasons. */
export function fixtureRoute(seasons: readonly FixtureSeason[] = [FIXTURE_2030, FIXTURE_2031]) {
  return (url: string): unknown | undefined => {
    const u = new URL(url);
    const p = u.pathname.replace(/^\/v1/, "");
    if (u.pathname.startsWith("/projections/")) return [];
    if (p === "/state/nfl") return { week: 1, season: "2032", season_type: "off", display_week: 1 };
    if (p === "/players/nfl") return fixturePlayers;
    const st = p.match(/^\/stats\/nfl\/regular\/(\d+)\/(\d+)$/);
    if (st) {
      const s = seasons.find((x) => x.year === Number(st[1]));
      return s ? statsFor(s, Number(st[2])) : undefined;
    }
    const dp = p.match(/^\/draft\/([^/]+)\/picks$/);
    if (dp) {
      const s = seasons.find((x) => `d${x.leagueId}` === dp[1]);
      return s ? draftFor(s).picks : undefined;
    }
    const m = p.match(/^\/league\/(\d+)(?:\/(.+))?$/);
    if (!m) return undefined;
    const s = seasons.find((x) => x.leagueId === m[1]);
    if (!s) return undefined;
    const sub = m[2];
    if (sub === undefined) return leagueFor(s);
    if (sub === "users") return fixtureUsers;
    if (sub === "rosters") return rostersFor().map((r) => ({ ...r, league_id: s.leagueId }));
    if (sub === "winners_bracket") return s.winners;
    if (sub === "losers_bracket") return [];
    if (sub === "drafts") return draftFor(s).drafts;
    if (sub === "traded_picks") return [];
    const mw = sub.match(/^matchups\/(\d+)$/);
    if (mw) return matchupsFor(s, Number(mw[1]));
    const tx = sub.match(/^transactions\/(\d+)$/);
    if (tx) return s.transactions[Number(tx[1])] ?? [];
    return undefined;
  };
}
