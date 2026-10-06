import {
  league as leagueTable,
  leagueSeason,
  leagueSeasonWeek,
  rosterCurrent,
  teamSeason,
  type Db,
} from "@rfp/db";
import { and, eq, inArray, max } from "@rfp/db";
import { FOREVER, hours, minutes, type FreshnessPolicy } from "../lib/raw-store";
import { log } from "../lib/log";
import type { SleeperClient } from "./client";
import { syncDrafts, syncTradedPicks } from "./drafts";
import { syncGames } from "./games";
import { PlayerResolver } from "./players";
import { overridesForWeek, rescoreEntries } from "./rescore";
import { loadProjections } from "./projections";
import type {
  SleeperBracketGame,
  SleeperDraft,
  SleeperDraftPick,
  SleeperMatchupEntry,
  SleeperRoster,
  SleeperTransaction,
} from "./schemas";
import { currentNflState, saveNflState, upsertSleeperLeagueSeason, type Clock } from "./season";
import { syncTeams } from "./teams";
import { syncTransactions } from "./transactions";

export type SyncMode = "full" | "live" | "daily";

export interface SyncSeasonOptions {
  /** full: everything; live: the current week's scores only; daily: rosters, transactions, picks, draft, team info. */
  mode: SyncMode;
  /** Re-fetch even when a cached response exists. */
  force?: boolean;
}

export interface SyncSummary {
  leagueSeasonId: number;
  year: number;
  leagueSlug: string;
  weeks: number[];
  games: Record<string, number>;
  teamWeeks: number;
  playerWeeks: number;
  transactions: { total: number; failed: number };
  draftPicks: number;
  tradedPicks: number;
  placeholders: number;
  anomalies: string[];
}

const chunk = <T>(arr: readonly T[], size: number): T[][] => {
  const out: T[][] = [];
  for (let i = 0; i < arr.length; i += size) out.push(arr.slice(i, i + size));
  return out;
};

