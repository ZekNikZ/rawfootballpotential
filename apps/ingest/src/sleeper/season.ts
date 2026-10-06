import { leagueSeason, leagueSeasonWeek, nflState, type Db } from "@rfp/db";
import { and, eq, sql } from "@rfp/db";
import type { SleeperBracketGame, SleeperLeague, SleeperNflState } from "./schemas";

type SeasonStatus = (typeof leagueSeason.$inferSelect)["status"];
type WeekStatus = (typeof leagueSeasonWeek.$inferSelect)["status"];

/** The NFL clock from /state/nfl. */
export interface Clock {
  season: number;
  week: number;
  seasonType: string;
}

/** Rounds in a single-elimination bracket for `teams` playoff teams (byes are rounds too). */
export const playoffRounds = (teams: number): number =>
  Math.max(1, Math.ceil(Math.log2(Math.max(2, teams))));

export function lastWeekOf(
  league: SleeperLeague,
  winners: readonly SleeperBracketGame[] | null
): number {
  const start = league.settings.playoff_week_start;
  const bracketRounds = winners && winners.length > 0 ? Math.max(...winners.map((g) => g.r)) : 0;
  return start + Math.max(bracketRounds, playoffRounds(league.settings.playoff_teams)) - 1;
}

export function mapSeasonStatus(
  league: SleeperLeague,
  regularSeasonWeeks: number,
  currentWeek: number | null
): SeasonStatus {
  switch (league.status) {
    case "pre_draft":
      return "pre_draft";
    case "drafting":
      return "drafting";
    case "complete":
      return "complete";
    default:
      return currentWeek !== null && currentWeek > regularSeasonWeeks ? "post_season" : "in_season";
  }
}

/**
 * Status of each fantasy week (Sleeper's fantasy week = NFL week). A week is complete once /state/nfl has moved
 * past it; an archived or earlier season is entirely complete.
 */
export function weekStatuses(
  year: number,
  lastWeek: number,
  leagueStatus: string,
  state: Clock | null
): Map<number, WeekStatus> {
  const out = new Map<number, WeekStatus>();
  const all = (s: WeekStatus) => {
    for (let w = 1; w <= lastWeek; w++) out.set(w, s);
    return out;
  };
  if (leagueStatus === "complete") return all("complete");
  if (!state) return all("upcoming");
  const stateSeason = state.season;
  if (year < stateSeason) return all("complete");
  if (year > stateSeason) return all("upcoming");
  if (state.seasonType === "pre") return all("upcoming");
  if (state.seasonType === "off") return all("complete");
  for (let w = 1; w <= lastWeek; w++)
    out.set(w, w < state.week ? "complete" : w === state.week ? "in_progress" : "upcoming");
  return out;
}

export async function saveNflState(db: Db, state: SleeperNflState): Promise<void> {
  const row = {
    season: Number(state.season),
    week: state.week,
    seasonType: state.season_type,
    displayWeek: state.display_week ?? null,
    leagueSeason: state.league_season ?? null,
    raw: state as unknown as Record<string, unknown>,
    updatedAt: new Date(),
  };
  await db.insert(nflState).values(row).onConflictDoUpdate({ target: nflState.season, set: row });
}

export async function currentNflState(db: Db) {
  const [row] = await db
    .select()
    .from(nflState)
    .orderBy(sql`${nflState.season} desc`)
    .limit(1);
  return row ?? null;
}

export interface UpsertSeasonInput {
  leagueId: number;
  externalId: string;
  league: SleeperLeague;
  winners: readonly SleeperBracketGame[] | null;
  losers: readonly SleeperBracketGame[] | null;
  state: Clock | null;
}

/** Create or update a league_season from Sleeper's league payload. Admin-locked `has_*` flags are preserved. */
export async function upsertSleeperLeagueSeason(db: Db, input: UpsertSeasonInput): Promise<number> {
  const { league, winners, losers } = input;
  const s = league.settings;
  const regularSeasonWeeks = s.playoff_week_start - 1;
  const lastWeek = lastWeekOf(league, winners);
  const year = Number(league.season);
  const weeks = weekStatuses(year, lastWeek, league.status, input.state);
  const currentWeek = input.state && input.state.season === year ? input.state.week : null;
  const rosterSlots = league.roster_positions.filter((p) => p !== "BN");
  const faab = s.waiver_type === 2;
  const values = {
    leagueId: input.leagueId,
    year,
    source: "sleeper" as const,
    externalId: input.externalId,
    previousExternalId:
      league.previous_league_id && league.previous_league_id !== "0"
        ? league.previous_league_id
        : null,
    status: mapSeasonStatus(league, regularSeasonWeeks, currentWeek),
    regularSeasonWeeks,
    playoffWeekStart: s.playoff_week_start,
    lastWeek,
    playoffTeams: s.playoff_teams,
    teamCount: league.total_rosters,
    medianEnabled: s.league_average_match === 1,
    hasLosersBracket: (losers?.length ?? 0) > 0,
    rosterSlots,
    benchSlots: league.roster_positions.length - rosterSlots.length,
    irSlots: s.reserve_slots ?? 0,
    taxiSlots: s.taxi_slots ?? 0,
    scoringSettings: league.scoring_settings,
    settings: league as unknown as Record<string, unknown>,
    waiverType: faab ? ("faab" as const) : ("normal" as const),
    faabBudget: faab ? (s.waiver_budget ?? null) : null,
    hasPlayerData: true,
    hasTransactions: true,
    hasFaab: faab,
  };

  const [existing] = await db
    .select({ id: leagueSeason.id, locked: leagueSeason.lockedFlags })
    .from(leagueSeason)
    .where(and(eq(leagueSeason.source, "sleeper"), eq(leagueSeason.externalId, input.externalId)));

  let id: number;
  if (existing) {
    // The settings blob is large; only keep it fresh, never let it clobber admin-locked flags.
    const set: Record<string, unknown> = { ...values };
    delete set.leagueId;
    for (const flag of existing.locked)
      delete set[flag.replace(/_([a-z])/g, (_, c: string) => c.toUpperCase())];
    await db.update(leagueSeason).set(set).where(eq(leagueSeason.id, existing.id));
    id = existing.id;
  } else {
    const [row] = await db.insert(leagueSeason).values(values).returning({ id: leagueSeason.id });
    id = row!.id;
  }

  for (const [week, status] of weeks) {
    const gameTypeDefault =
      week >= s.playoff_week_start ? ("playoffs" as const) : ("regular" as const);
    await db
      .insert(leagueSeasonWeek)
      .values({
        leagueSeasonId: id,
        week,
        status,
        gameTypeDefault,
        finalizedAt: status === "complete" ? new Date() : null,
      })
      .onConflictDoUpdate({
        target: [leagueSeasonWeek.leagueSeasonId, leagueSeasonWeek.week],
        set: {
          status,
          gameTypeDefault,
          // keep the first finalization time; clear it if a week reopens
          finalizedAt:
            status === "complete" ? sql`coalesce(${leagueSeasonWeek.finalizedAt}, now())` : null,
        },
      });
  }
  // Drop week rows beyond the (possibly corrected) last week.
  await db
    .delete(leagueSeasonWeek)
    .where(
      and(eq(leagueSeasonWeek.leagueSeasonId, id), sql`${leagueSeasonWeek.week} > ${lastWeek}`)
    );
  const lastComplete = Math.max(
    0,
    ...[...weeks].filter(([, st]) => st === "complete").map(([w]) => w)
  );
  await db
    .update(leagueSeason)
    .set({ lastCompletedWeek: lastComplete })
    .where(eq(leagueSeason.id, id));
  return id;
}
