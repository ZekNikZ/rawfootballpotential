import { optimalLineup, type LineupPlayer, type Scope } from "@rfp/core";
import { sql } from "@rfp/db";
import type { Db, SQL } from "@rfp/db";
import { scopeCond } from "../context";
import { chainValues, type ChainItem } from "./trade-chain";

/**
 * Estimated trade value (doc 3.11.3, "Estimated trade value"). Everything a record or the Transactions page needs to
 * value what moved in a trade, in points:
 *
 *  - A player's value to a team is what he added to its best possible lineup: for every counted week he was on its
 *    roster after the trade, the team's optimal lineup with him minus the optimal lineup without him, plus
 *    DEPTH_CREDIT_WEIGHT of the rest of his points that week (depth: what a replacement would have covered). IR and
 *    taxi players get no depth credit.
 *  - The weeks run from the trade to the end of his stint with that team, including the week he was moved if he was
 *    still in that week's lineup snapshot. In a dynasty league, a player still on the franchise when the season ended
 *    also counts for the next season, at DYNASTY_NEXT_SEASON_WEIGHT.
 *  - A draft pick is worth the value of the player it became (to the team that made the pick). Before the draft it is
 *    worth the average of that round's picks in the league's earlier drafts.
 *  - With `chain`, a player the team traded on is also worth his share of what it received for him (see chainValues).
 *    Career totals leave this out, because the return of a re-trade is already credited in that trade.
 */
export const DYNASTY_NEXT_SEASON_WEIGHT = 0.5;
export const DEPTH_CREDIT_WEIGHT = 0.5;

/** One week of a player's value: what he added to the lineup, plus partial credit for the points a replacement covered. */
export const weekValue = (points: number, marginal: number, depthEligible: boolean): number =>
  marginal + (depthEligible ? DEPTH_CREDIT_WEIGHT * Math.max(0, points - marginal) : 0);

interface Stint {
  fromWeek: number;
  toWeek: number;
  leftVia: string | null;
}

interface TradeItem {
  itemId: number;
  transactionId: number;
  leagueSeasonId: number;
  week: number;
  executedAt: number;
  kind: "player" | "pick";
  playerId: number | null;
  pickSeason: number | null;
  pickRound: number | null;
  pickFranchiseId: number | null;
  sender: number | null;
  receiver: number | null;
}

const num = (v: unknown): number => Number(v);
const numOrNull = (v: unknown): number | null => (v === null || v === undefined ? null : Number(v));

/** The last week a stint's player can still be in that team's lineup snapshot (the week he was moved, too). */
const lastWeekOf = (s: Stint): number =>
  s.leftVia === "drop" || s.leftVia === "trade" || s.leftVia === "commissioner"
    ? s.toWeek + 1
    : s.toWeek;

export interface ValuationInput {
  db: Db;
  leagueId: number;
  /** Seasons whose trades are valued (the Seasons filter); everything else is read from the whole league. */
  seasonIds: readonly number[];
  scope: Scope;
  chain: boolean;
}

