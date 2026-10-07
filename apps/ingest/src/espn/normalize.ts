import {
  draft,
  draftPick,
  league as leagueTable,
  leagueSeason,
  leagueSeasonWeek,
  managerIdentity,
  matchup,
  player,
  playerWeek,
  rawPayload,
  teamSeason,
  teamSeasonManager,
  teamWeek,
  transaction,
  transactionItem,
  unmatchedPlayer,
  and,
  desc,
  eq,
  inArray,
  like,
  sql,
  type Db,
} from "@rfp/db";
import { round3 } from "@rfp/core";
import { log } from "../lib/log";
import { deriveSeason, type DeriveSummary } from "../derive/derive";
import {
  BENCH_SLOT,
  IR_SLOT,
  PRO_TEAMS,
  SLOT_NAMES,
  parseEspnBundle,
  type BundleResponse,
  type EspnGame,
  type EspnSeason,
} from "./parse";

const chunk = <T>(arr: readonly T[], size: number): T[][] => {
  const out: T[][] = [];
  for (let i = 0; i < arr.length; i += size) out.push(arr.slice(i, i + size));
  return out;
};

export interface EspnImportSummary {
  leagueSeasonId: number;
  year: number;
  bundle: string | null;
  teams: number;
  games: Record<string, number>;
  teamWeeks: number;
  playerWeeks: number;
  transactions: { total: number; failed: number; byKind: Record<string, number> };
  draftPicks: number;
  players: { matched: number; created: number };
  /** Unmatched players now in the admin queue (they were created as players with their ESPN id and name). */
  unmatchedPlayers: { espnId: string; name: string }[];
  /** Weeks where the schedule's score and the sum of the starters' points disagree by more than a hair. */
  scoreMismatches: string[];
  /** Teams whose final place after derive differs from ESPN's own final rank. */
  placementMismatches: string[];
  anomalies: string[];
  derive?: DeriveSummary;
}

/** The newest ESPN bundle stored for this season (the admin import archives bundles in raw_payload). */
export async function loadLatestEspnBundle(
  db: Db,
  slug: string,
  year: number
): Promise<{ name: string; responses: BundleResponse[] } | null> {
  const [latest] = await db
    .select({ bundle: rawPayload.bundle })
    .from(rawPayload)
    .where(and(eq(rawPayload.source, "espn"), like(rawPayload.bundle, `${slug}-${year}-%`)))
    .orderBy(desc(rawPayload.id))
    .limit(1);
  if (!latest?.bundle) return null;
  const rows = await db
    .select({
      endpoint: rawPayload.endpoint,
      params: rawPayload.params,
      status: rawPayload.httpStatus,
      payload: rawPayload.payload,
    })
    .from(rawPayload)
    .where(and(eq(rawPayload.source, "espn"), eq(rawPayload.bundle, latest.bundle)))
    .orderBy(rawPayload.id);
  return {
    name: latest.bundle,
    responses: rows.map((r) => ({
      endpoint: r.endpoint,
      params: (r.params ?? {}) as Record<string, unknown>,
      status: r.status ?? 200,
      payload: r.payload,
    })),
  };
}

const norm = (s: string) => s.trim().toLowerCase().replace(/\s+/g, " ");

/**
 * Game types and brackets from ESPN's playoff tiers. The winners bracket and its consolation ladder are playoff
 * games (as on Sleeper, where the winners bracket holds the consolation games of teams out in round one); the
 * losers ladder is the toilet bowl. The place a last-week game decides comes from ESPN's own final ranks: the winners
 * side decides place min(rank), the toilet-bowl side place N + 1 - max(rank) (it is played for last place).
 */
