import type { Scope } from "@rfp/core";
import { sql } from "@rfp/db";
import type { Db, SQL } from "@rfp/db";

/**
 * Trade value, rest-of-season production (doc 3.11.3). What a player or pick moved in a trade is worth, in points:
 *
 *  - A player is worth what he scored from the trade week to the end of that season, **wherever he was**: on the team
 *    that received him, on another team after a later trade, or on nobody's roster after a drop. Later moves by the
 *    team that received him are not followed and never change his value. The points are his scores under that league
 *    season's scoring (`player_week_points`, Sleeper's stat lines), so a free agent has points too.
 *  - ESPN seasons have no stat lines, so their players are valued on the points they scored while on a roster
 *    (`rec_player_week`): weeks he was a free agent, and the 2020 weeks without player rows, count as zero. Those
 *    figures are labelled as roster-only wherever they are shown.
 *  - In a dynasty league the next season counts as well, at DYNASTY_NEXT_SEASON_WEIGHT of his production.
 *  - A draft pick is worth the player it became: his whole draft season (and, in dynasty, the next at half). Before the
 *    draft it is worth the average of that round's picks in the league's earlier drafts.
 *
 * The receiver gains an item's value and the sender loses the same amount, so every trade and the league are zero-sum.
 */
export const DYNASTY_NEXT_SEASON_WEIGHT = 0.5;

/** One counted week of a player's value: his points and who had him on their roster (null: nobody). */
export interface WeekValue {
  week: number;
  points: number;
  holder: number | null;
}

/** A run of weeks in one season; `weight` is 1, or DYNASTY_NEXT_SEASON_WEIGHT for a dynasty next season. */
export interface Segment {
  year: number;
  weight: number;
  weeks: WeekValue[];
}

export interface PlayerDetail {
  value: number;
  segments: Segment[];
  /** Dynasty only: the next season has not been played yet, so it will add to the value once it is. */
  note: "next_season_pending" | null;
}

export interface PickDetail {
  value: number;
  /** The player the pick became; null before the draft. */
  made: { playerId: number; detail: PlayerDetail } | null;
  /** Before the draft: the round average over this many earlier picks. */
  averageOf: number | null;
}