/** Everything read once for a valuation: the league's seasons, rosters, tenures, drafts. */
async function load(input: ValuationInput) {
  const { db, leagueId, scope } = input;
  const rows = async (query: SQL) => (await db.execute<Record<string, unknown>>(query)).rows;

  const seasons = await rows(sql`
    select ls.id, ls.year, ls.roster_slots, l.type::text as type
    from league_season ls join league l on l.id = ls.league_id
    where ls.league_id = ${leagueId} and ls.enabled`);
  const seasonById = new Map(
    seasons.map((s) => [
      num(s.id),
      {
        id: num(s.id),
        year: num(s.year),
        slots: s.roster_slots as string[],
        dynasty: s.type === "dynasty",
      },
    ])
  );
  const seasonByYear = new Map([...seasonById.values()].map((s) => [s.year, s]));

  const teamRows = await rows(sql`
    select team_season_id, league_season_id, franchise_id from rec_team_season where league_id = ${leagueId}`);
  const teamSeason = new Map(
    teamRows.map((t) => [
      num(t.team_season_id),
      { leagueSeasonId: num(t.league_season_id), franchiseId: num(t.franchise_id) },
    ])
  );
  const teamOf = new Map(
    teamRows.map((t) => [
      `${num(t.league_season_id)}:${num(t.franchise_id)}`,
      num(t.team_season_id),
    ])
  );

  const tenure = new Map<string, Stint[]>();
  for (const t of await rows(sql`
    select t.team_season_id, t.player_id, t.from_week, t.to_week, t.left_via::text as left_via
    from player_tenure t join rec_team_season ts on ts.team_season_id = t.team_season_id
    where ts.league_id = ${leagueId}`)) {
    const key = `${num(t.team_season_id)}:${num(t.player_id)}`;
    const stint: Stint = {
      fromWeek: num(t.from_week),
      toWeek: num(t.to_week),
      leftVia: (t.left_via as string | null) ?? null,
    };
    tenure.set(key, [...(tenure.get(key) ?? []), stint]);
  }
  const stintAt = (ts: number, player: number, week: number): Stint | null =>
    (tenure.get(`${ts}:${player}`) ?? []).find((s) => s.fromWeek <= week && week <= s.toWeek) ??
    null;

  // Counted weeks inside the scope: the whole roster of every team-week, which the optimal lineup needs.
  const rosters = new Map<string, LineupPlayer[]>();
  const slotKinds = new Map<string, string>();
  for (const r of await rows(sql`
    select pw.team_season_id, pw.week, pw.player_id, pw.position, pw.eligible_positions, pw.points,
           pw.slot_kind::text as slot_kind
    from rec_player_week pw
    where pw.league_id = ${leagueId} and pw.counts and pw.points is not null
      and ${scopeCond(sql`pw.game_type`, scope)}`)) {
    const key = `${num(r.team_season_id)}:${num(r.week)}`;
    const list = rosters.get(key) ?? [];
    slotKinds.set(`${key}:${num(r.player_id)}`, String(r.slot_kind));
    list.push({
      id: num(r.player_id),
      points: num(r.points),
      position: (r.position as string | null) ?? null,
      eligiblePositions: (r.eligible_positions as string[] | null) ?? null,
    });
    rosters.set(key, list);
  }
  const best = new Map<string, number>();
  const bestOf = (ts: number, week: number, without: number | null): number | null => {
    const roster = rosters.get(`${ts}:${week}`);
    if (!roster) return null;
    const slots = seasonById.get(teamSeason.get(ts)?.leagueSeasonId ?? -1)?.slots ?? [];
    if (without === null) {
      const key = `${ts}:${week}`;
      let v = best.get(key);
      if (v === undefined) {
        v = optimalLineup(slots, roster).points;
        best.set(key, v);
      }
      return v;
    }
    return optimalLineup(
      slots,
      roster.filter((p) => p.id !== without)
    ).points;
  };
  /** What `player` was worth to `ts` in `week` (0 when he was not on the roster or the week is out of scope). */
  const added = (ts: number, week: number, player: number): number => {
    const me = rosters.get(`${ts}:${week}`)?.find((p) => p.id === player);
    if (!me) return 0;
    const marginal = (bestOf(ts, week, null) ?? 0) - (bestOf(ts, week, player) ?? 0);
    const kind = slotKinds.get(`${ts}:${week}:${player}`);
    return weekValue(me.points, marginal, kind === "starter" || kind === "bench");
  };
  const window = (ts: number, player: number, from: number, to: number): number => {
    let v = 0;
    for (let w = Math.max(1, from); w <= to; w++) v += added(ts, w, player);
    return v;
  };

  /** A player's value to `ts` from `fromWeek` to the end of his stint (and, in dynasty, the next season). */
  const playerValue = (ts: number, player: number, fromWeek: number): number => {
    const stint = stintAt(ts, player, Math.max(1, fromWeek));
    if (!stint) return 0;
    let v = window(ts, player, fromWeek, lastWeekOf(stint));
    const info = teamSeason.get(ts);
    const season = info ? seasonById.get(info.leagueSeasonId) : undefined;
    if (season?.dynasty && stint.leftVia === "season_end") {
      const next = seasonByYear.get(season.year + 1);
      const nextTs = next ? teamOf.get(`${next.id}:${info!.franchiseId}`) : undefined;
      const nextStint = nextTs !== undefined ? stintAt(nextTs, player, 1) : null;
      if (nextTs !== undefined && nextStint)
        v += DYNASTY_NEXT_SEASON_WEIGHT * window(nextTs, player, 1, lastWeekOf(nextStint));
    }
    return v;
  };

  // ---- Picks: the player each became, and the round average for picks not yet made ----
  const draftPicks = await rows(sql`
    select d.league_season_id, dp.round, dp.team_season_id, dp.player_id,
           ots.franchise_id as original_franchise_id
    from draft_pick dp
    join draft d on d.id = dp.draft_id and d.status = 'complete' and d.kind <> 'startup'
    join rec_team_season ots on ots.team_season_id = coalesce(dp.original_team_season_id, dp.team_season_id)
    where ots.league_id = ${leagueId} and dp.player_id is not null`);
  const realized = (dp: Record<string, unknown>): number =>
    playerValue(num(dp.team_season_id), num(dp.player_id), 1);
  const pickByKey = new Map(
    draftPicks.map((dp) => [
      `${num(dp.league_season_id)}:${num(dp.round)}:${num(dp.original_franchise_id)}`,
      dp,
    ])
  );
  const roundAverage = new Map<number, number>();
  const expectedOfRound = (round: number): number => {
    let v = roundAverage.get(round);
    if (v === undefined) {
      const picks = draftPicks.filter((dp) => num(dp.round) === round);
      v = picks.length === 0 ? 0 : picks.reduce((s, dp) => s + realized(dp), 0) / picks.length;
      roundAverage.set(round, v);
    }
    return v;
  };
  const pickValue = (it: TradeItem): number => {
    if (it.pickSeason === null || it.pickRound === null || it.pickFranchiseId === null) return 0;
    const season = seasonByYear.get(it.pickSeason);
    const made = season
      ? pickByKey.get(`${season.id}:${it.pickRound}:${it.pickFranchiseId}`)
      : undefined;
    return made ? realized(made) : expectedOfRound(it.pickRound);
  };

  return {
    rows,
    seasonById,
    seasonByYear,
    teamSeason,
    tenure,
    rosters,
    stintAt,
    added,
    window,
    playerValue,
    pickValue,
  };
}

