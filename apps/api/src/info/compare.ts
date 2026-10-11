import { sql } from "@rfp/db";
import type { Db } from "@rfp/db";
import { HttpError } from "../lib/http";
import { tradeValuations } from "../records/engines/trade-valuation";
import { franchiseEntities } from "./league-data";

export interface Meeting {
  season: number;
  week: number;
  gameType: "regular" | "playoffs" | "toilet_bowl" | "none";
  /** The first franchise's result. */
  result: "W" | "L" | "T";
  aPoints: number;
  bPoints: number;
  /** Two-week playoff games (ESPN 2020) count for the series but are one game over two weeks. */
  spanWeeks: number;
}

export interface TradeAsset {
  kind: "player" | "pick";
  label: string;
  position: string | null;
  /** Estimated value in points (rest-of-season production). */
  value: number | null;
}

export interface SharedTrade {
  transactionId: number;
  season: number;
  week: number;
  /** What the first franchise received from the second, and the reverse. */
  aGets: TradeAsset[];
  bGets: TradeAsset[];
  /** Estimated value the first franchise gained, net of what it sent. */
  net: number | null;
}

/**
 * Two franchises head to head: every head-to-head game they played (median games are not a matchup between them) and
 * every trade in which assets moved between them. The career summaries on the compare page come from the franchise
 * profiles, which already hold each manager record's rank.
 */
export async function managerCompare(db: Db, leagueId: number, a: number, b: number) {
  if (a === b) throw new HttpError(400, "pick two different franchises");
  const found = (
    await db.execute<{ id: number }>(
      sql`select id from franchise where league_id = ${leagueId} and id in (${a}, ${b})`
    )
  ).rows;
  if (found.length !== 2) throw new HttpError(404, "unknown franchise");

  const games = (
    await db.execute<{
      season: number;
      week: number;
      game_type: Meeting["gameType"];
      result: Meeting["result"];
      pf: number;
      pa: number;
      span: number | null;
    }>(sql`
      select gr.season, gr.week, gr.game_type::text as game_type, gr.result::text as result,
             gr.points_for::float8 as pf, gr.points_against::float8 as pa, m.span_weeks as span
      from rec_game_result gr
      left join matchup m on m.id = gr.matchup_id
      where gr.league_id = ${leagueId} and gr.kind = 'h2h' and gr.franchise_id = ${a}
        and gr.opponent_franchise_id = ${b}
      order by gr.season, gr.week, gr.seq`)
  ).rows;
  const meetings: Meeting[] = games.map((g) => ({
    season: Number(g.season),
    week: Number(g.week),
    gameType: g.game_type,
    result: g.result,
    aPoints: Number(g.pf),
    bPoints: Number(g.pa),
    spanWeeks: Number(g.span ?? 1),
  }));

  const items = (
    await db.execute<{
      item_id: number;
      transaction_id: number;
      league_season_id: number;
      season: number;
      week: number;
      kind: "player" | "pick";
      name: string | null;
      position: string | null;
      pick_season: number | null;
      pick_round: number | null;
      f: number;
      t: number;
    }>(sql`
      select i.item_id, i.transaction_id, i.league_season_id, i.season, i.week, i.kind::text as kind,
             p.full_name as name, p.position, i.pick_season, i.pick_round,
             fts.franchise_id as f, tts.franchise_id as t
      from rec_transaction_item i
      join team_season fts on fts.id = i.from_team_season_id
      join team_season tts on tts.id = i.to_team_season_id
      left join player p on p.id = i.player_id
      where i.type = 'trade' and i.kind in ('player', 'pick') and i.league_id = ${leagueId}
        and ((fts.franchise_id = ${a} and tts.franchise_id = ${b}) or (fts.franchise_id = ${b} and tts.franchise_id = ${a}))
      order by i.season, i.week, i.transaction_id, i.item_id`)
  ).rows;

  const seasonIds = [...new Set(items.map((i) => Number(i.league_season_id)))];
  const values = seasonIds.length
    ? await tradeValuations({ db, leagueId, seasonIds, scope: "all" })
    : new Map<number, number>();
  const byTx = new Map<number, SharedTrade>();
  for (const it of items) {
    const tx = byTx.get(Number(it.transaction_id)) ?? {
      transactionId: Number(it.transaction_id),
      season: Number(it.season),
      week: Number(it.week),
      aGets: [],
      bGets: [],
      net: values.size ? 0 : null,
    };
    byTx.set(tx.transactionId, tx);
    const value = values.get(Number(it.item_id));
    const asset: TradeAsset = {
      kind: it.kind,
      label:
        it.kind === "player"
          ? (it.name ?? "Unknown player")
          : `${it.pick_season ?? ""} round ${it.pick_round ?? "?"} pick`,
      position: it.position,
      value: value === undefined ? null : Math.round(value * 10) / 10,
    };
    const toA = Number(it.t) === a;
    (toA ? tx.aGets : tx.bGets).push(asset);
    if (tx.net !== null && value !== undefined) tx.net += toA ? value : -value;
  }
  const trades = [...byTx.values()].map((t) => ({
    ...t,
    net: t.net === null ? null : Math.round(t.net * 10) / 10,
  }));

  return { a, b, meetings, trades, entities: await franchiseEntities(db, [a, b]) };
}
