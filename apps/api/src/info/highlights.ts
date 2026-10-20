import { getRecordDef, type ColumnType } from "@rfp/core";
import { sql } from "@rfp/db";
import type { Db } from "@rfp/db";
import { inList } from "../records/context";
import { resolveRows } from "../records/entities";
import type { RecordResponse } from "../records/run";
import { runRecord } from "../records/run";

// "Highlights": the top row(s) of a record, described well enough for a card (who, when, how much). They power the
// record-breaking feed (home page), the season recap, the Halls of Fame and Shame and the manager wrapped, so all of
// them read the same record engines (and the same response cache) as the Records pages.

export interface HighlightSpec {
  /** Record id. */
  id: string;
  /** What the card calls it ("Highest team score"). */
  label: string;
  /** Rank the opposite end of the record's ranked column (the lowest score, the narrowest win, the steadiest team). */
  flip?: boolean;
  /** Show the losing side of a game-grain row instead (the Hall of Shame's "worst loss"). */
  loser?: boolean;
}

export interface Highlight {
  recordId: string;
  label: string;
  /** Position in the record's ranking over the rows searched (1 = the record). */
  rank: number;
  /** Another row shares this rank. */
  tied: boolean;
  season: number | null;
  week: number | null;
  /** The ranked value and how to display it. */
  value: number;
  valueType: ColumnType;
  /** The team (that season's name) and its manager, or the franchise's current ones for a career row. */
  team: string | null;
  manager: string | null;
  teamSeasonId: number | null;
  franchiseId: number | null;
  opponent: string | null;
  opponentFranchiseId: number | null;
  player: string | null;
  position: string | null;
  /** Game rows: the score line. */
  points: number | null;
  opponentPoints: number | null;
}

const asNumber = (v: unknown): number | null => {
  if (v === null || v === undefined || v === "") return null;
  const n = Number(v);
  return Number.isFinite(n) ? n : null;
};
const asText = (v: unknown): string | null => (typeof v === "string" && v ? v : null);

/** Describe one row of a record response (names come from the response's entity maps). */
export function toHighlight(
  res: RecordResponse,
  row: RecordResponse["rows"][number],
  spec: HighlightSpec,
  tied: boolean
): Highlight {
  const swap = spec.loser && row.refs.opponentTeamSeasonId;
  const teamSeasonId = swap ? row.refs.opponentTeamSeasonId! : (row.refs.teamSeasonId ?? null);
  const franchiseId = swap
    ? (row.refs.opponentFranchiseId ?? null)
    : (row.refs.franchiseId ?? null);
  const managerId = swap ? row.refs.opponentManagerId : row.refs.managerId;
  const oppTeamSeasonId = swap
    ? (row.refs.teamSeasonId ?? null)
    : (row.refs.opponentTeamSeasonId ?? null);
  const teamSeason = teamSeasonId ? res.entities.teamSeasons[teamSeasonId] : undefined;
  const franchise = franchiseId ? res.entities.franchises[franchiseId] : undefined;
  const oppSeason = oppTeamSeasonId ? res.entities.teamSeasons[oppTeamSeasonId] : undefined;
  const sortCol = res.meta.columns.find((c) => c.key === res.meta.sortKey);
  const points = asNumber(row.values.points);
  const oppPoints = asNumber(row.values.opponentPoints);
  return {
    recordId: res.meta.id,
    label: spec.label,
    rank: row.rank,
    tied,
    season: asNumber(row.refs.season) ?? asNumber(row.values.season),
    week: asNumber(row.refs.week) ?? asNumber(row.values.week),
    value: Number(row.values.value),
    valueType: sortCol?.type ?? "decimal",
    team: teamSeason?.name ?? franchise?.teamName ?? null,
    manager: managerId == null ? null : (res.entities.managers[managerId]?.name ?? null),
    teamSeasonId,
    franchiseId,
    opponent: oppSeason?.name ?? null,
    opponentFranchiseId: swap
      ? (row.refs.franchiseId ?? null)
      : (row.refs.opponentFranchiseId ?? null),
    player: asText(row.values.player),
    position: asText(row.values.position),
    points: oppPoints === null ? null : swap ? oppPoints : points,
    opponentPoints: oppPoints === null ? null : swap ? points : oppPoints,
  };
}

/** Run a spec's record the way the Records page's first view does (so the response cache is shared). */
export async function runSpec(
  db: Db,
  leagueId: number,
  spec: HighlightSpec,
  params: Record<string, unknown> = {}
): Promise<RecordResponse> {
  const def = getRecordDef(spec.id);
  if (!def) throw new Error(`unknown record ${spec.id}`);
  const flip = spec.flip
    ? { sort: def.sortKey, dir: def.direction === "desc" ? "asc" : "desc" }
    : {};
  const base = def.displayAll ? { limit: 200 } : {};
  return runRecord(db, leagueId, spec.id, { ...base, ...params, ...flip });
}