/** Item id -> estimated value for the team that received it (the team that sent it loses the same amount). */
export async function tradeValuations(input: ValuationInput): Promise<Map<number, number>> {
  const { leagueId, seasonIds } = input;
  if (seasonIds.length === 0) return new Map();
  const { rows, tenure, stintAt, window, playerValue, pickValue } = await load(input);

  // ---- The trade items to value ----
  const items: TradeItem[] = (
    await rows(sql`
      select i.item_id, i.transaction_id, i.league_season_id, i.week, i.executed_at, i.kind::text as kind,
             i.player_id, i.pick_season, i.pick_round, i.pick_original_franchise_id,
             i.from_team_season_id, i.to_team_season_id
      from rec_transaction_item i
      where i.type = 'trade' and i.kind in ('player', 'pick') and i.league_id = ${leagueId}
        and i.league_season_id in (${sql.join(
          seasonIds.map((s) => sql`${s}`),
          sql`, `
        )})`)
  ).map((r) => ({
    itemId: num(r.item_id),
    transactionId: num(r.transaction_id),
    leagueSeasonId: num(r.league_season_id),
    week: num(r.week),
    executedAt: r.executed_at ? new Date(r.executed_at as string).getTime() : 0,
    kind: r.kind as "player" | "pick",
    playerId: numOrNull(r.player_id),
    pickSeason: numOrNull(r.pick_season),
    pickRound: numOrNull(r.pick_round),
    pickFranchiseId: numOrNull(r.pick_original_franchise_id),
    sender: numOrNull(r.from_team_season_id),
    receiver: numOrNull(r.to_team_season_id),
  }));

  const direct = (it: TradeItem): number =>
    it.kind === "pick"
      ? pickValue(it)
      : it.receiver === null || it.playerId === null
        ? 0
        : playerValue(it.receiver, it.playerId, it.week);

  if (!input.chain) return new Map(items.map((it) => [it.itemId, direct(it)]));

  // ---- Chains: a player the receiving team traded on within the same stint ----
  const order = (a: TradeItem, b: TradeItem) =>
    a.week - b.week || a.executedAt - b.executedAt || a.itemId - b.itemId;
  const playersByKey = new Map<string, TradeItem[]>();
  for (const it of items)
    if (it.kind === "player" && it.sender !== null && it.playerId !== null) {
      const key = `${it.sender}:${it.playerId}`;
      playersByKey.set(key, [...(playersByKey.get(key) ?? []), it]);
    }
  const chainItems: ChainItem[] = items.map((it) => {
    let nextItemId: number | null = null;
    if (it.kind === "player" && it.receiver !== null && it.playerId !== null) {
      const stint = stintAt(it.receiver, it.playerId, Math.max(1, it.week));
      const limit = (stint ? stint.toWeek : it.week - 1) + 1;
      const next = (playersByKey.get(`${it.receiver}:${it.playerId}`) ?? [])
        .filter(
          (j) => j.leagueSeasonId === it.leagueSeasonId && order(it, j) < 0 && j.week <= limit
        )
        .sort(order)[0];
      nextItemId = next?.itemId ?? null;
    }
    // The share a sent item has in the return: what it had been worth to the sender over the stint that this trade
    // ended; a pick is worth its own value.
    let weight = 0;
    if (it.kind === "pick") weight = pickValue(it);
    else if (it.sender !== null && it.playerId !== null) {
      const stint = (tenure.get(`${it.sender}:${it.playerId}`) ?? []).find(
        (s) => s.toWeek === it.week - 1 && s.leftVia === "trade"
      );
      if (stint) weight = window(it.sender, it.playerId, stint.fromWeek, lastWeekOf(stint));
    }
    return {
      itemId: it.itemId,
      transactionId: it.transactionId,
      sender: it.sender,
      receiver: it.receiver,
      direct: direct(it),
      weight,
      nextItemId,
    };
  });
  return chainValues(chainItems);
}

/** The values as an inline `iv(item_id, v)` CTE for a record query. */
export function itemValuesCte(values: Map<number, number>): SQL {
  if (values.size === 0) return sql`iv(item_id, v) as (select null::int, null::float8 where false)`;
  const rows = [...values].map(
    ([id, v]) => sql`(${id}::int, ${Math.round(v * 1000) / 1000}::float8)`
  );
  return sql`iv(item_id, v) as (values ${sql.join(rows, sql`, `)})`;
}