/** Raw -> canonical for one Sleeper league season. Every network response is cached in raw_payload. */
export async function syncSleeperSeason(
  db: Db,
  client: SleeperClient,
  leagueSeasonId: number,
  opts: SyncSeasonOptions
): Promise<SyncSummary> {
  const [row] = await db
    .select({ season: leagueSeason, league: leagueTable })
    .from(leagueSeason)
    .innerJoin(leagueTable, eq(leagueTable.id, leagueSeason.leagueId))
    .where(eq(leagueSeason.id, leagueSeasonId));
  if (!row) throw new Error(`league_season ${leagueSeasonId} not found`);
  if (row.season.source !== "sleeper")
    throw new Error(`league_season ${leagueSeasonId} is not a Sleeper season`);
  const ext = row.season.externalId;
  const log_ = log.child({ season: `${row.league.slug}-${row.season.year}` });

  // /state/nfl is the clock for "current week".
  const stateRes = await client.nflState(opts.force ? minutes(0) : minutes(5));
  if (stateRes) await saveNflState(db, stateRes);
  const state: Clock | null = stateRes
    ? { season: Number(stateRes.season), week: stateRes.week, seasonType: stateRes.season_type }
    : await currentNflState(db);
  const stateWeek = state && state.season === row.season.year ? state.week : null;

  // A season that was already complete is frozen: its responses are never re-fetched (unless forced).
  const frozen = row.season.status === "complete" && !opts.force;
  const staticPolicy: FreshnessPolicy = frozen
    ? FOREVER
    : opts.mode === "live"
      ? hours(6)
      : hours(1);
  const lg = await client.league(
    ext,
    frozen ? FOREVER : opts.mode === "live" ? minutes(30) : minutes(5)
  );
  if (!lg) throw new Error(`Sleeper league ${ext} not found`);
  const winners = await client.winnersBracket(ext, frozen ? FOREVER : minutes(30));
  const losers = await client.losersBracket(ext, frozen ? FOREVER : minutes(30));

  await upsertSleeperLeagueSeason(db, {
    leagueId: row.league.id,
    externalId: ext,
    league: lg,
    winners,
    losers,
    state,
  });
  const [season] = await db.select().from(leagueSeason).where(eq(leagueSeason.id, leagueSeasonId));
  if (!season) throw new Error("season vanished");
  const weekRows = await db
    .select()
    .from(leagueSeasonWeek)
    .where(eq(leagueSeasonWeek.leagueSeasonId, leagueSeasonId));
  const completeWeeks = new Set(weekRows.filter((w) => w.status === "complete").map((w) => w.week));

  const users = (await client.users(ext, staticPolicy)) ?? [];
  const rosters =
    (await client.rosters(
      ext,
      frozen ? FOREVER : opts.mode === "live" ? minutes(30) : minutes(5)
    )) ?? [];
  const teams = await syncTeams(db, {
    leagueSeasonId,
    leagueId: row.league.id,
    leagueType: row.league.type,
    year: season.year,
    league: lg,
    users,
    rosters,
    winners,
    frozen: row.season.status === "complete",
    currentWeek: stateWeek,
  });

  // Which weeks to (re)sync.
  const allWeeks = Array.from({ length: season.lastWeek }, (_, i) => i + 1);
  const reachable = allWeeks.filter(
    (w) =>
      w <= season.regularSeasonWeeks || stateWeek === null || w <= stateWeek || completeWeeks.has(w)
  );
  const weeks =
    opts.mode === "live"
      ? stateWeek !== null
        ? [Math.min(Math.max(stateWeek, 1), season.lastWeek)]
        : []
      : reachable;
  const weekPolicy = (w: number): FreshnessPolicy =>
    frozen
      ? FOREVER
      : w === stateWeek
        ? minutes(opts.mode === "live" ? 2 : 10)
        : completeWeeks.has(w)
          ? hours(12)
          : hours(3);

  const players = new PlayerResolver(db);
  const matchupWeeks = new Map<number, readonly SleeperMatchupEntry[]>();
  for (const w of weeks) {
    const entries = await client.matchups(ext, w, weekPolicy(w));
    if (entries) matchupWeeks.set(w, entries);
  }

  // As-played scoring: re-score from raw stats when the league changed its scoring after this season was played.
  if (season.scoringOverrides.length > 0) {
    for (const [w, entries] of matchupWeeks) {
      if (Object.keys(overridesForWeek(season.scoringOverrides, w)).length === 0) continue;
      const stats = await client.stats(season.year, w, frozen ? FOREVER : weekPolicy(w));
      if (stats)
        matchupWeeks.set(
          w,
          rescoreEntries(entries, w, stats, season.scoringSettings, season.scoringOverrides)
        );
    }
  }

  const projections = await loadProjections(db, client, {
    season: season.year,
    weeks: weeks,
    scoring: season.scoringSettings,
    legacyLeagueId: `L-${row.league.name}-${season.year}`,
    policy: frozen ? FOREVER : hours(6),
  });

  const summary: SyncSummary = {
    leagueSeasonId,
    year: season.year,
    leagueSlug: row.league.slug,
    weeks,
    games: {},
    teamWeeks: 0,
    playerWeeks: 0,
    transactions: { total: 0, failed: 0 },
    draftPicks: 0,
    tradedPicks: 0,
    placeholders: 0,
    anomalies: [],
  };

  if (matchupWeeks.size > 0) {
    const g = await syncGames(db, {
      leagueSeasonId,
      playoffWeekStart: season.playoffWeekStart,
      rosterSlots: season.rosterSlots,
      teamSeasonByRoster: teams.teamSeasonByRoster,
      weeks: matchupWeeks,
      winners: winners as readonly SleeperBracketGame[] | null,
      losers: losers as readonly SleeperBracketGame[] | null,
      completeWeeks,
      players,
      projections,
    });
    summary.games = g.gamesByType;
    summary.teamWeeks = g.teamWeeks;
    summary.playerWeeks = g.playerWeeks;
    summary.anomalies.push(...g.anomalies);
  }

  if (opts.mode !== "live") {
    const txByWeek = new Map<number, readonly SleeperTransaction[]>();
    const txWeeks = allWeeks.filter(
      (w) =>
        stateWeek === null ||
        w <= Math.max(stateWeek, season.regularSeasonWeeks) ||
        completeWeeks.has(w)
    );
    for (const w of txWeeks) {
      const t = await client.transactions(ext, w, weekPolicy(w));
      txByWeek.set(w, t ?? []);
    }
    const rosterByOwner = new Map(
      rosters.flatMap((r) => (r.owner_id ? [[r.owner_id, r.roster_id] as const] : []))
    );
    const tx = await syncTransactions(db, {
      leagueSeasonId,
      byWeek: txByWeek,
      teamSeasonByRoster: teams.teamSeasonByRoster,
      franchiseByRoster: teams.franchiseByRoster,
      rosterByOwner,
      players,
    });
    summary.transactions = { total: tx.total, failed: tx.failed };
    summary.anomalies.push(...tx.anomalies);

    const draftList = (await client.drafts(ext, staticPolicy)) ?? [];
    const drafts: { draft: SleeperDraft; picks: SleeperDraftPick[] }[] = [];
    for (const d of draftList) {
      const picks =
        (await client.draftPicks(
          d.draft_id,
          d.status === "complete" && frozen ? FOREVER : minutes(10)
        )) ?? [];
      drafts.push({ draft: d, picks });
    }
    const dr = await syncDrafts(db, {
      leagueSeasonId,
      leagueType: row.league.type,
      hasPreviousSeason: !!season.previousExternalId,
      drafts,
      rosters,
      teamSeasonByRoster: teams.teamSeasonByRoster,
      players,
    });
    summary.draftPicks = dr.picks;

    // Latest season of the league only: traded picks + current rosters.
    const [{ latest } = { latest: null }] = await db
      .select({ latest: max(leagueSeason.year) })
      .from(leagueSeason)
      .where(eq(leagueSeason.leagueId, row.league.id));
    if (latest === season.year) {
      if (row.league.type === "dynasty" || lg.settings.pick_trading === 1) {
        const picks = (await client.tradedPicks(ext, minutes(30))) ?? [];
        summary.tradedPicks = await syncTradedPicks(
          db,
          row.league.id,
          picks,
          teams.franchiseByRoster
        );
      }
      await syncRosterCurrent(db, teams.teamSeasonByRoster, rosters, season.rosterSlots, players);
    }

    // Data flags, unless an admin has locked them.
    const flags: Partial<typeof leagueSeason.$inferInsert> = {
      hasDraft: drafts.length > 0,
      hasAuctionDraft: dr.hasAuction,
      hasProjections: [...projections.values()].some((m) => m.size > 0),
    };
    for (const f of season.lockedFlags)
      delete (flags as Record<string, unknown>)[
        f.replace(/_([a-z])/g, (_, c: string) => c.toUpperCase())
      ];
    await db.update(leagueSeason).set(flags).where(eq(leagueSeason.id, leagueSeasonId));
  }

  summary.placeholders = players.placeholders.length;
  log_.info(
    { weeks: weeks.length, games: summary.games, tx: summary.transactions },
    "season synced"
  );
  return summary;
}