/** The rows ranked at or above `maxRank` that pass `keep`, as highlights. */
export function topHighlights(
  res: RecordResponse,
  spec: HighlightSpec,
  maxRank: number,
  keep: (row: RecordResponse["rows"][number]) => boolean = () => true
): Highlight[] {
  const out: Highlight[] = [];
  for (const row of res.rows) {
    if (row.rank > maxRank) continue;
    if (!keep(row)) continue;
    const tied = res.rows.filter((r) => r.rank === row.rank).length > 1;
    out.push(toHighlight(res, row, spec, tied));
  }
  return out;
}

// ---- record-breaking feed -------------------------------------------------------------------------------------

/**
 * The single-game records that can be broken in a week. Each one is read over the whole history: a row from the
 * week that sits at rank 1 is a new league record.
 */
export const BREAKABLE: readonly HighlightSpec[] = [
  { id: "score.high", label: "Highest team score" },
  { id: "score.high", label: "Lowest team score", flip: true },
  { id: "blowout", label: "Biggest blowout" },
  { id: "blowout", label: "Closest game", flip: true },
  { id: "loss.high-score", label: "Highest score in a loss" },
  { id: "win.low-score", label: "Lowest score in a win" },
  { id: "bench.high", label: "Most points left on the bench" },
  { id: "potential.high", label: "Highest potential score" },
  { id: "potential.high", label: "Lowest potential score", flip: true },
  { id: "teamwide.high", label: "Most whole-roster points" },
  { id: "teamwide.high", label: "Fewest whole-roster points", flip: true },
  { id: "ratio.high", label: "Most efficient lineup" },
  { id: "ratio.high", label: "Least efficient lineup", flip: true },
  { id: "shouldve-won", label: "Costliest should've-won loss" },
  { id: "boombust.week", label: "Biggest boom week" },
  { id: "boombust.week", label: "Biggest bust week", flip: true },
  { id: "projection.boom", label: "Biggest beat of projection" },
  { id: "projection.boom", label: "Biggest miss of projection", flip: true },
  { id: "projection.upset", label: "Biggest upset" },
  { id: "nfl.stack", label: "Most points from one NFL game" },
  { id: "player.starter.high", label: "Best starter performance" },
  { id: "player.bench.high", label: "Best performance left on the bench" },
  // League-wide weeks (no team on the card): the average per team-game, at both ends, over regular-season weeks.
  { id: "league.week.counted.avg", label: "Highest-scoring league week" },
  { id: "league.week.counted.avg", label: "Lowest-scoring league week", flip: true },
  { id: "league.week.bench.avg", label: "Most league-wide bench points" },
  { id: "league.week.bench.avg", label: "Fewest league-wide bench points", flip: true },
  { id: "league.week.teamwide.avg", label: "Most league-wide roster points" },
  { id: "league.week.teamwide.avg", label: "Fewest league-wide roster points", flip: true },
];

export interface BrokenRecord extends Highlight {
  /** The record's page id, for a link. */
  recordId: string;
}

/**
 * Records that were set or tied in one week (`week` given) or one whole season (`week` null), judged against the
 * league's entire history: the row has to be ranked at or above `maxRank` over every season.
 */
export async function recordsBroken(
  db: Db,
  leagueId: number,
  season: number,
  week: number | null,
  maxRank: number
): Promise<BrokenRecord[]> {
  const found = await Promise.all(
    BREAKABLE.map(async (spec) => {
      const res = await runSpec(db, leagueId, spec);
      return topHighlights(res, spec, maxRank, (row) => {
        const rowSeason = asNumber(row.refs.season) ?? asNumber(row.values.season);
        const rowWeek = asNumber(row.refs.week) ?? asNumber(row.values.week);
        return rowSeason === season && (week === null || rowWeek === week);
      });
    })
  );
  return found.flat().sort((a, b) => a.rank - b.rank);
}

// ---- team labels ----------------------------------------------------------------------------------------------

export interface TeamRef {
  teamSeasonId: number;
  franchiseId: number;
  /** That season's team name and the manager who ran it. */
  team: string;
  manager: string | null;
  avatar: string | null;
}

/** Name, manager and logo of team seasons, in the same manager convention the records use (that season's manager). */
export async function describeTeams(
  db: Db,
  teamSeasonIds: readonly number[]
): Promise<Map<number, TeamRef>> {
  const ids = [...new Set(teamSeasonIds)];
  const out = new Map<number, TeamRef>();
  if (ids.length === 0) return out;
  const { rows, entities } = await resolveRows(
    db,
    ids.map((teamSeasonId) => ({
      rank: 0,
      total: 0,
      value: 0,
      data: {},
      refs: { teamSeasonId },
      inProgress: false,
    }))
  );
  const logos = (
    await db.execute<{ id: number; avatar: string | null }>(
      sql`select id, avatar from team_season where id in (${inList(ids)})`
    )
  ).rows;
  const avatar = new Map(logos.map((l) => [Number(l.id), l.avatar]));
  rows.forEach((r, i) => {
    const id = ids[i]!;
    const ts = entities.teamSeasons[id];
    if (!ts) return;
    out.set(id, {
      teamSeasonId: id,
      franchiseId: ts.franchiseId,
      team: ts.name,
      manager:
        r.refs.managerId == null ? null : (entities.managers[r.refs.managerId]?.name ?? null),
      avatar: avatar.get(id) ?? null,
    });
  });
  return out;
}
