import { readFileSync } from "node:fs";
import { gunzipSync } from "node:zlib";
import { league, leagueSeason, rawPayload, syncRun, and, eq, type Db } from "@rfp/db";
import { espnBundle } from "@rfp/core/admin";
import { hashParams } from "../lib/raw-store";
import { importEspnSeason, type EspnImportSummary } from "./normalize";

/** What the admin import does, for a bundle file on disk: archive the responses verbatim, then normalize. */
export async function importEspnFile(db: Db, path: string): Promise<EspnImportSummary> {
  const raw = readFileSync(path);
  const text = raw[0] === 0x1f && raw[1] === 0x8b ? gunzipSync(raw) : raw;
  const { manifest, responses } = espnBundle.parse(JSON.parse(text.toString("utf8")));
  const [target] = await db
    .select({ id: leagueSeason.id })
    .from(leagueSeason)
    .innerJoin(league, eq(league.id, leagueSeason.leagueId))
    .where(
      and(
        eq(league.slug, manifest.league),
        eq(leagueSeason.year, manifest.year),
        eq(leagueSeason.source, "espn")
      )
    );
  if (!target) throw new Error(`No ESPN season ${manifest.year} in league "${manifest.league}"`);
  const bundle = `${manifest.league}-${manifest.year}-${manifest.scrapedAt}`;
  const [already] = await db
    .select({ id: rawPayload.id })
    .from(rawPayload)
    .where(and(eq(rawPayload.source, "espn"), eq(rawPayload.bundle, bundle)))
    .limit(1);
  if (!already) {
    for (let i = 0; i < responses.length; i += 200)
      await db.insert(rawPayload).values(
        responses.slice(i, i + 200).map((r) => ({
          source: "espn" as const,
          endpoint: r.endpoint,
          params: r.params,
          paramsHash: hashParams(r.params),
          httpStatus: r.status,
          payload: r.payload ?? null,
          bundle,
        }))
      );
  }
  const [run] = await db
    .insert(syncRun)
    .values({ kind: "import_espn", leagueSeasonId: target.id, triggeredBy: "cli" })
    .returning({ id: syncRun.id });
  try {
    const summary = await importEspnSeason(db, target.id);
    await db
      .update(syncRun)
      .set({
        status: "success",
        finishedAt: new Date(),
        stats: { ...summary, derive: undefined } as unknown as Record<string, unknown>,
      })
      .where(eq(syncRun.id, run!.id));
    return summary;
  } catch (err) {
    await db
      .update(syncRun)
      .set({ status: "failed", finishedAt: new Date(), log: String(err) })
      .where(eq(syncRun.id, run!.id));
    throw err;
  }
}
