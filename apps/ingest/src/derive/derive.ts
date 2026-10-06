import {
  dataVersion,
  draft,
  draftPick,
  gameResult,
  leagueSeason,
  leagueSeasonWeek,
  leagueThreshold,
  matchup,
  override,
  playerTenure,
  playerWeek,
  syncRun,
  teamSeason,
  teamSeasonWeek,
  teamWeek,
  teamWeekStats,
  transaction,
  transactionItem,
  trophy,
  type Db,
} from "@rfp/db";
import {
  buildGameResults,
  buildTenures,
  derivePlacements,
  median,
  optimalLineup,
  round3,
  weekStats,
  type Game,
  type LineupPlayer,
  type PlacementGame,
  type RosterEvent,
} from "@rfp/core";
import { and, asc, eq, inArray, isNull, or, sql } from "@rfp/db";
import { log } from "../lib/log";
import { teamSeasonOverrideKey } from "../sleeper/games";

/** Bump when derive logic changes; ingest recomputes seasons whose data_version.derive_version is behind. */
export const DERIVE_VERSION = 1;

const chunk = <T>(arr: readonly T[], size: number): T[][] => {
  const out: T[][] = [];
  for (let i = 0; i < arr.length; i += size) out.push(arr.slice(i, i + size));
  return out;
};

export interface DeriveSummary {
  leagueSeasonId: number;
  gameResults: number;
  statsRows: number;
  standingsRows: number;
  tenures: number;
  trophies: number;
  placementsSet: number;
  lineupAnomalies: number;
  /** Teams whose configured placement differs from the one the brackets imply. */
  placementMismatches: string[];
}

/**
 * Recompute every derived table for one league season from its canonical rows, then bump its data_version.
 * Wipes and refills only derived tables, so it is safe to re-run (`finalize` relies on that).
 */