async function syncRosterCurrent(
  db: Db,
  teamSeasonByRoster: ReadonlyMap<number, number>,
  rosters: readonly SleeperRoster[],
  rosterSlots: readonly string[],
  players: PlayerResolver
): Promise<void> {
  await players.resolve(
    rosters.flatMap((r) => [...(r.players ?? []), ...(r.reserve ?? []), ...(r.taxi ?? [])])
  );
  const teamIds = [...teamSeasonByRoster.values()];
  if (teamIds.length === 0) return;
  await db.delete(rosterCurrent).where(inArray(rosterCurrent.teamSeasonId, teamIds));
  const rows: (typeof rosterCurrent.$inferInsert)[] = [];
  for (const r of rosters) {
    const teamSeasonId = teamSeasonByRoster.get(r.roster_id);
    if (teamSeasonId === undefined) continue;
    const slotOf = new Map<string, string>();
    (r.starters ?? []).forEach((pid, i) => {
      if (pid !== "0") slotOf.set(pid, rosterSlots[i] ?? "FLEX");
    });
    const reserve = new Set(r.reserve ?? []);
    const taxi = new Set(r.taxi ?? []);
    for (const pid of new Set([...(r.players ?? []), ...reserve, ...taxi])) {
      if (pid === "0") continue;
      const slot = slotOf.get(pid);
      rows.push({
        teamSeasonId,
        playerId: players.get(pid),
        slot: slot ?? (reserve.has(pid) ? "IR" : taxi.has(pid) ? "TAXI" : "BN"),
        slotKind: slot ? "starter" : reserve.has(pid) ? "ir" : taxi.has(pid) ? "taxi" : "bench",
      });
    }
  }
  for (const b of chunk(rows, 2000)) if (b.length) await db.insert(rosterCurrent).values(b);
}

/** Convenience: all Sleeper league seasons in the database. */
export async function sleeperSeasonIds(db: Db, slug?: string): Promise<number[]> {
  const rows = await db
    .select({ id: leagueSeason.id, year: leagueSeason.year, slug: leagueTable.slug })
    .from(leagueSeason)
    .innerJoin(leagueTable, eq(leagueTable.id, leagueSeason.leagueId))
    .where(and(eq(leagueSeason.source, "sleeper"), eq(leagueSeason.enabled, true)));
  return rows
    .filter((r) => !slug || r.slug === slug)
    .sort((a, b) => a.year - b.year)
    .map((r) => r.id);
}

void teamSeason;

/** Create (or refresh) the league_season row for a Sleeper league id; used by migrate:mongo and season rollover. */
export async function bootstrapSleeperSeason(
  db: Db,
  client: SleeperClient,
  input: { leagueId: number; externalId: string }
): Promise<number> {
  const lg = await client.league(input.externalId, hours(1));
  if (!lg) throw new Error(`Sleeper league ${input.externalId} not found`);
  const winners = await client.winnersBracket(input.externalId, hours(1));
  const losers = await client.losersBracket(input.externalId, hours(1));
  const stateRes = await client.nflState(minutes(5));
  if (stateRes) await saveNflState(db, stateRes);
  const state: Clock | null = stateRes
    ? { season: Number(stateRes.season), week: stateRes.week, seasonType: stateRes.season_type }
    : await currentNflState(db);
  return upsertSleeperLeagueSeason(db, {
    leagueId: input.leagueId,
    externalId: input.externalId,
    league: lg,
    winners,
    losers,
    state,
  });
}
