import { league, leagueSeason, sql, type Db } from "@rfp/db";
import { z } from "zod";
import { RawStore } from "./lib/raw-store";
import { sleeperRoster } from "./sleeper/schemas";

export interface SeasonReport {
  league: string;
  year: number;
  source: string;
  status: string;
  teams: number;
  weeks: { total: number; complete: number };
  gamesByType: Record<string, number>;
  teamWeeks: { counted: number; notCounted: number };
  playersPerTeamWeek: { min: number; avg: number; max: number } | null;
  playerWeeks: number;
  playerWeeksWithoutNfl: number;
  unmatchedPlayers: number;
  transactions: { complete: number; failed: number };
  draftPicks: number;
  placementsSet: number;
  /** Our regular-season W/L/T + PF vs Sleeper's own roster record, per team. */
  recordCheck: { teams: number; mismatches: string[] } | null;
  lineupIqAboveOne: number;
}

export async function buildReport(db: Db): Promise<SeasonReport[]> {
  const seasons = await db
    .select({ s: leagueSeason, l: league })
    .from(leagueSeason)
    .innerJoin(league, sql`${league.id} = ${leagueSeason.leagueId}`)
    .orderBy(league.displayOrder, leagueSeason.year);
  const store = new RawStore(db);
  const out: SeasonReport[] = [];
  for (const { s, l } of seasons) {
    const one = async <T extends Record<string, unknown>>(q: ReturnType<typeof sql>) =>
      (await db.execute<T>(q)).rows;
    const [counts] = await one<{
      teams: string;
      weeks: string;
      complete: string;
      counted: string;
      notcounted: string;
      pw: string;
      nonfl: string;
      unk: string;
      txc: string;
      txf: string;
      picks: string;
      placed: string;
      iq: string;
    }>(sql`
      select
        (select count(*) from team_season where league_season_id = ${s.id}) teams,
        (select count(*) from league_season_week where league_season_id = ${s.id}) weeks,
        (select count(*) from league_season_week where league_season_id = ${s.id} and status = 'complete') complete,
        (select count(*) from team_week where league_season_id = ${s.id} and counts) counted,
        (select count(*) from team_week where league_season_id = ${s.id} and not counts) notcounted,
        (select count(*) from player_week pw join team_week tw on tw.id = pw.team_week_id where tw.league_season_id = ${s.id}) pw,
        (select count(*) from player_week pw join team_week tw on tw.id = pw.team_week_id where tw.league_season_id = ${s.id} and pw.nfl_team is null) nonfl,
        (select count(distinct pw.player_id) from player_week pw join team_week tw on tw.id = pw.team_week_id join player p on p.id = pw.player_id where tw.league_season_id = ${s.id} and p.full_name like 'Unknown player %') unk,
        (select count(*) from transaction where league_season_id = ${s.id} and status = 'complete') txc,
        (select count(*) from transaction where league_season_id = ${s.id} and status = 'failed') txf,
        (select count(*) from draft_pick dp join draft d on d.id = dp.draft_id where d.league_season_id = ${s.id}) picks,
        (select count(*) from team_season where league_season_id = ${s.id} and final_place is not null) placed,
        (select count(*) from team_week_stats st join team_week tw on tw.id = st.team_week_id where tw.league_season_id = ${s.id} and st.lineup_iq > 1.0001) iq`);
    const games = await one<{ game_type: string; n: string }>(
      sql`select game_type::text, count(*) n from matchup where league_season_id = ${s.id} group by 1 order by 1`
    );
    const [per] = await one<{ min: string | null; avg: string | null; max: string | null }>(sql`
      select min(c), avg(c), max(c) from (
        select count(*) c from player_week pw join team_week tw on tw.id = pw.team_week_id
        where tw.league_season_id = ${s.id} group by pw.team_week_id) x`);

    let recordCheck: SeasonReport["recordCheck"] = null;
    if (s.source === "sleeper" && s.status === "complete") {
      const raw = await store.latest("sleeper", "league/rosters", { id: s.externalId });
      const parsed = z.array(sleeperRoster).safeParse(raw?.payload);
      if (parsed.success) {
        const ours = await one<{ roster: string; w: string; l: string; t: string; pf: string }>(sql`
          select ts.external_roster_id roster,
                 count(*) filter (where gr.result = 'W') w, count(*) filter (where gr.result = 'L') l,
                 count(*) filter (where gr.result = 'T') t,
                 coalesce(sum(gr.points_for) filter (where gr.kind = 'h2h'), 0) pf
          from team_season ts
          left join game_result gr on gr.team_season_id = ts.id and gr.game_type = 'regular'
               and (gr.kind = 'h2h' or ${s.medianEnabled})
          where ts.league_season_id = ${s.id} group by 1`);
        const mismatches: string[] = [];
        for (const r of parsed.data) {
          const mine = ours.find((o) => o.roster === String(r.roster_id));
          if (!mine) continue;
          const pf = (r.settings.fpts ?? 0) + (r.settings.fpts_decimal ?? 0) / 100;
          const theirs = {
            w: r.settings.wins ?? 0,
            l: r.settings.losses ?? 0,
            t: r.settings.ties ?? 0,
          };
          if (
            Number(mine.w) !== theirs.w ||
            Number(mine.l) !== theirs.l ||
            Number(mine.t) !== theirs.t ||
            Math.abs(Number(mine.pf) - pf) > 0.05
          ) {
            mismatches.push(
              `roster ${r.roster_id}: ours ${mine.w}-${mine.l}-${mine.t} / ${Number(mine.pf).toFixed(2)} PF, Sleeper ${theirs.w}-${theirs.l}-${theirs.t} / ${pf.toFixed(2)} PF`
            );
          }
        }
        recordCheck = { teams: parsed.data.length, mismatches };
      }
    }

    out.push({
      league: l.slug,
      year: s.year,
      source: s.source,
      status: s.status,
      teams: Number(counts?.teams),
      weeks: { total: Number(counts?.weeks), complete: Number(counts?.complete) },
      gamesByType: Object.fromEntries(games.map((g) => [g.game_type, Number(g.n)])),
      teamWeeks: { counted: Number(counts?.counted), notCounted: Number(counts?.notcounted) },
      playersPerTeamWeek:
        per?.min == null
          ? null
          : {
              min: Number(per.min),
              avg: Math.round(Number(per.avg) * 10) / 10,
              max: Number(per.max),
            },
      playerWeeks: Number(counts?.pw),
      playerWeeksWithoutNfl: Number(counts?.nonfl),
      unmatchedPlayers: Number(counts?.unk),
      transactions: { complete: Number(counts?.txc), failed: Number(counts?.txf) },
      draftPicks: Number(counts?.picks),
      placementsSet: Number(counts?.placed),
      recordCheck,
      lineupIqAboveOne: Number(counts?.iq),
    });
  }
  return out;
}