export function classifyEspnGame(
  game: EspnGame,
  season: Pick<EspnSeason, "settings" | "teams">
): {
  gameType: "regular" | "playoffs" | "toilet_bowl" | "none";
  bracket: "winners" | "losers" | null;
  bracketRound: number | null;
  placementAtStake: number | null;
  isChampionship: boolean;
} {
  const s = season.settings;
  if (game.tier === "NONE") {
    return {
      gameType: game.week <= s.regularSeasonWeeks ? "regular" : "none",
      bracket: null,
      bracketRound: null,
      placementAtStake: null,
      isChampionship: false,
    };
  }
  const losers = game.tier === "LOSERS_CONSOLATION_LADDER";
  const rank = (teamId: number) => season.teams.find((t) => t.id === teamId)?.rankFinal ?? null;
  const ranks = game.sides.map((x) => rank(x.teamId)).filter((r): r is number => r !== null);
  let placementAtStake: number | null = null;
  if (game.week === s.lastWeek && game.sides.length === 2 && ranks.length === 2) {
    const [lo, hi] = [Math.min(...ranks), Math.max(...ranks)];
    if (hi - lo === 1) placementAtStake = losers ? s.teamCount + 1 - hi : lo;
  }
  return {
    gameType: losers ? "toilet_bowl" : "playoffs",
    bracket: losers ? "losers" : "winners",
    bracketRound: game.week - s.playoffWeekStart + 1,
    placementAtStake,
    isChampionship: game.tier === "WINNERS_BRACKET" && placementAtStake === 1,
  };
}

/**
 * Raw ESPN bundle -> canonical tables for one ESPN league season, in place: the season's rows (made by the Mongo
 * migration) keep their ids, so corrections, trophies and franchise links survive. Idempotent.
 */
