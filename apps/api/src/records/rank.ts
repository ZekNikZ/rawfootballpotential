import { sql } from "@rfp/db";
import type { SQL } from "@rfp/db";
import type { RankedRow, Refs, RunContext } from "./context";

/**
 * Wraps an engine's candidate query with ranking and paging.
 *
 * The inner query must return: `sort_value` (float, null rows are dropped), `season`, `franchise_id`,
 * `data` (jsonb of the displayed values), `refs` (jsonb of entity ids), `in_progress` (bool) and `tie_key`
 * (text, a stable order within equal values).
 *
 * Ranking uses RANK(), so equal values share a position (doc §3.3). `onePer` keeps only the best row per season
 * (the "season max" toggle) or per franchise before ranking.
 */
export async function rankRows(ctx: RunContext, inner: SQL): Promise<RankedRow[]> {
  const dir = ctx.def.direction === "asc" ? sql.raw("asc") : sql.raw("desc");
  const { limit, offset } = ctx.q;
  const picked =
    ctx.q.onePer === "season"
      ? sql`select distinct on (season) * from base where sort_value is not null order by season, sort_value ${dir}, tie_key`
      : ctx.q.onePer === "franchise"
        ? sql`select distinct on (franchise_id) * from base where sort_value is not null order by franchise_id, sort_value ${dir}, tie_key`
        : sql`select * from base where sort_value is not null`;

  const result = await ctx.db.execute<{
    rk: string;
    total: string;
    sort_value: number;
    data: Record<string, unknown>;
    refs: Refs;
    in_progress: boolean;
  }>(sql`
    with base as (${inner}),
    picked as (${picked}),
    ranked as (
      select picked.*, rank() over (order by sort_value ${dir}) as rk, count(*) over () as total from picked
    )
    select rk::int as rk, total::int as total, sort_value, data, refs, in_progress
    from ranked order by rk, tie_key limit ${limit} offset ${offset}`);

  return result.rows.map((r) => ({
    rank: Number(r.rk),
    total: Number(r.total),
    value: Number(r.sort_value),
    data: r.data,
    refs: r.refs,
    inProgress: r.in_progress,
  }));
}
