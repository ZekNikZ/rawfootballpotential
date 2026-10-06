import {
  franchise,
  leagueSeason,
  manager,
  managerIdentity,
  teamSeason,
  teamSeasonManager,
  type Db,
} from "@rfp/db";
import { and, eq, inArray } from "@rfp/db";
import { log } from "../lib/log";
import type { SleeperBracketGame, SleeperLeague, SleeperRoster, SleeperUser } from "./schemas";

const avatarUrl = (a: string | null | undefined) =>
  a ? `https://sleepercdn.com/avatars/${a}` : null;

export interface TeamsResult {
  /** Sleeper roster_id -> team_season.id */
  teamSeasonByRoster: Map<number, number>;
  /** Sleeper roster_id -> franchise.id */
  franchiseByRoster: Map<number, number>;
}

export interface SyncTeamsInput {
  leagueSeasonId: number;
  leagueId: number;
  leagueType: "redraft" | "dynasty";
  year: number;
  league: SleeperLeague;
  users: readonly SleeperUser[];
  rosters: readonly SleeperRoster[];
  winners: readonly SleeperBracketGame[] | null;
  /** True once the season is complete: team names/avatars are frozen. */
  frozen: boolean;
  currentWeek: number | null;
}

/** Sleeper user id -> manager id; unknown users become new managers (config managers come from migrate:mongo). */
export async function resolveManagers(
  db: Db,
  users: readonly SleeperUser[],
  extraIds: readonly string[]
) {
  const ids = [...new Set([...users.map((u) => u.user_id), ...extraIds])];
  const rows = ids.length
    ? await db
        .select({
          externalUserId: managerIdentity.externalUserId,
          managerId: managerIdentity.managerId,
        })
        .from(managerIdentity)
        .where(
          and(eq(managerIdentity.source, "sleeper"), inArray(managerIdentity.externalUserId, ids))
        )
    : [];
  const map = new Map(rows.map((r) => [r.externalUserId, r.managerId]));
  for (const id of ids) {
    if (map.has(id)) continue;
    const user = users.find((u) => u.user_id === id);
    const [m] = await db
      .insert(manager)
      .values({ name: user?.display_name ?? `Sleeper user ${id}`, avatar: avatarUrl(user?.avatar) })
      .returning({ id: manager.id });
    await db
      .insert(managerIdentity)
      .values({ managerId: m!.id, source: "sleeper", externalUserId: id });
    map.set(id, m!.id);
    log.warn(
      { userId: id, name: user?.display_name },
      "created manager for unconfigured Sleeper user"
    );
  }
  return map;
}

