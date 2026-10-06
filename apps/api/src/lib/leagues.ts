import { league, leagueSeason, and, eq } from "@rfp/db";
import type { Db } from "@rfp/db";
import { HttpError } from "./http";

export async function leagueBySlug(db: Db, slug: string) {
  const [row] = await db
    .select()
    .from(league)
    .where(and(eq(league.slug, slug), eq(league.enabled, true)));
  if (!row) throw new HttpError(404, `unknown league ${slug}`);
  return row;
}

export async function seasonById(db: Db, id: number) {
  if (!Number.isInteger(id)) throw new HttpError(400, "invalid season id");
  const [row] = await db
    .select({ season: leagueSeason, league: league })
    .from(leagueSeason)
    .innerJoin(league, eq(league.id, leagueSeason.leagueId))
    .where(and(eq(leagueSeason.id, id), eq(leagueSeason.enabled, true), eq(league.enabled, true)));
  if (!row) throw new HttpError(404, `unknown season ${id}`);
  return row;
}

export const isActive = (status: string) => status !== "complete";