export function formatReport(rows: SeasonReport[]): string {
  const lines: string[] = [];
  for (const r of rows) {
    lines.push(`${r.league} ${r.year} [${r.source}, ${r.status}]`);
    lines.push(
      `  teams ${r.teams}; weeks ${r.weeks.complete}/${r.weeks.total} complete; placements set ${r.placementsSet}/${r.teams}`
    );
    lines.push(
      `  games by type: ${
        Object.entries(r.gamesByType)
          .map(([k, v]) => `${k} ${v}`)
          .join(", ") || "none"
      }`
    );
    lines.push(
      `  team-weeks: ${r.teamWeeks.counted} counted, ${r.teamWeeks.notCounted} not counted`
    );
    lines.push(
      r.playersPerTeamWeek
        ? `  players per team-week: min ${r.playersPerTeamWeek.min} / avg ${r.playersPerTeamWeek.avg} / max ${r.playersPerTeamWeek.max} (${r.playerWeeks} rows; ${r.playerWeeksWithoutNfl} without NFL team)`
        : "  players per team-week: no player data"
    );
    lines.push(
      `  unmatched players: ${r.unmatchedPlayers}; transactions ${r.transactions.complete} complete / ${r.transactions.failed} failed; draft picks ${r.draftPicks}`
    );
    if (r.lineupIqAboveOne)
      lines.push(`  WARNING: ${r.lineupIqAboveOne} team-weeks with lineup IQ > 100%`);
    if (r.recordCheck) {
      lines.push(
        r.recordCheck.mismatches.length === 0
          ? `  record check vs Sleeper: all ${r.recordCheck.teams} teams match (W-L-T and PF)`
          : `  record check vs Sleeper: ${r.recordCheck.mismatches.length}/${r.recordCheck.teams} differ:\n    ${r.recordCheck.mismatches.join("\n    ")}`
      );
    }
  }
  return lines.join("\n");
}
