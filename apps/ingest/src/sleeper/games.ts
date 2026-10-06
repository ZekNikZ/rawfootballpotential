import { matchup, override, player, playerWeek, teamWeek, type Db } from "@rfp/db";
import { classifyGames, pairWeek, round3, type BracketGame, type WeekGame } from "@rfp/core";
import { and, eq, inArray, sql } from "@rfp/db";
import type { PlayerResolver } from "./players";
import type { SleeperBracketGame, SleeperMatchupEntry } from "./schemas";

type GameType = (typeof matchup.$inferInsert)["gameType"];

const PLAIN_POSITIONS = new Set(["QB", "RB", "WR", "TE", "K", "DEF", "DL", "LB", "DB"]);

const chunk = <T>(arr: readonly T[], size: number): T[][] => {
  const out: T[][] = [];
  for (let i = 0; i < arr.length; i += size) out.push(arr.slice(i, i + size));
  return out;
};

const toBracket = (g: SleeperBracketGame): BracketGame => ({
  round: g.r,
  match: g.m,
  team1: typeof g.t1 === "number" ? g.t1 : null,
  team2: typeof g.t2 === "number" ? g.t2 : null,
  placement: g.p ?? null,
});

export interface SyncGamesInput {
  leagueSeasonId: number;
  playoffWeekStart: number;
  rosterSlots: readonly string[];
  teamSeasonByRoster: ReadonlyMap<number, number>;
  /** week -> raw matchup entries as Sleeper returned them. */
  weeks: ReadonlyMap<number, readonly SleeperMatchupEntry[]>;
  winners: readonly SleeperBracketGame[] | null;
  losers: readonly SleeperBracketGame[] | null;
  completeWeeks: ReadonlySet<number>;
  players: PlayerResolver;
  /** week -> sleeper player id -> projected points (already scored with this league's settings). */
  projections?: ReadonlyMap<number, ReadonlyMap<string, number>>;
}

export interface GamesStats {
  gamesByType: Record<string, number>;
  teamWeeks: number;
  playerWeeks: number;
  anomalies: string[];
}

/** Score overrides: `override` rows (entity 'team_week', field 'points') win over ingested scores. */
export const teamWeekOverrideKey = (
  leagueSeasonId: number,
  rosterId: number | string,
  week: number
) => `ls:${leagueSeasonId}:r:${rosterId}:w:${week}`;

export const teamSeasonOverrideKey = (leagueSeasonId: number, externalRosterId: string) =>
  `ls:${leagueSeasonId}:r:${externalRosterId}`;

