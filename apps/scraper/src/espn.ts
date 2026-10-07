// ESPN's fantasy JSON views (doc §5). The API is unofficial, so every request is polite (one at a time, with a pause)
// and everything fetched goes into the bundle: a season is only ever scraped once.

export const API_BASE = "https://lm-api-reads.fantasy.espn.com/apis/v3/games/ffl";

export interface EspnRequest {
  /** Stable name stored in the bundle, e.g. "mSettings" or "mBoxscore". */
  endpoint: string;
  /** Query parameters the bundle records (views, scoringPeriodId). */
  params: Record<string, unknown>;
  url: string;
}

export interface EspnResponse {
  endpoint: string;
  params: Record<string, unknown>;
  status: number;
  payload: unknown;
}

/** Fetches one URL; implemented with Node's fetch (public leagues) or the logged-in browser context. */
export type Getter = (url: string) => Promise<{ status: number; body: unknown }>;

export function leagueUrl(
  year: number,
  leagueId: string,
  views: string[],
  extra: Record<string, string> = {}
) {
  const qs = new URLSearchParams();
  for (const v of views) qs.append("view", v);
  for (const [k, v] of Object.entries(extra)) qs.set(k, v);
  return `${API_BASE}/seasons/${year}/segments/0/leagues/${leagueId}?${qs}`;
}

function request(
  year: number,
  leagueId: string,
  endpoint: string,
  views: string[],
  scoringPeriodId?: number
): EspnRequest {
  const extra: Record<string, string> =
    scoringPeriodId === undefined ? {} : { scoringPeriodId: String(scoringPeriodId) };
  return {
    endpoint,
    params: { views, ...(scoringPeriodId === undefined ? {} : { scoringPeriodId }) },
    url: leagueUrl(year, leagueId, views, extra),
  };
}

/** The views fetched once per season. mSettings goes first: it says how many weeks to fetch. */
export const SEASON_VIEWS: readonly { endpoint: string; views: string[] }[] = [
  { endpoint: "mSettings", views: ["mSettings"] },
  { endpoint: "mTeam", views: ["mTeam", "mStandings"] },
  { endpoint: "mRoster", views: ["mRoster"] },
  { endpoint: "mMatchupScore", views: ["mMatchupScore"] },
  { endpoint: "mDraftDetail", views: ["mDraftDetail"] },
];

export const seasonRequest = (year: number, leagueId: string, endpoint: string) => {
  const def = SEASON_VIEWS.find((v) => v.endpoint === endpoint);
  if (!def) throw new Error(`unknown season view ${endpoint}`);
  return request(year, leagueId, def.endpoint, def.views);
};

/**
 * Per week: every team's lineup with actual and projected points (mBoxscore), the week's rosters (mRoster: the only
 * way to get the score of a team that had no game, e.g. a playoff bye), and the week's transactions.
 */
export const weekRequests = (year: number, leagueId: string, week: number): EspnRequest[] => [
  request(year, leagueId, "mBoxscore", ["mBoxscore", "mMatchupScore"], week),
  request(year, leagueId, "mRosterWeek", ["mRoster"], week),
  request(year, leagueId, "mTransactions2", ["mTransactions2"], week),
];

/** How many scoring periods the season has, from the mSettings payload (falls back to 17). */
export function lastScoringPeriod(settings: unknown): number {
  const s = settings as {
    status?: { finalScoringPeriod?: number; currentMatchupPeriod?: number };
    scoringPeriodId?: number;
  };
  const final = s?.status?.finalScoringPeriod;
  return typeof final === "number" && final > 0 && final <= 25 ? final : 17;
}

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

export interface FetchOptions {
  /** Pause between requests, ms (a little jitter is added). */
  pauseMs?: number;
  retries?: number;
  log?: (msg: string) => void;
}

/** One request with backoff on 429 / 5xx. A 401 / 403 is returned to the caller (it means "log in"). */
export async function fetchOne(
  get: Getter,
  req: EspnRequest,
  { pauseMs = 1200, retries = 3, log = () => undefined }: FetchOptions = {}
): Promise<EspnResponse> {
  for (let attempt = 0; ; attempt++) {
    await sleep(pauseMs + Math.floor(Math.random() * 400));
    const { status, body } = await get(req.url);
    if ((status === 429 || status >= 500) && attempt < retries) {
      const wait = 5000 * 2 ** attempt;
      log(`${req.endpoint}: HTTP ${status}, retrying in ${wait / 1000}s`);
      await sleep(wait);
      continue;
    }
    return { endpoint: req.endpoint, params: req.params, status, payload: body };
  }
}

/** A getter over Node's fetch, for public leagues. */
export const publicGetter: Getter = async (url) => {
  const res = await fetch(url, { headers: { accept: "application/json" }, redirect: "manual" });
  const text = await res.text();
  let body: unknown;
  try {
    body = JSON.parse(text);
  } catch {
    body = null;
  }
  return { status: res.status, body };
};