export async function deriveSeason(db: Db, leagueSeasonId: number): Promise<DeriveSummary> {
  const [season] = await db.select().from(leagueSeason).where(eq(leagueSeason.id, leagueSeasonId));
  if (!season) throw new Error(`league_season ${leagueSeasonId} not found`);
  const weekRows = await db
    .select()
    .from(leagueSeasonWeek)
    .where(eq(leagueSeasonWeek.leagueSeasonId, leagueSeasonId));
  const complete = new Set(weekRows.filter((w) => w.status === "complete").map((w) => w.week));
  const teams = await db
    .select()
    .from(teamSeason)
    .where(eq(teamSeason.leagueSeasonId, leagueSeasonId));
  const tw = await db.select().from(teamWeek).where(eq(teamWeek.leagueSeasonId, leagueSeasonId));
  const matchups = await db
    .select()
    .from(matchup)
    .where(eq(matchup.leagueSeasonId, leagueSeasonId));
  const teamById = new Map(teams.map((t) => [t.id, t]));
  const summary: DeriveSummary = {
    leagueSeasonId,
    gameResults: 0,
    statsRows: 0,
    standingsRows: 0,
    tenures: 0,
    trophies: 0,
    placementsSet: 0,
    lineupAnomalies: 0,
    placementMismatches: [],
  };

  // ---- Game results (complete weeks only) ----
  const twByMatchup = new Map<number, typeof tw>();
  for (const t of tw) {
    if (t.matchupId === null) continue;
    const list = twByMatchup.get(t.matchupId) ?? [];
    list.push(t);
    twByMatchup.set(t.matchupId, list);
  }
  const games: Game[] = [];
  for (const m of matchups) {
    if (!complete.has(m.week) || m.gameType === "none") continue;
    const sides = twByMatchup.get(m.id) ?? [];
    if (sides.length !== 2) continue;
    const [a, b] = sides as [(typeof tw)[number], (typeof tw)[number]];
    const ta = teamById.get(a.teamSeasonId);
    const tb = teamById.get(b.teamSeasonId);
    if (!ta || !tb) continue;
    games.push({
      matchupId: m.id,
      week: m.week,
      gameType: m.gameType,
      a: { teamSeasonId: a.teamSeasonId, franchiseId: ta.franchiseId, points: a.points },
      b: { teamSeasonId: b.teamSeasonId, franchiseId: tb.franchiseId, points: b.points },
    });
  }
  const results = buildGameResults(games);
  const franchiseOf = (id: number) => teamById.get(id)!.franchiseId;

  // ---- Weekly stats (rank, z-score, all-play, median) over counted teams per complete week ----
  const counted = tw.filter((t) => complete.has(t.week) && t.counts);
  const byWeek = new Map<number, typeof tw>();
  for (const t of counted) {
    const list = byWeek.get(t.week) ?? [];
    list.push(t);
    byWeek.set(t.week, list);
  }

  // ---- Optimal lineups from player_week (every rostered player, that week's position snapshot) ----
  const completeTw = tw.filter((t) => complete.has(t.week));
  const pwByTw = new Map<number, LineupPlayer[]>();
  const pwMeta = new Map<
    number,
    {
      bench: number;
      ir: number;
      projected: number | null;
      maxStarter: number;
      starterTotal: number;
    }
  >();
  for (const batch of chunk(
    completeTw.map((t) => t.id),
    3000
  )) {
    const rows = await db.select().from(playerWeek).where(inArray(playerWeek.teamWeekId, batch));
    for (const r of rows) {
      const list = pwByTw.get(r.teamWeekId) ?? [];
      list.push({
        id: r.playerId,
        points: r.points ?? 0,
        position: r.position,
        eligiblePositions: r.eligiblePositions,
      });
      pwByTw.set(r.teamWeekId, list);
      const meta = pwMeta.get(r.teamWeekId) ?? {
        bench: 0,
        ir: 0,
        projected: null,
        maxStarter: 0,
        starterTotal: 0,
      };
      if (r.slotKind === "bench") meta.bench += r.points ?? 0;
      else if (r.slotKind === "ir") meta.ir += r.points ?? 0;
      else if (r.slotKind === "starter") {
        meta.starterTotal += r.points ?? 0;
        meta.maxStarter = Math.max(meta.maxStarter, r.points ?? 0);
        if (r.projectedPoints !== null) meta.projected = (meta.projected ?? 0) + r.projectedPoints;
      }
      pwMeta.set(r.teamWeekId, meta);
    }
  }

  const statsRows: (typeof teamWeekStats.$inferInsert)[] = [];
  const weekStatByTw = new Map<number, ReturnType<typeof weekStats>["teams"][number]>();
  const weekMedian = new Map<number, { median: number | null; mean: number | null }>();
  for (const [week, list] of byWeek) {
    const ws = weekStats(list.map((t) => ({ teamId: t.id, points: t.points })));
    weekMedian.set(week, { median: ws.median, mean: ws.mean });
    for (const s of ws.teams) weekStatByTw.set(Number(s.teamId), s);
  }
  for (const t of completeTw) {
    const players = pwByTw.get(t.id);
    const meta = pwMeta.get(t.id);
    // Commissioner overrides change team points but not what the lineup scored: compare starters to the optimum.
    const actual = meta ? round3(meta.starterTotal) : t.points;
    let optimal: number | null = null;
    if (players && players.length > 0 && season.rosterSlots.length > 0) {
      optimal = optimalLineup(season.rosterSlots, players).points;
      if (optimal < actual - 0.01) {
        // The actual lineup is itself a feasible lineup, so optimal can never be lower. Position data is
        // incomplete for this team-week; trust the actual lineup rather than report an IQ above 100%.
        summary.lineupAnomalies++;
        log.warn(
          { teamSeasonId: t.teamSeasonId, week: t.week, actual, optimal },
          "actual lineup beat the computed optimum; position data incomplete"
        );
        optimal = actual;
      }
    }
    const s = weekStatByTw.get(t.id);
    const wk = weekMedian.get(t.week);
    statsRows.push({
      teamWeekId: t.id,
      optimalPoints: optimal,
      benchPoints: meta ? round3(meta.bench) : null,
      irPoints: meta ? round3(meta.ir) : null,
      projectedPoints: meta?.projected != null ? round3(meta.projected) : null,
      lineupIq: optimal !== null && optimal > 0 ? round3(actual / optimal) : null,
      isPerfect: optimal !== null ? optimal - actual < 0.01 : null,
      weekMedian: t.counts ? (wk?.median ?? null) : null,
      weekMean: t.counts ? (wk?.mean ?? null) : null,
      weekRank: s?.rank ?? null,
      weekZscore: s ? round3(s.zscore) : null,
      allplayW: s?.allPlay.w ?? null,
      allplayL: s?.allPlay.l ?? null,
      allplayT: s?.allPlay.t ?? null,
      topPlayerShare:
        meta && meta.starterTotal > 0 ? round3(meta.maxStarter / meta.starterTotal) : null,
    });
  }

  // ---- Standings after each complete week (regular season; frozen afterwards) ----
  const regularWeeks = [...complete]
    .filter((w) => w <= season.regularSeasonWeeks)
    .sort((a, b) => a - b);
  const finalStandingWeek = Math.max(0, ...regularWeeks);
  const regularResults = results.filter(
    (r) => r.gameType === "regular" && (season.medianEnabled || r.kind === "h2h")
  );
  const standingRows: (typeof teamSeasonWeek.$inferInsert)[] = [];
  const cum = new Map<number, { w: number; l: number; t: number; pf: number; pa: number }>();
  for (const t of teams) cum.set(t.id, { w: 0, l: 0, t: 0, pf: 0, pa: 0 });
  const standingsByWeek = new Map<number, { teamSeasonId: number; rank: number }[]>();
  const lastWeekOfStandings = Math.max(0, ...[...complete]);
  for (let week = 1; week <= lastWeekOfStandings; week++) {
    if (!complete.has(week)) continue;
    if (week <= season.regularSeasonWeeks) {
      for (const r of regularResults.filter((x) => x.week === week)) {
        const c = cum.get(Number(r.teamSeasonId))!;
        if (r.result === "W") c.w++;
        else if (r.result === "L") c.l++;
        else c.t++;
        if (r.kind === "h2h") {
          c.pf += r.pointsFor;
          c.pa += r.pointsAgainst;
        }
      }
    }
    // Sleeper's default: record (ties = half), then points for. No further tie-break (doc §2).
    const ordered = [...cum.entries()].sort(
      ([ia, a], [ib, b]) => b.w + 0.5 * b.t - (a.w + 0.5 * a.t) || b.pf - a.pf || ia - ib
    );
    const [, lead] = ordered[0]!;
    standingsByWeek.set(
      week,
      ordered.map(([id], i) => ({ teamSeasonId: id, rank: i + 1 }))
    );
    ordered.forEach(([id, c], i) => {
      standingRows.push({
        teamSeasonId: id,
        week,
        wins: c.w,
        losses: c.l,
        ties: c.t,
        pf: round3(c.pf),
        pa: round3(c.pa),
        rank: i + 1,
        gamesBack: (lead.w - c.w + (c.l - lead.l)) / 2,
      });
    });
  }

  // ---- Final placements from brackets where nothing else has set them ----
  // final_place = admin/config override, else what the brackets imply (only once the season is over).
  const placementUpdates = new Map<number, number>();
  const seasonDone = season.status === "complete" && complete.has(season.lastWeek);
  const placementOverrides = new Map<string, number>();
  for (const o of await db
    .select()
    .from(override)
    .where(
      and(
        eq(override.entity, "team_season"),
        eq(override.field, "final_place"),
        eq(override.active, true)
      )
    ))
    if (typeof o.value === "number") placementOverrides.set(o.entityId, o.value);
  if (seasonDone) {
    const order = (standingsByWeek.get(finalStandingWeek) ?? []).map((s) => s.teamSeasonId);
    const gamesForPlacement: PlacementGame[] = [];
    for (const m of matchups) {
      if (m.bracket === null || m.placementAtStake === null) continue;
      const sides = twByMatchup.get(m.id);
      if (!sides || sides.length !== 2) continue;
      gamesForPlacement.push({
        bracket: m.bracket,
        placement: m.placementAtStake,
        teamA: sides[0]!.teamSeasonId,
        teamB: sides[1]!.teamSeasonId,
        pointsA: sides[0]!.points,
        pointsB: sides[1]!.points,
      });
    }
    const bracketGames = gamesForPlacement.length;
    const derived = derivePlacements({
      teamCount: teams.length,
      playoffTeams: teams.filter((t) => t.madePlayoffs).map((t) => t.id),
      regularSeasonOrder: order.length > 0 ? order : teams.map((t) => t.id),
      games: gamesForPlacement,
    });
    for (const t of teams) {
      const configured = placementOverrides.get(
        teamSeasonOverrideKey(leagueSeasonId, t.externalRosterId)
      );
      const fromBrackets = derived.get(t.id);
      if (
        configured !== undefined &&
        fromBrackets !== undefined &&
        configured !== fromBrackets &&
        bracketGames > 0
      )
        summary.placementMismatches.push(
          `${t.name}: configured ${configured}, brackets say ${fromBrackets}`
        );
      const final = configured ?? fromBrackets;
      if (final !== undefined && final !== t.finalPlace) placementUpdates.set(t.id, final);
    }
  }

  // ---- Player tenure (continuous stints per team season) ----
  const tenureRows: (typeof playerTenure.$inferInsert)[] = [];
  const txItems = await db
    .select({
      week: transaction.week,
      type: transaction.type,
      direction: transactionItem.direction,
      kind: transactionItem.kind,
      playerId: transactionItem.playerId,
      from: transactionItem.fromTeamSeasonId,
      to: transactionItem.toTeamSeasonId,
      executedAt: transaction.executedAt,
      id: transactionItem.id,
    })
    .from(transactionItem)
    .innerJoin(transaction, eq(transaction.id, transactionItem.transactionId))
    .where(and(eq(transaction.leagueSeasonId, leagueSeasonId), eq(transaction.status, "complete")))
    .orderBy(asc(transaction.week), asc(transaction.executedAt), asc(transactionItem.id));
  const draftPicks = await db
    .select({ team: draftPick.teamSeasonId, playerId: draftPick.playerId })
    .from(draftPick)
    .innerJoin(draft, eq(draft.id, draftPick.draftId))
    .where(and(eq(draft.leagueSeasonId, leagueSeasonId), eq(draft.status, "complete")));
  const week1 = tw.filter((t) => t.week === 1);
  const week1Players = new Map<number, number[]>();
  for (const batch of chunk(
    week1.map((t) => t.id),
    3000
  )) {
    const rows = await db
      .select({ tw: playerWeek.teamWeekId, playerId: playerWeek.playerId })
      .from(playerWeek)
      .where(inArray(playerWeek.teamWeekId, batch));
    const teamOfTw = new Map(week1.map((t) => [t.id, t.teamSeasonId]));
    for (const r of rows) {
      const ts = teamOfTw.get(r.tw)!;
      week1Players.set(ts, [...(week1Players.get(ts) ?? []), r.playerId]);
    }
  }
  const throughWeek = seasonDone ? season.lastWeek : Math.max(1, season.lastCompletedWeek);
  for (const t of teams) {
    const events: RosterEvent[] = [];
    for (const d of draftPicks)
      if (d.team === t.id && d.playerId !== null)
        events.push({ playerId: d.playerId, week: 1, kind: "add", via: "draft" });
    for (const i of txItems) {
      if (i.kind !== "player" || i.playerId === null) continue;
      const w = Math.max(1, i.week);
      if (i.to === t.id && i.direction !== "drop")
        events.push({ playerId: i.playerId, week: w, kind: "add", via: i.type });
      if (i.from === t.id && i.direction !== "add")
        events.push({
          playerId: i.playerId,
          week: i.week,
          kind: "remove",
          via: i.type === "trade" ? "trade" : i.type === "commissioner" ? "commissioner" : "drop",
        });
    }
    const tenures = buildTenures({
      firstWeek: 1,
      throughWeek,
      seasonComplete: seasonDone,
      initialPlayers: week1Players.get(t.id) ?? [],
      events,
    });
    for (const s of tenures)
      tenureRows.push({
        ...s,
        teamSeasonId: t.id,
        playerId: Number(s.playerId),
      } as typeof playerTenure.$inferInsert);
  }

  // ---- Trophies ----
  const thresholds = await db
    .select()
    .from(leagueThreshold)
    .where(
      and(
        eq(leagueThreshold.leagueId, season.leagueId),
        or(
          eq(leagueThreshold.leagueSeasonId, leagueSeasonId),
          isNull(leagueThreshold.leagueSeasonId)
        )
      )
    );
  const threshold = (key: string) =>
    (
      thresholds.find((t) => t.key === key && t.leagueSeasonId === leagueSeasonId) ??
      thresholds.find((t) => t.key === key && t.leagueSeasonId === null)
    )?.value;
  const trophyRows: (typeof trophy.$inferInsert)[] = [];
  const finalPlaceOf = (t: (typeof teams)[number]) =>
    t.finalPlace ?? placementUpdates.get(t.id) ?? null;
  if (seasonDone) {
    for (const t of teams) {
      const p = finalPlaceOf(t);
      if (p === 1) trophyRows.push({ kind: "winners_circle", teamSeasonId: t.id, value: 1 });
      else if (p === 2 || p === 3)
        trophyRows.push({ kind: "podium", teamSeasonId: t.id, value: p });
      if (p !== null && p === teams.length)
        trophyRows.push({ kind: "losers_circle", teamSeasonId: t.id, value: p });
    }
  }
  const high = threshold("high_scorer");
  const low = threshold("benchwarmer");
  for (const t of counted) {
    if (high !== undefined && t.points > high)
      trophyRows.push({
        kind: "high_scorer",
        teamSeasonId: t.teamSeasonId,
        teamWeekId: t.id,
        value: t.points,
      });
    if (low !== undefined && t.points < low)
      trophyRows.push({
        kind: "benchwarmer",
        teamSeasonId: t.teamSeasonId,
        teamWeekId: t.id,
        value: t.points,
      });
  }

  // ---- Write: wipe and refill derived tables atomically ----
  await db.transaction(async (tx) => {
    const teamIds = teams.map((t) => t.id);
    const twIds = tw.map((t) => t.id);
    await tx.delete(gameResult).where(eq(gameResult.leagueSeasonId, leagueSeasonId));
    for (const b of chunk(twIds, 3000))
      await tx.delete(teamWeekStats).where(inArray(teamWeekStats.teamWeekId, b));
    if (teamIds.length) {
      await tx.delete(teamSeasonWeek).where(inArray(teamSeasonWeek.teamSeasonId, teamIds));
      await tx.delete(playerTenure).where(inArray(playerTenure.teamSeasonId, teamIds));
      await tx.delete(trophy).where(inArray(trophy.teamSeasonId, teamIds));
    }

    for (const b of chunk(results, 1000))
      if (b.length)
        await tx.insert(gameResult).values(
          b.map((r) => ({
            teamSeasonId: Number(r.teamSeasonId),
            franchiseId: Number(r.franchiseId),
            leagueSeasonId,
            week: r.week,
            seq: r.seq,
            kind: r.kind,
            matchupId: r.matchupId === null ? null : Number(r.matchupId),
            opponentTeamSeasonId:
              r.opponentTeamSeasonId === null ? null : Number(r.opponentTeamSeasonId),
            opponentFranchiseId:
              r.opponentFranchiseId === null ? null : Number(r.opponentFranchiseId),
            result: r.result,
            gameType: r.gameType,
            pointsFor: r.pointsFor,
            pointsAgainst: r.pointsAgainst,
          }))
        );
    summary.gameResults = results.length;

    // team_week result / margin for counted head-to-head games.
    for (const r of results.filter((x) => x.kind === "h2h")) {
      await tx
        .update(teamWeek)
        .set({ result: r.result, margin: round3(r.pointsFor - r.pointsAgainst) })
        .where(and(eq(teamWeek.teamSeasonId, Number(r.teamSeasonId)), eq(teamWeek.week, r.week)));
    }

    for (const b of chunk(statsRows, 1000)) if (b.length) await tx.insert(teamWeekStats).values(b);
    summary.statsRows = statsRows.length;
    for (const b of chunk(standingRows, 1000))
      if (b.length) await tx.insert(teamSeasonWeek).values(b);
    summary.standingsRows = standingRows.length;
    for (const b of chunk(tenureRows, 2000)) if (b.length) await tx.insert(playerTenure).values(b);
    summary.tenures = tenureRows.length;
    for (const b of chunk(trophyRows, 2000)) if (b.length) await tx.insert(trophy).values(b);
    summary.trophies = trophyRows.length;

    // seed = regular-season rank once the regular season is over
    if (finalStandingWeek >= season.regularSeasonWeeks) {
      for (const s of standingsByWeek.get(finalStandingWeek) ?? []) {
        await tx.update(teamSeason).set({ seed: s.rank }).where(eq(teamSeason.id, s.teamSeasonId));
      }
    }
    for (const [id, place] of placementUpdates) {
      await tx.update(teamSeason).set({ finalPlace: place }).where(eq(teamSeason.id, id));
      summary.placementsSet++;
    }

    await tx
      .insert(dataVersion)
      .values({ leagueSeasonId, version: 1, deriveVersion: DERIVE_VERSION })
      .onConflictDoUpdate({
        target: dataVersion.leagueSeasonId,
        set: {
          version: sql`${dataVersion.version} + 1`,
          deriveVersion: DERIVE_VERSION,
          updatedAt: new Date(),
        },
      });
  });

  void median;
  void syncRun;
  void franchiseOf;
  log.info(summary, "season derived");
  return summary;
}