export async function normalizeEspnSeason(
  db: Db,
  leagueSeasonId: number,
  responses: BundleResponse[],
  bundleName: string | null = null
): Promise<EspnImportSummary> {
  const [row] = await db
    .select({ season: leagueSeason, league: leagueTable })
    .from(leagueSeason)
    .innerJoin(leagueTable, eq(leagueTable.id, leagueSeason.leagueId))
    .where(eq(leagueSeason.id, leagueSeasonId));
  if (!row) throw new Error(`league_season ${leagueSeasonId} not found`);
  if (row.season.source !== "espn")
    throw new Error(`league_season ${leagueSeasonId} is not an ESPN season`);
  const year = row.season.year;
  const settingsRes = responses.find((r) => r.endpoint === "mSettings");
  const espnLeagueId = String(
    (settingsRes?.payload as { id?: number } | null)?.id ?? row.season.externalId
  );
  const data = parseEspnBundle(year, espnLeagueId, responses);
  const s = data.settings;
  const summary: EspnImportSummary = {
    leagueSeasonId,
    year,
    bundle: bundleName,
    teams: data.teams.length,
    games: {},
    teamWeeks: 0,
    playerWeeks: 0,
    transactions: { total: 0, failed: 0, byKind: {} },
    draftPicks: 0,
    players: { matched: 0, created: 0 },
    unmatchedPlayers: [],
    scoreMismatches: [],
    placementMismatches: [],
    anomalies: [...data.anomalies],
  };

  // ---- teams: ESPN team id -> the season's team_season, matched by team name ------------------------------------
  const existing = await db
    .select()
    .from(teamSeason)
    .where(eq(teamSeason.leagueSeasonId, leagueSeasonId));
  const byName = new Map<string, typeof existing>();
  for (const t of existing) byName.set(norm(t.name), [...(byName.get(norm(t.name)) ?? []), t]);
  const teamSeasonByEspn = new Map<number, number>();
  const unmatchedTeams: string[] = [];
  for (const t of data.teams) {
    let found = byName.get(norm(t.name)) ?? [];
    // Fall back to the configured final place when the name was changed after the season.
    if (found.length !== 1 && t.rankFinal !== null) {
      const byPlace = existing.filter((e) => e.finalPlace === t.rankFinal);
      if (byPlace.length === 1) found = byPlace;
    }
    if (found.length !== 1) unmatchedTeams.push(`${t.id} "${t.name}"`);
    else teamSeasonByEspn.set(t.id, found[0]!.id);
  }
  if (unmatchedTeams.length)
    throw new Error(
      `Could not match ESPN teams to this season's teams: ${unmatchedTeams.join(", ")}. ` +
        `Existing: ${existing.map((e) => `"${e.name}"`).join(", ")}`
    );
  const used = new Set(teamSeasonByEspn.values());
  if (used.size !== data.teams.length) throw new Error("two ESPN teams matched the same team");
  const tsOf = (espnId: number | null | undefined): number | null =>
    espnId === null || espnId === undefined ? null : (teamSeasonByEspn.get(espnId) ?? null);

  // ---- the season itself ------------------------------------------------------------------------------------------
  const flags = {
    hasPlayerData: data.rosters.size > 0,
    hasProjections: [...data.rosters.values()].flat().some((e) => e.projected !== null),
    hasTransactions: data.transactions.length > 0,
    hasDraft: data.draft !== null,
    hasFaab: s.hasFaab,
    hasAuctionDraft: data.draft?.type === "auction",
  };
  const lockedFlags = new Set(row.season.lockedFlags);
  await db
    .update(leagueSeason)
    .set({
      externalId: espnLeagueId,
      regularSeasonWeeks: s.regularSeasonWeeks,
      playoffWeekStart: s.playoffWeekStart,
      lastWeek: s.lastWeek,
      lastCompletedWeek: s.lastWeek,
      playoffTeams: s.playoffTeams,
      teamCount: s.teamCount || data.teams.length,
      hasLosersBracket: data.games.some((g) => g.tier === "LOSERS_CONSOLATION_LADDER"),
      rosterSlots: s.rosterSlots,
      benchSlots: s.benchSlots,
      irSlots: s.irSlots,
      faabBudget: s.faabBudget,
      settings: { ...row.season.settings, espn: { scoringItems: s.scoringItems } },
      ...Object.fromEntries(Object.entries(flags).filter(([k]) => !lockedFlags.has(k))),
    })
    .where(eq(leagueSeason.id, leagueSeasonId));
  await db.delete(leagueSeasonWeek).where(eq(leagueSeasonWeek.leagueSeasonId, leagueSeasonId));
  await db.insert(leagueSeasonWeek).values(
    Array.from({ length: s.lastWeek }, (_, i) => ({
      leagueSeasonId,
      week: i + 1,
      status: "complete" as const,
      gameTypeDefault: i + 1 >= s.playoffWeekStart ? ("playoffs" as const) : ("regular" as const),
      finalizedAt: new Date(),
    }))
  );

  // ---- players -----------------------------------------------------------------------------------------------------
  const espnIds = new Set<number>(data.players.keys());
  for (const e of data.rosters.values()) for (const x of e) espnIds.add(x.playerId);
  for (const t of data.transactions) for (const i of t.items) espnIds.add(i.playerId);
  for (const p of data.draft?.picks ?? []) espnIds.add(p.playerId);
  const playerByEspn = new Map<number, number>();
  const defTeams = new Map<number, string>(); // ESPN D/ST id -> NFL abbreviation
  for (const id of espnIds) if (id < 0) defTeams.set(id, PRO_TEAMS[-id - 16000] ?? "");
  for (const batch of chunk(
    [...espnIds].filter((id) => id > 0),
    1000
  )) {
    const rows = await db
      .select({ id: player.id, espn: player.espnId })
      .from(player)
      .where(inArray(player.espnId, batch.map(String)));
    for (const r of rows) if (r.espn) playerByEspn.set(Number(r.espn), r.id);
  }
  const abbrs = [...defTeams.values()].filter(Boolean);
  if (abbrs.length) {
    const rows = await db
      .select({ id: player.id, sleeper: player.sleeperId })
      .from(player)
      .where(and(inArray(player.sleeperId, abbrs), eq(player.position, "DEF")));
    const bySleeper = new Map(rows.map((r) => [r.sleeper, r.id]));
    for (const [espn, abbr] of defTeams) {
      const id = bySleeper.get(abbr);
      if (id !== undefined) playerByEspn.set(espn, id);
    }
  }
  summary.players.matched = playerByEspn.size;
  const missing = [...espnIds].filter((id) => !playerByEspn.has(id));
  for (const batch of chunk(missing, 500)) {
    const created = await db
      .insert(player)
      .values(
        batch.map((id) => {
          const info = data.players.get(id);
          return {
            espnId: String(id),
            fullName: info?.name ?? `ESPN player ${id}`,
            position: info?.position ?? null,
            nflTeam: info?.proTeamId ? (PRO_TEAMS[info.proTeamId] ?? null) : null,
          };
        })
      )
      .returning({ id: player.id, espn: player.espnId, name: player.fullName });
    for (const c of created) if (c.espn) playerByEspn.set(Number(c.espn), c.id);
    await db
      .insert(unmatchedPlayer)
      .values(
        created.map((c) => ({
          source: "espn" as const,
          externalId: c.espn!,
          name: c.name,
          position: data.players.get(Number(c.espn))?.position ?? null,
          nflTeam: null,
          context: { leagueSeasonId, year },
          resolvedPlayerId: c.id,
        }))
      )
      .onConflictDoNothing();
    summary.unmatchedPlayers.push(...created.map((c) => ({ espnId: c.espn!, name: c.name })));
  }
  summary.players.created = missing.length;
  const pid = (espnId: number): number => {
    const id = playerByEspn.get(espnId);
    if (id === undefined) throw new Error(`ESPN player ${espnId} was not resolved`);
    return id;
  };

  // ---- games: matchups (with brackets), then one team_week per team and week -----------------------------------
  const twoSided = data.games.filter((g) => g.sides.length === 2);
  const matchupRows: (typeof matchup.$inferInsert)[] = [];
  const gameKey = new Map<EspnGame, { week: number; ext: number }>();
  const perWeek = new Map<number, number>();
  for (const g of twoSided) {
    const ext = (perWeek.get(g.week) ?? 0) + 1;
    perWeek.set(g.week, ext);
    gameKey.set(g, { week: g.week, ext });
    const c = classifyEspnGame(g, data);
    summary.games[c.gameType] = (summary.games[c.gameType] ?? 0) + 1;
    matchupRows.push({
      leagueSeasonId,
      week: g.week,
      externalMatchupId: ext,
      gameType: c.gameType,
      bracket: c.bracket,
      bracketRound: c.bracketRound,
      placementAtStake: c.placementAtStake,
      isChampionship: c.isChampionship,
    });
  }
  const matchupIds = new Map<string, number>();
  for (const batch of chunk(matchupRows, 500)) {
    const rows = await db
      .insert(matchup)
      .values(batch)
      .onConflictDoUpdate({
        target: [matchup.leagueSeasonId, matchup.week, matchup.externalMatchupId],
        set: {
          gameType: sql`excluded.game_type`,
          bracket: sql`excluded.bracket`,
          bracketRound: sql`excluded.bracket_round`,
          placementAtStake: sql`excluded.placement_at_stake`,
          isChampionship: sql`excluded.is_championship`,
        },
      })
      .returning({ id: matchup.id, week: matchup.week, ext: matchup.externalMatchupId });
    for (const m of rows) matchupIds.set(`${m.week}:${m.ext}`, m.id);
  }
  const keep = new Set(matchupIds.values());
  const stale = (
    await db
      .select({ id: matchup.id })
      .from(matchup)
      .where(eq(matchup.leagueSeasonId, leagueSeasonId))
  )
    .map((m) => m.id)
    .filter((id) => !keep.has(id));
  for (const batch of chunk(stale, 500)) await db.delete(matchup).where(inArray(matchup.id, batch));

  const gameOf = new Map<string, { matchupId: number; opponent: number; type: string }>();
  for (const g of twoSided) {
    const k = gameKey.get(g)!;
    const matchupId = matchupIds.get(`${k.week}:${k.ext}`)!;
    const type = classifyEspnGame(g, data).gameType;
    const [a, b] = g.sides as [EspnGame["sides"][number], EspnGame["sides"][number]];
    gameOf.set(`${a.teamId}:${g.week}`, { matchupId, opponent: b.teamId, type });
    gameOf.set(`${b.teamId}:${g.week}`, { matchupId, opponent: a.teamId, type });
  }
  const starterTotal = (teamId: number, week: number): number | null => {
    const entries = data.rosters.get(`${teamId}:${week}`);
    if (!entries?.length) return null;
    return entries
      .filter((e) => e.slotId !== BENCH_SLOT && e.slotId !== IR_SLOT)
      .reduce((sum, e) => sum + (e.actual ?? 0), 0);
  };
  const twRows: (typeof teamWeek.$inferInsert)[] = [];
  for (let week = 1; week <= s.lastWeek; week++) {
    for (const t of data.teams) {
      const teamSeasonId = teamSeasonByEspn.get(t.id)!;
      const game = gameOf.get(`${t.id}:${week}`);
      const fromRoster = starterTotal(t.id, week);
      const scheduled = data.weekScores.get(`${t.id}:${week}`) ?? null;
      const points = scheduled ?? fromRoster;
      if (points === null) {
        summary.anomalies.push(`week ${week}: no score for "${t.name}"`);
        continue;
      }
      if (scheduled !== null && fromRoster !== null && Math.abs(scheduled - fromRoster) > 0.05)
        summary.scoreMismatches.push(
          `${year} wk ${week} "${t.name}": schedule ${scheduled}, starters ${round3(fromRoster)}`
        );
      twRows.push({
        leagueSeasonId,
        teamSeasonId,
        week,
        matchupId: game?.matchupId ?? null,
        opponentTeamSeasonId: game ? (tsOf(game.opponent) ?? null) : null,
        counts: game !== undefined && game.type !== "none",
        points: round3(points),
        pointsOverridden: false,
        isFinal: true,
      });
    }
  }
  const teamWeekIds = new Map<string, number>();
  for (const batch of chunk(twRows, 500)) {
    const rows = await db
      .insert(teamWeek)
      .values(batch)
      .onConflictDoUpdate({
        target: [teamWeek.teamSeasonId, teamWeek.week],
        set: {
          matchupId: sql`excluded.matchup_id`,
          opponentTeamSeasonId: sql`excluded.opponent_team_season_id`,
          counts: sql`excluded.counts`,
          points: sql`excluded.points`,
          pointsOverridden: sql`excluded.points_overridden`,
          isFinal: sql`excluded.is_final`,
          result: sql`null`,
          margin: sql`null`,
        },
      })
      .returning({ id: teamWeek.id, ts: teamWeek.teamSeasonId, week: teamWeek.week });
    for (const r of rows) teamWeekIds.set(`${r.ts}:${r.week}`, r.id);
  }
  summary.teamWeeks = twRows.length;

  // ---- lineups ------------------------------------------------------------------------------------------------------
  const twIds = [...teamWeekIds.values()];
  for (const batch of chunk(twIds, 1000))
    await db.delete(playerWeek).where(inArray(playerWeek.teamWeekId, batch));
  const pwRows: (typeof playerWeek.$inferInsert)[] = [];
  for (const [key, entries] of data.rosters) {
    const [espnTeam, week] = key.split(":").map(Number) as [number, number];
    const teamSeasonId = teamSeasonByEspn.get(espnTeam);
    const teamWeekId =
      teamSeasonId === undefined ? undefined : teamWeekIds.get(`${teamSeasonId}:${week}`);
    if (teamWeekId === undefined) continue;
    for (const e of entries) {
      const kind = e.slotId === BENCH_SLOT ? "bench" : e.slotId === IR_SLOT ? "ir" : "starter";
      pwRows.push({
        teamWeekId,
        playerId: pid(e.playerId),
        slot: SLOT_NAMES[e.slotId] ?? (kind === "starter" ? "FLEX" : "BN"),
        slotKind: kind,
        points: e.actual,
        projectedPoints: e.projected,
        position: e.position,
        eligiblePositions: e.position ? [e.position] : [],
      });
    }
  }
  for (const batch of chunk(pwRows, 2000))
    await db.insert(playerWeek).values(batch).onConflictDoNothing();
  summary.playerWeeks = pwRows.length;

  // ---- transactions -------------------------------------------------------------------------------------------------
  await db.delete(transaction).where(eq(transaction.leagueSeasonId, leagueSeasonId));
  for (const batch of chunk(data.transactions, 400)) {
    const inserted = await db
      .insert(transaction)
      .values(
        batch.map((t) => ({
          leagueSeasonId,
          externalId: t.id,
          type: t.kind,
          status: t.complete ? ("complete" as const) : ("failed" as const),
          failureReason: t.complete ? null : t.reason,
          week: t.week,
          executedAt: t.at ? new Date(t.at) : null,
          creatorTeamSeasonId: tsOf(t.teamId),
        }))
      )
      .returning({ id: transaction.id, ext: transaction.externalId });
    const idByExt = new Map(inserted.map((r) => [r.ext, r.id]));
    const items: (typeof transactionItem.$inferInsert)[] = [];
    for (const t of batch) {
      const transactionId = idByExt.get(t.id);
      if (transactionId === undefined) continue;
      for (const i of t.items) {
        if (t.kind === "trade") {
          if (i.type !== "TRADE") continue;
          items.push({
            transactionId,
            kind: "player",
            direction: "move",
            playerId: pid(i.playerId),
            fromTeamSeasonId: tsOf(i.fromTeamId),
            toTeamSeasonId: tsOf(i.toTeamId),
          });
        } else if (i.type === "ADD") {
          items.push({
            transactionId,
            kind: "player",
            direction: "add",
            playerId: pid(i.playerId),
            toTeamSeasonId: tsOf(i.toTeamId),
            faabBid: t.kind === "waiver" ? t.bid : null,
          });
        } else if (i.type === "DROP") {
          items.push({
            transactionId,
            kind: "player",
            direction: "drop",
            playerId: pid(i.playerId),
            fromTeamSeasonId: tsOf(i.fromTeamId),
          });
        }
      }
    }
    for (const b of chunk(items, 2000)) if (b.length) await db.insert(transactionItem).values(b);
  }
  for (const t of data.transactions) {
    summary.transactions.total++;
    if (!t.complete) summary.transactions.failed++;
    summary.transactions.byKind[t.kind] = (summary.transactions.byKind[t.kind] ?? 0) + 1;
  }

  // ---- draft --------------------------------------------------------------------------------------------------------
  if (data.draft) {
    const d = data.draft;
    const round1 = d.picks.filter((p) => p.round === 1);
    const slotOrder: Record<string, number> = {};
    for (const p of round1) {
      const ts = tsOf(p.teamId);
      if (ts !== null) slotOrder[String(p.roundPick)] = ts;
    }
    const values = {
      leagueSeasonId,
      externalId: `espn:${espnLeagueId}`,
      kind: row.league.type === "redraft" ? ("redraft" as const) : ("startup" as const),
      type: d.type,
      status: "complete" as const,
      rounds: d.rounds,
      startedAt: null,
      slotOrder,
    };
    const [dr] = await db
      .insert(draft)
      .values(values)
      .onConflictDoUpdate({ target: [draft.leagueSeasonId, draft.externalId], set: values })
      .returning({ id: draft.id });
    await db.delete(draftPick).where(eq(draftPick.draftId, dr!.id));
    const pickRows: (typeof draftPick.$inferInsert)[] = [];
    for (const p of d.picks) {
      const teamSeasonId = tsOf(p.teamId);
      if (teamSeasonId === null) continue;
      // The board column: the round-one slot, mirrored in even rounds of a snake draft.
      const slot =
        d.type === "snake" && p.round % 2 === 0
          ? d.picks.filter((x) => x.round === 1).length + 1 - p.roundPick
          : p.roundPick;
      pickRows.push({
        draftId: dr!.id,
        pickNo: p.overall,
        round: p.round,
        slot,
        teamSeasonId,
        // Whoever held that column in round one made the pick unless it was traded.
        originalTeamSeasonId: slotOrder[String(slot)] ?? null,
        playerId: pid(p.playerId),
        amount: d.type === "auction" ? p.bid : null,
        isKeeper: p.keeper,
      });
    }
    for (const b of chunk(pickRows, 1000)) if (b.length) await db.insert(draftPick).values(b);
    summary.draftPicks = pickRows.length;
  }

  // ---- manager identities: ESPN SWIDs, so later seasons and rescrapes find the same people --------------------------
  for (const t of data.teams) {
    const swid = t.owners[0];
    if (!swid) continue;
    const [m] = await db
      .select({ managerId: teamSeasonManager.managerId })
      .from(teamSeasonManager)
      .where(eq(teamSeasonManager.teamSeasonId, teamSeasonByEspn.get(t.id)!))
      .limit(1);
    if (m)
      await db
        .insert(managerIdentity)
        .values({ managerId: m.managerId, source: "espn", externalUserId: swid })
        .onConflictDoNothing();
  }
  for (const t of data.teams) {
    await db
      .update(teamSeason)
      .set({ avatar: t.logo, ...(t.seed !== null ? { seed: t.seed } : {}) })
      .where(eq(teamSeason.id, teamSeasonByEspn.get(t.id)!));
  }

  log.info(
    {
      season: `${row.league.slug}-${year}`,
      games: summary.games,
      teamWeeks: summary.teamWeeks,
      playerWeeks: summary.playerWeeks,
      transactions: summary.transactions,
      unmatched: summary.unmatchedPlayers.length,
    },
    "ESPN season normalized"
  );
  return summary;
}

