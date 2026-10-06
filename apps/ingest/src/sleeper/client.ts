import { z } from "zod";
import { log } from "../lib/log";
import { RateLimiter, type FreshnessPolicy, type RawStore } from "../lib/raw-store";
import {
  sleeperBracketGame,
  sleeperDraft,
  sleeperDraftPick,
  sleeperLeague,
  sleeperMatchupEntry,
  sleeperNflState,
  sleeperPlayer,
  sleeperProjection,
  sleeperRoster,
  sleeperTradedPick,
  sleeperTransaction,
  sleeperUser,
  sleeperUserLeague,
} from "./schemas";

const API = "https://api.sleeper.app/v1";
const APP_API = "https://api.sleeper.app";
const PROJECTION_POSITIONS = [
  "DB",
  "DEF",
  "DL",
  "FLEX",
  "IDP_FLEX",
  "K",
  "LB",
  "QB",
  "RB",
  "REC_FLEX",
  "SUPER_FLEX",
  "TE",
  "WR",
  "WRRB_FLEX",
];

/**
 * Sleeper API with every response cached in raw_payload. Calls are spaced to ~8/s (well under the 1000/min cap)
 * and retried with backoff on 429/5xx. A 404 is cached as `null`.
 */
export class SleeperClient {
  constructor(
    private readonly store: RawStore,
    private readonly limiter = new RateLimiter(8),
    private readonly opts: { force?: boolean } = {}
  ) {}

  private async get(url: string): Promise<unknown | null> {
    for (let attempt = 0; ; attempt++) {
      await this.limiter.wait();
      const res = await fetch(url, { headers: { accept: "application/json" } });
      if (res.status === 404) return null;
      if (res.ok) return (await res.json()) as unknown;
      if ((res.status === 429 || res.status >= 500) && attempt < 5) {
        const delay = 1000 * 2 ** attempt;
        log.warn({ url, status: res.status, delay }, "sleeper request failed, retrying");
        await new Promise((r) => setTimeout(r, delay));
        continue;
      }
      throw new Error(`Sleeper ${res.status} for ${url}`);
    }
  }

  private cached(
    endpoint: string,
    params: Record<string, unknown>,
    url: string,
    policy: FreshnessPolicy
  ) {
    return this.store.json("sleeper", endpoint, params, policy, () => this.get(url), {
      force: this.opts.force ?? false,
    });
  }

  private async parsed<S extends z.ZodType>(
    schema: S,
    endpoint: string,
    params: Record<string, unknown>,
    url: string,
    policy: FreshnessPolicy
  ): Promise<z.infer<S> | null> {
    const { data } = await this.cached(endpoint, params, url, policy);
    if (data === null) return null;
    const result = schema.safeParse(data);
    if (!result.success) {
      throw new Error(
        `Unexpected Sleeper payload for ${endpoint} ${JSON.stringify(params)}: ${z.prettifyError(result.error)}`
      );
    }
    return result.data;
  }

  league(id: string, policy: FreshnessPolicy) {
    return this.parsed(sleeperLeague, "league", { id }, `${API}/league/${id}`, policy);
  }
  users(id: string, policy: FreshnessPolicy) {
    return this.parsed(
      z.array(sleeperUser),
      "league/users",
      { id },
      `${API}/league/${id}/users`,
      policy
    );
  }
  rosters(id: string, policy: FreshnessPolicy) {
    return this.parsed(
      z.array(sleeperRoster),
      "league/rosters",
      { id },
      `${API}/league/${id}/rosters`,
      policy
    );
  }
  matchups(id: string, week: number, policy: FreshnessPolicy) {
    return this.parsed(
      z.array(sleeperMatchupEntry),
      "league/matchups",
      { id, week },
      `${API}/league/${id}/matchups/${week}`,
      policy
    );
  }
  winnersBracket(id: string, policy: FreshnessPolicy) {
    return this.parsed(
      z.array(sleeperBracketGame),
      "league/winners_bracket",
      { id },
      `${API}/league/${id}/winners_bracket`,
      policy
    );
  }
  losersBracket(id: string, policy: FreshnessPolicy) {
    return this.parsed(
      z.array(sleeperBracketGame),
      "league/losers_bracket",
      { id },
      `${API}/league/${id}/losers_bracket`,
      policy
    );
  }
  transactions(id: string, week: number, policy: FreshnessPolicy) {
    return this.parsed(
      z.array(sleeperTransaction),
      "league/transactions",
      { id, week },
      `${API}/league/${id}/transactions/${week}`,
      policy
    );
  }
  drafts(id: string, policy: FreshnessPolicy) {
    return this.parsed(
      z.array(sleeperDraft),
      "league/drafts",
      { id },
      `${API}/league/${id}/drafts`,
      policy
    );
  }
  draftPicks(draftId: string, policy: FreshnessPolicy) {
    return this.parsed(
      z.array(sleeperDraftPick),
      "draft/picks",
      { draftId },
      `${API}/draft/${draftId}/picks`,
      policy
    );
  }
  tradedPicks(id: string, policy: FreshnessPolicy) {
    return this.parsed(
      z.array(sleeperTradedPick),
      "league/traded_picks",
      { id },
      `${API}/league/${id}/traded_picks`,
      policy
    );
  }
  nflState(policy: FreshnessPolicy) {
    return this.parsed(sleeperNflState, "state/nfl", {}, `${API}/state/nfl`, policy);
  }
  /** Raw per-player stat lines for one NFL week (undocumented endpoint; used to re-score with as-played settings). */
  stats(season: number, week: number, policy: FreshnessPolicy) {
    return this.parsed(
      z.record(z.string(), z.record(z.string(), z.number())),
      "stats",
      { season, week, seasonType: "regular" },
      `${API}/stats/nfl/regular/${season}/${week}`,
      policy
    );
  }
  userLeagues(userId: string, season: number, policy: FreshnessPolicy) {
    return this.parsed(
      z.array(sleeperUserLeague),
      "user/leagues",
      { userId, season },
      `${API}/user/${userId}/leagues/nfl/${season}`,
      policy
    );
  }

  /** The full player dump (~10MB). Sleeper asks for at most one call a day; callers pass hours(20)+. */
  async playersNfl(policy: FreshnessPolicy) {
    const { data } = await this.cached("players/nfl", {}, `${API}/players/nfl`, policy);
    if (!data) return null;
    const entries = Object.entries(z.record(z.string(), z.unknown()).parse(data));
    const players: z.infer<typeof sleeperPlayer>[] = [];
    for (const [, raw] of entries) {
      const parsed = sleeperPlayer.safeParse(raw);
      if (parsed.success) players.push(parsed.data);
    }
    return players;
  }

  /** Raw weekly projections (stat lines per player); points are computed with a league's scoring settings. */
  async projections(season: number, week: number, policy: FreshnessPolicy) {
    const qs = PROJECTION_POSITIONS.map((p) => `position%5B%5D=${p}`).join("&");
    return this.parsed(
      z.array(sleeperProjection),
      "projections",
      { season, week, seasonType: "regular" },
      `${APP_API}/projections/nfl/${season}/${week}?season_type=regular&${qs}&order_by=ppr`,
      policy
    );
  }
}