interface TradeItem {
  itemId: number;
  transactionId: number;
  leagueSeasonId: number;
  week: number;
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

export interface ValuationInput {
  db: Db;
  leagueId: number;
  /** Seasons whose trades are valued (the Seasons filter); everything else is read from the whole league. */
  seasonIds: readonly number[];
  scope: Scope;
}

const weekTypeCond = (scope: Scope): SQL =>
  scope === "all"
    ? sql`true`
    : scope === "regular"
      ? sql`pp.week_type = 'regular'`
      : sql`pp.week_type = 'postseason'`;

const inList = (ids: readonly number[]): SQL =>
  ids.length === 0
    ? sql`null`
    : sql.join(
        ids.map((i) => sql`${i}`),
        sql`, `
      );

/** The trade items of the seasons being valued, with everything needed to value or explain them. */
async function prepare(input: ValuationInput) {
  const { db, leagueId, seasonIds, scope } = input;
  const rows = async (query: SQL) => (await db.execute<Record<string, unknown>>(query)).rows;

  const seasons = await rows(sql`
    select ls.id, ls.year, l.type::text as type
    from league_season ls join league l on l.id = ls.league_id
    where ls.league_id = ${leagueId} and ls.enabled`);
  const seasonById = new Map(
    seasons.map((s) => [
      num(s.id),
      { id: num(s.id), year: num(s.year), dynasty: s.type === "dynasty" },
    ])
  );
  const seasonByYear = new Map([...seasonById.values()].map((s) => [s.year, s]));

  const items: TradeItem[] = (
    await rows(sql`
      select i.item_id, i.transaction_id, i.league_season_id, i.week, i.executed_at, i.kind::text as kind,
             i.player_id, i.pick_season, i.pick_round, i.pick_original_franchise_id,
             i.from_team_season_id, i.to_team_season_id
      from rec_transaction_item i
      where i.type = 'trade' and i.kind in ('player', 'pick') and i.league_id = ${leagueId}
        and i.league_season_id in (${inList(seasonIds)})
      order by i.week, i.executed_at, i.item_id`)
  ).map((r) => ({
    itemId: num(r.item_id),
    transactionId: num(r.transaction_id),
    leagueSeasonId: num(r.league_season_id),
    week: num(r.week),
    kind: r.kind as "player" | "pick",
    playerId: numOrNull(r.player_id),
    pickSeason: numOrNull(r.pick_season),
    pickRound: numOrNull(r.pick_round),
    pickFranchiseId: numOrNull(r.pick_original_franchise_id),
    sender: numOrNull(r.from_team_season_id),
    receiver: numOrNull(r.to_team_season_id),
  }));

  // Drafted players: what a pick became, and the round averages for picks not yet made.
  const draftPicks = await rows(sql`
    select d.league_season_id, dp.round, dp.player_id, ots.franchise_id as original_franchise_id
    from draft_pick dp
    join draft d on d.id = dp.draft_id and d.status = 'complete' and d.kind <> 'startup'
    join rec_team_season ots on ots.team_season_id = coalesce(dp.original_team_season_id, dp.team_season_id)
    where ots.league_id = ${leagueId} and dp.player_id is not null`);

  const playerIds = [
    ...new Set([
      ...items.flatMap((i) => (i.playerId === null ? [] : [i.playerId])),
      ...draftPicks.map((d) => num(d.player_id)),
    ]),
  ];
  // week points of those players, wherever they were
  const points = new Map<string, Map<number, number>>(); // `${leagueSeasonId}:${player}` -> week -> points
  const lastWeekOf = new Map<number, number>(); // league season -> last completed week
  if (playerIds.length > 0) {
    for (const r of await rows(sql`
      select pp.league_season_id, pp.player_id, pp.week, pp.points
      from rec_player_points pp
      where pp.league_id = ${leagueId} and pp.player_id in (${inList(playerIds)}) and ${weekTypeCond(scope)}
      union all
      -- seasons with no stat lines (ESPN): the points a player scored while on a roster
      select pw.league_season_id, pw.player_id, pw.week, max(pw.points)
      from rec_player_week pw
      join league_season ls on ls.id = pw.league_season_id
      join league_season_week lsw on lsw.league_season_id = pw.league_season_id and lsw.week = pw.week and lsw.status = 'complete'
      cross join lateral (select case when ls.playoff_week_start is not null and pw.week >= ls.playoff_week_start then 'postseason' else 'regular' end as week_type) pp
      where pw.league_id = ${leagueId} and pw.player_id in (${inList(playerIds)}) and pw.points is not null
        and not exists (select 1 from player_week_points x where x.league_season_id = pw.league_season_id)
        and ${weekTypeCond(scope)}
      group by pw.league_season_id, pw.player_id, pw.week`)) {
      const key = `${num(r.league_season_id)}:${num(r.player_id)}`;
      const m = points.get(key) ?? new Map<number, number>();
      m.set(num(r.week), num(r.points));
      points.set(key, m);
    }
    // completed weeks per season: a week with no stat line still counts (as zero)
    for (const r of await rows(sql`
      select lsw.league_season_id, max(lsw.week) as last_week
      from league_season_week lsw join league_season ls on ls.id = lsw.league_season_id
      where ls.league_id = ${leagueId} and lsw.status = 'complete'
        and ${scope === "all" ? sql`true` : scope === "regular" ? sql`(ls.playoff_week_start is null or lsw.week < ls.playoff_week_start)` : sql`(ls.playoff_week_start is not null and lsw.week >= ls.playoff_week_start)`}
      group by lsw.league_season_id`))
      lastWeekOf.set(num(r.league_season_id), num(r.last_week));
  }
  // who had each player each week (rostered teams only; null = free agent)
  const holders = new Map<string, number>(); // `${leagueSeasonId}:${player}:${week}` -> team season
  if (playerIds.length > 0)
    for (const r of await rows(sql`
      select pw.league_season_id, pw.player_id, pw.week, pw.team_season_id
      from rec_player_week pw
      where pw.league_id = ${leagueId} and pw.player_id in (${inList(playerIds)})`))
      holders.set(
        `${num(r.league_season_id)}:${num(r.player_id)}:${num(r.week)}`,
        num(r.team_season_id)
      );

  const segmentOf = (
    leagueSeasonId: number,
    player: number,
    from: number,
    weight: number
  ): Segment => {
    const season = seasonById.get(leagueSeasonId);
    const last = lastWeekOf.get(leagueSeasonId) ?? 0;
    const byWeek = points.get(`${leagueSeasonId}:${player}`);
    const weeks: WeekValue[] = [];
    for (let w = Math.max(1, from); w <= last; w++)
      weeks.push({
        week: w,
        points: byWeek?.get(w) ?? 0,
        holder: holders.get(`${leagueSeasonId}:${player}:${w}`) ?? null,
      });
    return { year: season?.year ?? 0, weight, weeks };
  };

  /** A player's value from `fromWeek` of a season to its end (and, in dynasty, the next season at half). */
  const playerDetail = (leagueSeasonId: number, player: number, fromWeek: number): PlayerDetail => {
    const season = seasonById.get(leagueSeasonId);
    const segments = [segmentOf(leagueSeasonId, player, fromWeek, 1)];
    let note: PlayerDetail["note"] = null;
    if (season?.dynasty) {
      const next = seasonByYear.get(season.year + 1);
      if (next && (lastWeekOf.get(next.id) ?? 0) > 0)
        segments.push(segmentOf(next.id, player, 1, DYNASTY_NEXT_SEASON_WEIGHT));
      else note = "next_season_pending";
    }
    const value = segments.reduce(
      (t, g) => t + g.weight * g.weeks.reduce((x, w) => x + w.points, 0),
      0
    );
    return { value, segments, note };
  };

  const realized = (dp: Record<string, unknown>): PlayerDetail =>
    playerDetail(num(dp.league_season_id), num(dp.player_id), 1);
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
      v =
        picks.length === 0 ? 0 : picks.reduce((s, dp) => s + realized(dp).value, 0) / picks.length;
      roundAverage.set(round, v);
    }
    return v;
  };
  const pickDetail = (it: TradeItem): PickDetail => {
    if (it.pickSeason === null || it.pickRound === null || it.pickFranchiseId === null)
      return { value: 0, made: null, averageOf: null };
    const season = seasonByYear.get(it.pickSeason);
    const made = season
      ? pickByKey.get(`${season.id}:${it.pickRound}:${it.pickFranchiseId}`)
      : undefined;
    if (made) {
      const detail = realized(made);
      return {
        value: detail.value,
        made: { playerId: num(made.player_id), detail },
        averageOf: null,
      };
    }
    const round = it.pickRound;
    return {
      value: expectedOfRound(round),
      made: null,
      averageOf: draftPicks.filter((dp) => num(dp.round) === round).length,
    };
  };

  const valueOf = (it: TradeItem): number =>
    it.kind === "pick"
      ? pickDetail(it).value
      : it.playerId === null
        ? 0
        : playerDetail(it.leagueSeasonId, it.playerId, it.week).value;

  return { items, playerDetail, pickDetail, valueOf };
}

