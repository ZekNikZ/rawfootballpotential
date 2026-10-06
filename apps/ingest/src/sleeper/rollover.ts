import {
  league,
  leagueSeason,
  managerIdentity,
  teamSeason,
  teamSeasonManager,
  desc,
  eq,
  and,
  inArray,
  type Db,
} from "@rfp/db";
import { hours } from "../lib/raw-store";
import { log } from "../lib/log";
import type { SleeperClient } from "./client";
import { bootstrapSleeperSeason } from "./sync";

/**
 * Finds league seasons that Sleeper created since our newest one (`previous_league_id` points at it) and adds
 * them. Sleeper has no "next league" endpoint, so we ask for the leagues of the newest season's owners in the
 * following year. Returns the new league_season ids; team seasons and franchises are created by the season sync
 * (redraft: by manager, dynasty: by roster id via the previous season).
 */
export async function seasonRollover(db: Db, client: SleeperClient): Promise<number[]> {
  const created: number[] = [];
  const leagues = await db.select().from(league).where(eq(league.enabled, true));
  for (const lg of leagues) {
    for (;;) {
      const [latest] = await db
        .select()
        .from(leagueSeason)
        .where(and(eq(leagueSeason.leagueId, lg.id), eq(leagueSeason.source, "sleeper")))
        .orderBy(desc(leagueSeason.year))
        .limit(1);
      if (!latest) break;
      const owners = await db
        .selectDistinct({ userId: managerIdentity.externalUserId })
        .from(managerIdentity)
        .innerJoin(teamSeasonManager, eq(teamSeasonManager.managerId, managerIdentity.managerId))
        .innerJoin(teamSeason, eq(teamSeason.id, teamSeasonManager.teamSeasonId))
        .where(
          and(
            eq(teamSeason.leagueSeasonId, latest.id),
            eq(managerIdentity.source, "sleeper"),
            inArray(teamSeasonManager.role, ["primary"])
          )
        );
      let next: string | undefined;
      for (const o of owners) {
        const leagues = await client.userLeagues(o.userId, latest.year + 1, hours(12));
        next = leagues?.find((l) => l.previous_league_id === latest.externalId)?.league_id;
        if (next) break;
      }
      if (!next) break;
      const id = await bootstrapSleeperSeason(db, client, { leagueId: lg.id, externalId: next });
      log.info(
        { league: lg.slug, year: latest.year + 1, externalId: next },
        "season rollover: new league season"
      );
      created.push(id);
    }
  }
  return created;
}
