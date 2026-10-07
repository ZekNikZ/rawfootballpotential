import { player, type Db } from "@rfp/db";
import { inArray, sql } from "@rfp/db";
import { log } from "../lib/log";
import type { FreshnessPolicy } from "../lib/raw-store";
import type { SleeperClient } from "./client";
import type { SleeperPlayer } from "./schemas";

const chunk = <T>(arr: readonly T[], size: number): T[][] => {
  const out: T[][] = [];
  for (let i = 0; i < arr.length; i += size) out.push(arr.slice(i, i + size));
  return out;
};

const displayName = (p: SleeperPlayer): string =>
  p.full_name || [p.first_name, p.last_name].filter(Boolean).join(" ") || `Player ${p.player_id}`;

/** Upsert the current player dump (Sleeper asks for at most one call a day; the client caches it). */
export async function syncPlayers(
  db: Db,
  client: SleeperClient,
  policy: FreshnessPolicy
): Promise<number> {
  const players = await client.playersNfl(policy);
  if (!players) throw new Error("Sleeper returned no player dump");
  for (const batch of chunk(players, 1000)) {
    await db
      .insert(player)
      .values(
        batch.map((p) => ({
          sleeperId: p.player_id,
          espnId: p.espn_id ?? null,
          gsisId: p.gsis_id ?? null,
          fullName: displayName(p),
          position: p.position ?? null,
          fantasyPositions: p.fantasy_positions ?? null,
          nflTeam: p.team ?? null,
          injuryStatus: p.injury_status ?? null,
          status: p.status ?? null,
          active: p.active ?? null,
        }))
      )
      .onConflictDoUpdate({
        target: player.sleeperId,
        set: {
          espnId: sql`coalesce(excluded.espn_id, ${player.espnId})`,
          gsisId: sql`coalesce(excluded.gsis_id, ${player.gsisId})`,
          fullName: sql`excluded.full_name`,
          position: sql`excluded.position`,
          fantasyPositions: sql`excluded.fantasy_positions`,
          nflTeam: sql`excluded.nfl_team`,
          injuryStatus: sql`excluded.injury_status`,
          status: sql`excluded.status`,
          active: sql`excluded.active`,
          updatedAt: sql`now()`,
        },
      });
  }
  log.info({ count: players.length }, "players synced");
  return players.length;
}

/** Resolves Sleeper player ids to player.id, creating placeholders for ids missing from the dump. */
export class PlayerResolver {
  private cache = new Map<string, number>();
  readonly placeholders: string[] = [];
  constructor(private readonly db: Db) {}

  async resolve(sleeperIds: Iterable<string>): Promise<Map<string, number>> {
    const wanted = [...new Set(sleeperIds)].filter((id) => id !== "0" && !this.cache.has(id));
    for (const batch of chunk(wanted, 1000)) {
      const rows = await this.db
        .select({ id: player.id, sleeperId: player.sleeperId })
        .from(player)
        .where(inArray(player.sleeperId, batch));
      for (const r of rows) if (r.sleeperId) this.cache.set(r.sleeperId, r.id);
      const missing = batch.filter((id) => !this.cache.has(id));
      if (missing.length > 0) {
        const created = await this.db
          .insert(player)
          .values(missing.map((id) => ({ sleeperId: id, fullName: `Unknown player ${id}` })))
          .onConflictDoNothing()
          .returning({ id: player.id, sleeperId: player.sleeperId });
        for (const c of created) if (c.sleeperId) this.cache.set(c.sleeperId, c.id);
        this.placeholders.push(...missing);
        log.warn(
          { count: missing.length, sample: missing.slice(0, 5) },
          "players missing from the Sleeper dump"
        );
      }
    }
    return this.cache;
  }

  get(sleeperId: string): number {
    const id = this.cache.get(sleeperId);
    if (id === undefined) throw new Error(`player ${sleeperId} was not resolved`);
    return id;
  }
}
