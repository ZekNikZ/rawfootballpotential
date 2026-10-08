import { sql } from "@rfp/db";
import type { SQL } from "@rfp/db";
import type { ColumnDef } from "@rfp/core";
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
 *
 * Column sorting (`sort` / `dir`): sorting the ranked column just flips the ranking direction (rank 1 is the first
 * row shown, and `onePer` keeps the best row in that direction). Sorting any other column keeps the record's own
 * ranks and only changes the display order, so "Pos" always means the record's ranking.
 */
/** The direction the ranked column is ranked in for this query (the user may have flipped it by sorting it). */
export function rankDirection(ctx: RunContext): "asc" | "desc" {
  const rankedSort = !ctx.q.sort || ctx.q.sort === ctx.def.sortKey;
  return rankedSort ? (ctx.q.dir ?? ctx.def.direction) : ctx.def.direction;
}

export async function rankRows(ctx: RunContext, inner: SQL): Promise<RankedRow[]> {
  const { def, q } = ctx;
  const sortCol = q.sort ? def.columns.find((c) => c.key === q.sort) : undefined;
  const rankedSort = !sortCol || sortCol.key === def.sortKey;
  const dir = sql.raw(rankDirection(ctx));
  const display = sortCol && !rankedSort ? sql`${displayOrder(sortCol, q.dir ?? "desc")}, ` : sql``;
  const { limit, offset } = q;
  const picked =
    q.onePer === "season"
      ? sql`select distinct on (season) * from base where sort_value is not null order by season, sort_value ${dir}, tie_key`
      : q.onePer === "franchise"
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
    from ranked order by ${display}rk, tie_key limit ${limit} offset ${offset}`);

  return result.rows.map((r) => ({
    rank: Number(r.rk),
    total: Number(r.total),
    value: Number(r.sort_value),
    data: r.data,
    refs: r.refs,
    inProgress: r.in_progress,
  }));
}

/** ORDER BY terms for a column of the `data` object (nulls and values of another JSON type sort last). */
function displayOrder(col: ColumnDef, dir: "asc" | "desc"): SQL {
  const d = sql.raw(dir);
  const num = (key: string) =>
    sql`(case when jsonb_typeof(data -> ${key}::text) = 'number' then (data ->> ${key}::text)::float8 end) ${d} nulls last`;
  if (col.type === "text" || col.type === "player")
    return sql`(case when jsonb_typeof(data -> ${col.key}::text) = 'string' then lower(data ->> ${col.key}::text) end) ${d} nulls last`;
  if (col.type === "week") return sql`${num("season")}, ${num("week")}`;
  return num(col.key);
}
