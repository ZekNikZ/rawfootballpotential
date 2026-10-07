import { gunzipSync } from "node:zlib";
import { hashParams, league, leagueSeason, rawPayload, and, eq } from "@rfp/db";
import { espnBundle } from "@rfp/core/admin";
import multipart from "@fastify/multipart";
import type { FastifyInstance } from "fastify";
import { HttpError } from "../lib/http";
import { audit, type AdminDeps } from "./context";

const MAX_BUNDLE_BYTES = 150 * 1024 * 1024;
const GZIP_MAGIC = [0x1f, 0x8b];

/**
 * ESPN season bundles (doc §5) are uploaded here and archived verbatim in `raw_payload` (the scraped data is
 * irreplaceable), then queues the `import-espn` job, which normalizes the newest stored bundle for the season.
 */
export async function registerImportRoutes(app: FastifyInstance, deps: AdminDeps) {
  const { db } = deps;
  await app.register(multipart, { limits: { fileSize: MAX_BUNDLE_BYTES, files: 1 } });

  app.post("/import/espn", async (req) => {
    const file = await req.file();
    if (!file) throw new HttpError(400, "Attach the bundle file");
    const buf = await file.toBuffer();
    const raw = buf[0] === GZIP_MAGIC[0] && buf[1] === GZIP_MAGIC[1] ? gunzipSync(buf) : buf;
    let json: unknown;
    try {
      json = JSON.parse(raw.toString("utf8"));
    } catch {
      throw new HttpError(400, "The file is not a JSON (or gzipped JSON) bundle");
    }
    const parsed = espnBundle.safeParse(json);
    if (!parsed.success) {
      const issue = parsed.error.issues[0];
      throw new HttpError(400, `Not a valid bundle: ${issue?.path.join(".")} ${issue?.message}`);
    }
    const { manifest, responses } = parsed.data;

    const [target] = await db
      .select({ season: leagueSeason })
      .from(leagueSeason)
      .innerJoin(league, eq(league.id, leagueSeason.leagueId))
      .where(
        and(
          eq(league.slug, manifest.league),
          eq(leagueSeason.year, manifest.year),
          eq(leagueSeason.source, "espn")
        )
      );
    if (!target)
      throw new HttpError(404, `No ESPN season ${manifest.year} in league "${manifest.league}"`);
    // Seasons migrated from Mongo carry a placeholder id; the first bundle brings the real ESPN league id.
    const adopt = target.season.externalId.startsWith("mongo:");
    if (!adopt && target.season.externalId !== manifest.espnLeagueId)
      throw new HttpError(400, "The bundle's ESPN league id doesn't match that season");
    if (adopt)
      await db
        .update(leagueSeason)
        .set({ externalId: manifest.espnLeagueId })
        .where(eq(leagueSeason.id, target.season.id));

    const bundleName = `${manifest.league}-${manifest.year}-${manifest.scrapedAt}`;
    for (let i = 0; i < responses.length; i += 200) {
      await db.insert(rawPayload).values(
        responses.slice(i, i + 200).map((r) => ({
          source: "espn" as const,
          endpoint: r.endpoint,
          params: r.params,
          paramsHash: hashParams(r.params),
          httpStatus: r.status,
          payload: r.payload ?? null,
          bundle: bundleName,
        }))
      );
    }
    const stats = {
      bundle: bundleName,
      responses: responses.length,
      endpoints: [...new Set(responses.map((r) => r.endpoint))].length,
      normalized: true,
    };
    // The worker normalizes the stored bundle and derives (it records its own run, with the import report).
    await deps.jobs.send("import-espn", {
      leagueSeasonId: target.season.id,
      triggeredBy: req.admin!.id,
    });
    await audit(db, req.admin!, "import.espn", "league_season", target.season.id, null, stats);
    return {
      ...stats,
      leagueSeasonId: target.season.id,
      note: "Bundle archived. Importing it now: the result appears under Jobs.",
    };
  });
}
