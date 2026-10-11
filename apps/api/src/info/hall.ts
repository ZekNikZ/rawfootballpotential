import { sql } from "@rfp/db";
import type { Db, SQL } from "@rfp/db";
import { runSpec, topHighlights, type Highlight, type HighlightSpec } from "./highlights";
import { franchiseEntities } from "./league-data";

export interface HallEntry {
  id: string;
  title: string;
  /** What the value counts ("titles", "wins"), shown after it; null when the number speaks for itself. */
  unit: string | null;
  /** Who the list is about: managers (career records) or the team that did it in one season or event. */
  by: "manager" | "team";
  holders: Highlight[];
}

interface HallSpec extends HighlightSpec {
  /** Leave out holders whose value is zero or less (counts nobody has reached). */
  positive?: boolean;
  unit?: string;
}

const FAME: readonly HallSpec[] = [
  { id: "career.power", label: "Highest power rating" },
  { id: "career.winpct", label: "Best career win %" },
  { id: "career.place.avg", label: "Best average finish" },
  { id: "career.iq", label: "Smartest lineups" },
  { id: "career.allplay", label: "Best all-play record" },
  { id: "career.trade-value.total", label: "Best trader", positive: true },
  { id: "career.top-scorer", label: "Most weeks as the top scorer", positive: true, unit: "weeks" },
  { id: "career.perfect", label: "Most perfect lineups", positive: true, unit: "weeks" },
  { id: "career.win-streak", label: "Longest win streak", positive: true, unit: "wins" },
  { id: "streak.playoffs", label: "Longest playoff streak", positive: true, unit: "seasons" },
  { id: "score.high", label: "Highest team score" },
  { id: "season.pf.high", label: "Best scoring season" },
  { id: "player.starter.high", label: "Biggest player game" },
  { id: "trade.best.est", label: "Best trade ever" },
  { id: "pickup.best", label: "Best waiver pickup" },
  { id: "draft.steal", label: "Biggest draft steal" },
  { id: "seed.lowest-champion", label: "Most unlikely champion", unit: "seed" },
];

const SHAME: readonly HallSpec[] = [
  { id: "career.toilet-bowls", label: "Most toilet bowl trips", positive: true, unit: "trips" },
  { id: "drought.title", label: "Longest title drought", positive: true, unit: "seasons" },
  { id: "career.loss-streak", label: "Longest losing streak", positive: true, unit: "losses" },
  { id: "career.luck", label: "Unluckiest manager", flip: true },
  { id: "career.trade-value.total", label: "Worst trader", flip: true },
  { id: "career.bust", label: "Most bust weeks", positive: true, unit: "weeks" },
  { id: "career.shouldve-won", label: "Most should've-won losses", positive: true, unit: "losses" },
  { id: "career.blowout.losses", label: "Most blowout losses", positive: true, unit: "losses" },
  {
    id: "career.asleep",
    label: "Most starters on a bye or inactive",
    positive: true,
    unit: "starters",
  },
  { id: "blowout", label: "Worst beating ever", loser: true },
  { id: "score.high", label: "Lowest team score", flip: true },
  { id: "bench.high", label: "Most points left on the bench" },
  { id: "shouldve-won", label: "Costliest lineup mistake" },
  { id: "season.luck.high", label: "Unluckiest season", flip: true },
  { id: "drop-regret", label: "Biggest drop regret" },
];

/** Counts of final placements per franchise, as highlights (these have no record of their own). */
async function placementCounts(
  db: Db,
  leagueId: number,
  where: SQL,
  label: string,
  id: string
): Promise<HallEntry | null> {
  const rows = (
    await db.execute<{ franchise_id: number; n: number }>(sql`
      select franchise_id, count(*)::int as n from rec_team_season
      where league_id = ${leagueId} and season_complete and final_place is not null and ${where}
      group by franchise_id order by n desc, franchise_id limit 12`)
  ).rows;
  const ranked: { franchiseId: number; n: number; rank: number }[] = [];
  let rank = 0;
  let prev = -1;
  rows.forEach((r, i) => {
    if (r.n !== prev) rank = i + 1;
    prev = r.n;
    if (rank <= 3) ranked.push({ franchiseId: Number(r.franchise_id), n: r.n, rank });
  });
  if (ranked.length === 0) return null;
  const entities = await franchiseEntities(
    db,
    ranked.map((r) => r.franchiseId)
  );
  const holders: Highlight[] = ranked.slice(0, 4).map((r) => {
    const f = entities.franchises[r.franchiseId];
    return {
      recordId: id,
      label,
      rank: r.rank,
      tied: ranked.filter((x) => x.rank === r.rank).length > 1,
      season: null,
      week: null,
      value: r.n,
      valueType: "int",
      team: f?.teamName ?? null,
      manager: f?.managerId == null ? null : (entities.managers[f.managerId]?.name ?? null),
      teamSeasonId: null,
      franchiseId: r.franchiseId,
      opponent: null,
      opponentFranchiseId: null,
      player: null,
      position: null,
      points: null,
      opponentPoints: null,
    };
  });
  return {
    id,
    title: label,
    unit: id === "titles" ? "titles" : id === "lasts" ? "last places" : "runner-ups",
    by: "manager",
    holders,
  };
}

async function build(db: Db, leagueId: number, specs: readonly HallSpec[]): Promise<HallEntry[]> {
  const entries = await Promise.all(
    specs.map(async (spec, i): Promise<HallEntry | null> => {
      const res = await runSpec(db, leagueId, spec);
      let holders = topHighlights(res, spec, 3);
      if (spec.positive) holders = holders.filter((h) => h.value > 0);
      holders = holders.slice(0, 4);
      return holders.length
        ? {
            id: `${spec.id}#${i}`,
            title: spec.label,
            unit: spec.unit ?? null,
            by: /^(career|streak|drought)./.test(spec.id) ? "manager" : "team",
            holders,
          }
        : null;
    })
  );
  return entries.filter((e): e is HallEntry => e !== null);
}

/**
 * The Halls of Fame and Shame: the leaders (and the cautionary tales) of the league's records, read straight from
 * the record engines so they always agree with the Records pages. Counts of titles and last places have no record
 * of their own and are read from the final standings.
 */
export async function hallOfFame(db: Db, leagueId: number) {
  const [titles, lasts, seconds, fame, shame] = await Promise.all([
    placementCounts(db, leagueId, sql`final_place = 1`, "Most championships", "titles"),
    placementCounts(
      db,
      leagueId,
      sql`final_place = team_count`,
      "Most last-place finishes",
      "lasts"
    ),
    placementCounts(db, leagueId, sql`final_place = 2`, "Most runner-up finishes", "seconds"),
    build(db, leagueId, FAME),
    build(db, leagueId, SHAME),
  ]);
  return {
    fame: [...(titles ? [titles] : []), ...fame],
    shame: [...(lasts ? [lasts] : []), ...(seconds ? [seconds] : []), ...shame],
  };
}