export async function syncGames(db: Db, input: SyncGamesInput): Promise<GamesStats> {
  const weeks = [...input.weeks.keys()].sort((a, b) => a - b);
  const stats: GamesStats = { gamesByType: {}, teamWeeks: 0, playerWeeks: 0, anomalies: [] };
  if (weeks.length === 0) return stats;

  const overrides = new Map<string, number>();
  const overrideRows = await db
    .select()
    .from(override)
    .where(
      and(eq(override.entity, "team_week"), eq(override.field, "points"), eq(override.active, true))
    );
  for (const o of overrideRows) if (typeof o.value === "number") overrides.set(o.entityId, o.value);

  // Players for the whole sync, resolved once.
  const allSleeperIds = new Set<string>();
  for (const entries of input.weeks.values())
    for (const e of entries) for (const p of e.players ?? []) allSleeperIds.add(p);
  await input.players.resolve(allSleeperIds);
  const playerInfo = new Map<number, { position: string | null; fantasy: string[] | null }>();
  const ids = [
    ...new Set([...allSleeperIds].filter((s) => s !== "0").map((s) => input.players.get(s))),
  ];
  for (const batch of chunk(ids, 2000)) {
    const rows = await db
      .select({ id: player.id, position: player.position, fantasy: player.fantasyPositions })
      .from(player)
      .where(inArray(player.id, batch));
    for (const r of rows) playerInfo.set(r.id, { position: r.position, fantasy: r.fantasy });
  }

  // 1. Pair each week and classify games from the brackets.
  type Paired = ReturnType<typeof pairWeek>;
  const pairedByWeek = new Map<number, Paired>();
  const weekGames: WeekGame[] = [];
  for (const week of weeks) {
    const entries = input.weeks.get(week) ?? [];
    const paired = pairWeek(
      entries.map((e) => ({
        teamId: e.roster_id,
        matchupId: e.matchup_id ?? null,
        points: e.custom_points ?? e.points ?? 0,
      }))
    );
    pairedByWeek.set(week, paired);
    for (const id of paired.anomalies)
      stats.anomalies.push(`week ${week}: matchup_id ${String(id)} has more than two teams`);
    for (const [a, b] of paired.games) {
      weekGames.push({
        matchupId: `${week}:${String(a.matchupId)}`,
        week,
        teamA: a.teamId,
        teamB: b.teamId,
      });
    }
  }
  const classes = new Map(
    classifyGames({
      playoffWeekStart: input.playoffWeekStart,
      winners: (input.winners ?? []).map(toBracket),
      losers: input.losers ? input.losers.map(toBracket) : undefined,
      games: weekGames,
    }).map((c) => [String(c.matchupId), c])
  );

  // 2. Rebuild this season's matchup rows for the synced weeks (team_week.matchup_id is re-linked below).
  await db
    .delete(matchup)
    .where(and(eq(matchup.leagueSeasonId, input.leagueSeasonId), inArray(matchup.week, weeks)));
  const matchupRows: (typeof matchup.$inferInsert)[] = [];
  for (const g of weekGames) {
    const c = classes.get(String(g.matchupId))!;
    matchupRows.push({
      leagueSeasonId: input.leagueSeasonId,
      week: g.week,
      externalMatchupId: Number(String(g.matchupId).split(":")[1]),
      gameType: c.gameType as GameType,
      bracket: c.bracket,
      bracketRound: c.bracketRound,
      placementAtStake: c.placementAtStake,
      isChampionship: c.isChampionship,
    });
    stats.gamesByType[c.gameType] = (stats.gamesByType[c.gameType] ?? 0) + 1;
  }
  const matchupIds = new Map<string, number>();
  for (const batch of chunk(matchupRows, 1000)) {
    const inserted = await db
      .insert(matchup)
      .values(batch)
      .returning({ id: matchup.id, week: matchup.week, ext: matchup.externalMatchupId });
    for (const m of inserted) matchupIds.set(`${m.week}:${m.ext}`, m.id);
  }

  // 3. team_week rows.
  const teamWeekRows: (typeof teamWeek.$inferInsert)[] = [];
  const opponentOf = new Map<string, number>(); // `${week}:${roster}` -> opponent roster
  for (const [week, paired] of pairedByWeek) {
    for (const [a, b] of paired.games) {
      opponentOf.set(`${week}:${a.teamId}`, Number(b.teamId));
      opponentOf.set(`${week}:${b.teamId}`, Number(a.teamId));
    }
  }
  for (const week of weeks) {
    for (const e of input.weeks.get(week) ?? []) {
      const teamSeasonId = input.teamSeasonByRoster.get(e.roster_id);
      if (teamSeasonId === undefined) {
        stats.anomalies.push(`week ${week}: roster ${e.roster_id} has no team_season`);
        continue;
      }
      const mid = e.matchup_id ?? null;
      const key = mid === null ? null : `${week}:${mid}`;
      const matchupId = key !== null ? (matchupIds.get(key) ?? null) : null;
      const cls = key !== null ? classes.get(key) : undefined;
      const oppRoster = opponentOf.get(`${week}:${e.roster_id}`);
      const ovKey = teamWeekOverrideKey(input.leagueSeasonId, e.roster_id, week);
      const overridden = overrides.get(ovKey);
      const ingested = e.custom_points ?? e.points ?? 0;
      teamWeekRows.push({
        leagueSeasonId: input.leagueSeasonId,
        teamSeasonId,
        week,
        matchupId,
        opponentTeamSeasonId:
          oppRoster !== undefined ? (input.teamSeasonByRoster.get(oppRoster) ?? null) : null,
        counts: matchupId !== null && cls !== undefined && cls.gameType !== "none",
        points: round3(overridden ?? ingested),
        pointsOverridden: overridden !== undefined || e.custom_points != null,
        isFinal: input.completeWeeks.has(week),
      });
    }
  }
  const teamWeekIds = new Map<string, number>(); // `${teamSeasonId}:${week}` -> id
  for (const batch of chunk(teamWeekRows, 1000)) {
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
  stats.teamWeeks = teamWeekRows.length;

  // 4. player_week: replace the rows of the synced team-weeks.
  const twIds = [...teamWeekIds.values()];
  for (const batch of chunk(twIds, 2000))
    await db.delete(playerWeek).where(inArray(playerWeek.teamWeekId, batch));
  const pwRows: (typeof playerWeek.$inferInsert)[] = [];
  for (const week of weeks) {
    const proj = input.projections?.get(week);
    for (const e of input.weeks.get(week) ?? []) {
      const teamSeasonId = input.teamSeasonByRoster.get(e.roster_id);
      const teamWeekId =
        teamSeasonId === undefined ? undefined : teamWeekIds.get(`${teamSeasonId}:${week}`);
      if (teamWeekId === undefined) continue;
      const starterSlot = new Map<string, string>();
      (e.starters ?? []).forEach((pid, i) => {
        if (pid !== "0") starterSlot.set(pid, input.rosterSlots[i] ?? "FLEX");
      });
      for (const pid of new Set(e.players ?? [])) {
        if (pid === "0") continue;
        const playerId = input.players.get(pid);
        const slot = starterSlot.get(pid);
        const info = playerInfo.get(playerId);
        // Position snapshot. Sleeper has no per-week position, so start from the dump and add the slot a
        // starter actually filled as evidence of eligibility (nfl-reference later refines from nflverse).
        const eligible = new Set<string>(info?.fantasy ?? []);
        if (info?.position) eligible.add(info.position);
        if (slot && PLAIN_POSITIONS.has(slot)) eligible.add(slot);
        pwRows.push({
          teamWeekId,
          playerId,
          slot: slot ?? "BN",
          slotKind: slot ? "starter" : "bench",
          points: e.players_points?.[pid] ?? null,
          projectedPoints: proj?.get(pid) ?? null,
          position: info?.position ?? null,
          eligiblePositions: [...eligible],
        });
      }
    }
  }
  for (const batch of chunk(pwRows, 2000)) await db.insert(playerWeek).values(batch);
  stats.playerWeeks = pwRows.length;
  return stats;
}