/** Item id -> value (the team that received the item gains it; the team that sent it loses the same amount). */
export async function tradeValuations(input: ValuationInput): Promise<Map<number, number>> {
  if (input.seasonIds.length === 0) return new Map();
  const { items, valueOf } = await prepare(input);
  return new Map(items.map((it) => [it.itemId, valueOf(it)]));
}

export interface ItemExplanation {
  itemId: number;
  transactionId: number;
  week: number;
  kind: "player" | "pick";
  playerId: number | null;
  pickSeason: number | null;
  pickRound: number | null;
  pickFranchiseId: number | null;
  sender: number | null;
  receiver: number | null;
  value: number;
  player: PlayerDetail | null;
  pick: PickDetail | null;
}

/** Every trade item of the seasons, explained week by week (for the manager breakdown page). */
export async function explainTrades(input: ValuationInput): Promise<ItemExplanation[]> {
  if (input.seasonIds.length === 0) return [];
  const { items, playerDetail, pickDetail, valueOf } = await prepare(input);
  return items.map((it) => ({
    itemId: it.itemId,
    transactionId: it.transactionId,
    week: it.week,
    kind: it.kind,
    playerId: it.playerId,
    pickSeason: it.pickSeason,
    pickRound: it.pickRound,
    pickFranchiseId: it.pickFranchiseId,
    sender: it.sender,
    receiver: it.receiver,
    value: valueOf(it),
    player:
      it.kind === "player" && it.playerId !== null
        ? playerDetail(it.leagueSeasonId, it.playerId, it.week)
        : null,
    pick: it.kind === "pick" ? pickDetail(it) : null,
  }));
}

/** The values as an inline `iv(item_id, v)` CTE for a record query. */
export function itemValuesCte(values: Map<number, number>): SQL {
  if (values.size === 0) return sql`iv(item_id, v) as (select null::int, null::float8 where false)`;
  const rows = [...values].map(
    ([id, v]) => sql`(${id}::int, ${Math.round(v * 1000) / 1000}::float8)`
  );
  return sql`iv(item_id, v) as (values ${sql.join(rows, sql`, `)})`;
}