/** Normalize the newest stored bundle for a season, derive, and compare final places with ESPN's own ranks. */
export async function importEspnSeason(db: Db, leagueSeasonId: number): Promise<EspnImportSummary> {
  const [row] = await db
    .select({ year: leagueSeason.year, slug: leagueTable.slug })
    .from(leagueSeason)
    .innerJoin(leagueTable, eq(leagueTable.id, leagueSeason.leagueId))
    .where(eq(leagueSeason.id, leagueSeasonId));
  if (!row) throw new Error(`league_season ${leagueSeasonId} not found`);
  const bundle = await loadLatestEspnBundle(db, row.slug, row.year);
  if (!bundle)
    throw new Error(
      `no ESPN bundle stored for ${row.slug} ${row.year}; import one in the admin UI`
    );
  return runEspnImport(db, leagueSeasonId, bundle.responses, bundle.name);
}

export async function runEspnImport(
  db: Db,
  leagueSeasonId: number,
  responses: BundleResponse[],
  bundleName: string | null
): Promise<EspnImportSummary> {
  const summary = await normalizeEspnSeason(db, leagueSeasonId, responses, bundleName);
  summary.derive = await deriveSeason(db, leagueSeasonId);
  const data = parseEspnBundle(summary.year, "", responses);
  const placed = await db
    .select()
    .from(teamSeason)
    .where(eq(teamSeason.leagueSeasonId, leagueSeasonId));
  const byName = new Map(placed.map((t) => [norm(t.name), t]));
  for (const t of data.teams) {
    const mine = byName.get(norm(t.name));
    if (mine && t.rankFinal !== null && mine.finalPlace !== t.rankFinal)
      summary.placementMismatches.push(
        `"${t.name}": ESPN final rank ${t.rankFinal}, stored ${mine.finalPlace ?? "none"}`
      );
  }
  return summary;
}