export async function syncTeams(db: Db, input: SyncTeamsInput): Promise<TeamsResult> {
  const { league, users, rosters } = input;
  const coOwnerIds = rosters.flatMap((r) => r.co_owners ?? []);
  const ownerIds = rosters.flatMap((r) => (r.owner_id ? [r.owner_id] : []));
  const managers = await resolveManagers(db, users, [...ownerIds, ...coOwnerIds]);

  const existing = await db
    .select()
    .from(teamSeason)
    .where(eq(teamSeason.leagueSeasonId, input.leagueSeasonId));
  const existingByRoster = new Map(existing.map((t) => [t.externalRosterId, t]));

  // Previous season's franchise per roster (dynasty continuity).
  const previousByRoster = new Map<string, number>();
  if (input.leagueType === "dynasty") {
    const prev = await db
      .select({ roster: teamSeason.externalRosterId, franchiseId: teamSeason.franchiseId })
      .from(teamSeason)
      .innerJoin(leagueSeason, eq(leagueSeason.id, teamSeason.leagueSeasonId))
      .where(and(eq(leagueSeason.leagueId, input.leagueId), eq(leagueSeason.year, input.year - 1)));
    for (const p of prev) previousByRoster.set(p.roster, p.franchiseId);
  }

  // Franchise of each manager in this league (redraft: franchise = manager).
  const franchiseByManager = new Map<number, number>();
  if (input.leagueType === "redraft") {
    const rows = await db
      .selectDistinct({
        managerId: teamSeasonManager.managerId,
        franchiseId: teamSeason.franchiseId,
      })
      .from(teamSeasonManager)
      .innerJoin(teamSeason, eq(teamSeason.id, teamSeasonManager.teamSeasonId))
      .innerJoin(leagueSeason, eq(leagueSeason.id, teamSeason.leagueSeasonId))
      .where(and(eq(leagueSeason.leagueId, input.leagueId), eq(teamSeasonManager.role, "primary")));
    // A manager's most recent franchise wins if there is more than one (should not happen).
    for (const r of rows) franchiseByManager.set(r.managerId, r.franchiseId);
  }

  const inBracket = new Set<number>();
  for (const g of input.winners ?? [])
    for (const t of [g.t1, g.t2]) if (typeof t === "number") inBracket.add(t);
  const bracketKnown = (input.winners?.length ?? 0) > 0;

  const divisionName = (n: number | null | undefined) => {
    if (!n) return null;
    const v = league.metadata?.[`division_${n}`];
    return typeof v === "string" ? v : `Division ${n}`;
  };

  const result: TeamsResult = { teamSeasonByRoster: new Map(), franchiseByRoster: new Map() };

  for (const roster of rosters) {
    const key = String(roster.roster_id);
    const user = users.find((u) => u.user_id === roster.owner_id);
    const ownerManager = roster.owner_id ? managers.get(roster.owner_id) : undefined;
    const prior = existingByRoster.get(key);

    let franchiseId = prior?.franchiseId;
    if (franchiseId === undefined) {
      franchiseId =
        previousByRoster.get(key) ??
        (ownerManager !== undefined ? franchiseByManager.get(ownerManager) : undefined);
      if (franchiseId === undefined) {
        const [f] = await db
          .insert(franchise)
          .values({ leagueId: input.leagueId })
          .returning({ id: franchise.id });
        franchiseId = f!.id;
      }
      if (ownerManager !== undefined) franchiseByManager.set(ownerManager, franchiseId);
    }

    const teamName =
      (typeof user?.metadata?.team_name === "string" && user.metadata.team_name) ||
      (user ? `Team ${user.display_name}` : `Team ${roster.roster_id}`);
    const base = {
      division: divisionName(roster.settings.division),
      madePlayoffs: bracketKnown ? inBracket.has(roster.roster_id) : null,
    };

    let teamSeasonId: number;
    if (prior) {
      teamSeasonId = prior.id;
      const set = input.frozen
        ? { madePlayoffs: base.madePlayoffs }
        : {
            ...base,
            name: teamName,
            avatar: avatarUrl(
              typeof user?.metadata?.avatar === "string" ? user.metadata.avatar : user?.avatar
            ),
          };
      await db.update(teamSeason).set(set).where(eq(teamSeason.id, prior.id));
    } else {
      const [t] = await db
        .insert(teamSeason)
        .values({
          leagueSeasonId: input.leagueSeasonId,
          franchiseId,
          externalRosterId: key,
          name: teamName,
          avatar: avatarUrl(
            typeof user?.metadata?.avatar === "string" ? user.metadata.avatar : user?.avatar
          ),
          ...base,
        })
        .returning({ id: teamSeason.id });
      teamSeasonId = t!.id;
    }
    result.teamSeasonByRoster.set(roster.roster_id, teamSeasonId);
    result.franchiseByRoster.set(roster.roster_id, franchiseId);

    // Managers: keep admin-edited rows; only add/transition when the owner differs.
    const current = await db
      .select()
      .from(teamSeasonManager)
      .where(eq(teamSeasonManager.teamSeasonId, teamSeasonId));
    const primary = current.find((m) => m.role === "primary" && m.toWeek === null);
    if (
      ownerManager !== undefined &&
      primary?.managerId !== ownerManager &&
      (!input.frozen || current.length === 0)
    ) {
      if (primary) {
        await db
          .update(teamSeasonManager)
          .set({ toWeek: Math.max(0, (input.currentWeek ?? 1) - 1) })
          .where(
            and(
              eq(teamSeasonManager.teamSeasonId, teamSeasonId),
              eq(teamSeasonManager.managerId, primary.managerId)
            )
          );
      }
      await db
        .insert(teamSeasonManager)
        .values({
          teamSeasonId,
          managerId: ownerManager,
          role: "primary",
          fromWeek: primary ? (input.currentWeek ?? 1) : null,
        })
        .onConflictDoUpdate({
          target: [teamSeasonManager.teamSeasonId, teamSeasonManager.managerId],
          set: { role: "primary", toWeek: null },
        });
    }
    for (const co of roster.co_owners ?? []) {
      const coManager = managers.get(co);
      if (coManager === undefined || current.some((m) => m.managerId === coManager)) continue;
      await db
        .insert(teamSeasonManager)
        .values({ teamSeasonId, managerId: coManager, role: "co" })
        .onConflictDoNothing();
    }
  }
  return result;
}
