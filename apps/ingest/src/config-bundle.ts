import {
  bumpDataVersion,
  franchise,
  league,
  leagueSeason,
  leagueThreshold,
  manager,
  managerIdentity,
  override,
  player,
  playerIdMap,
  recordConfig,
  siteConfig,
  teamSeason,
  teamSeasonManager,
  unmatchedPlayer,
  and,
  asc,
  eq,
  inArray,
  isNull,
  sql,
  type Db,
} from "@rfp/db";
import {
  CONFIG_BUNDLE_FORMAT,
  CONFIG_BUNDLE_VERSION,
  DATA_FLAGS,
  type ConfigBundle,
  type DataFlag,
} from "@rfp/core/admin";

// Export and import of everything an admin sets by hand (see `configBundle` in @rfp/core/admin for the file shape).
// The file is keyed by league slug, season year, Sleeper / ESPN ids and player source ids, never by database id, so
// it loads into any database. Import is idempotent and safe to run before the first sync (it creates the leagues,
// seasons and people the sync then adopts) and again afterwards (it applies what needed synced data: franchise
// groupings and corrections on seasons that did not exist yet).

type PlayerRef = { sleeperId: string | null; espnId: string | null; gsisId: string | null };

const OVERRIDE_PREFIX = /^ls:(\d+):(.*)$/s;

/** The `ls:<id>:rest` key of a correction as league slug, year and the rest; null when it is not season-bound. */
export function splitOverrideKey(
  entityId: string,
  seasons: ReadonlyMap<number, { league: string; year: number }>
): { league: string; year: number; rest: string } | null {
  const m = OVERRIDE_PREFIX.exec(entityId);
  if (!m) return null;
  const season = seasons.get(Number(m[1]));
  return season ? { league: season.league, year: season.year, rest: m[2]! } : null;
}

/** The inverse of {@link splitOverrideKey} for a league season id of this database. */
export function joinOverrideKey(leagueSeasonId: number, rest: string): string {
  return `ls:${leagueSeasonId}:${rest}`;
}

const playerRef = (p: PlayerRef | undefined): PlayerRef | null =>
  p ? { sleeperId: p.sleeperId, espnId: p.espnId, gsisId: p.gsisId } : null;

export async function exportConfigBundle(db: Db): Promise<ConfigBundle> {
  const leagues = await db.select().from(league).orderBy(asc(league.displayOrder), asc(league.id));
  const seasons = await db
    .select()
    .from(leagueSeason)
    .orderBy(asc(leagueSeason.year), asc(leagueSeason.id));
  const slugOf = new Map(leagues.map((l) => [l.id, l.slug]));
  const seasonById = new Map(
    seasons.map((s) => [s.id, { league: slugOf.get(s.leagueId) ?? "", year: s.year }])
  );
  const thresholds = await db.select().from(leagueThreshold);
  const franchises = await db.select().from(franchise).orderBy(asc(franchise.id));
  const teams = await db
    .select({
      franchiseId: teamSeason.franchiseId,
      leagueSeasonId: teamSeason.leagueSeasonId,
      roster: teamSeason.externalRosterId,
    })
    .from(teamSeason);

  const players = await db
    .select({
      id: player.id,
      sleeperId: player.sleeperId,
      espnId: player.espnId,
      gsisId: player.gsisId,
    })
    .from(player)
    .where(
      inArray(
        player.id,
        sql`(select player_id from player_id_map where manual and player_id is not null union select resolved_player_id from unmatched_player where resolved_player_id is not null)`
      )
    );
  const playerById = new Map(players.map((p) => [p.id, p]));

  const recordRows = await db.select().from(recordConfig);
  const managers = await db.select().from(manager).orderBy(asc(manager.name), asc(manager.id));
  const identities = await db.select().from(managerIdentity).orderBy(asc(managerIdentity.id));
  const overrides = await db.select().from(override).orderBy(asc(override.id));
  const links = await db
    .select()
    .from(playerIdMap)
    .where(eq(playerIdMap.manual, true))
    .orderBy(asc(playerIdMap.id));
  const unmatched = await db.select().from(unmatchedPlayer).orderBy(asc(unmatchedPlayer.id));
  const site = await db.select().from(siteConfig).orderBy(asc(siteConfig.key));

  return {
    format: CONFIG_BUNDLE_FORMAT,
    version: CONFIG_BUNDLE_VERSION,
    exportedAt: new Date().toISOString(),
    site: site.map((r) => ({ key: r.key, value: r.value })),
    leagues: leagues.map((l) => ({
      slug: l.slug,
      name: l.name,
      type: l.type,
      color: l.color,
      displayOrder: l.displayOrder,
      enabled: l.enabled,
      seasons: seasons
        .filter((s) => s.leagueId === l.id)
        .map((s) => ({
          year: s.year,
          source: s.source,
          externalId: s.externalId,
          enabled: s.enabled,
          scoringOverrides: s.scoringOverrides,
          lockedFlags: Object.fromEntries(
            s.lockedFlags
              .filter((f): f is DataFlag => (DATA_FLAGS as readonly string[]).includes(f))
              .map((f) => [f, s[f]])
          ),
        })),
      thresholds: thresholds
        .filter((t) => t.leagueId === l.id)
        .flatMap((t): { year: number | null; key: string; value: number }[] => {
          if (t.leagueSeasonId === null) return [{ year: null, key: t.key, value: t.value }];
          const year = seasonById.get(t.leagueSeasonId)?.year;
          return year === undefined ? [] : [{ year, key: t.key, value: t.value }];
        }),
      franchises: franchises
        .filter((f) => f.leagueId === l.id)
        .map((f) => ({
          name: f.name,
          teamSeasons: teams
            .filter((t) => t.franchiseId === f.id)
            .map((t) => ({
              year: seasonById.get(t.leagueSeasonId)?.year ?? 0,
              roster: t.roster,
            }))
            .sort((a, b) => a.year - b.year),
        }))
        .filter((f) => f.teamSeasons.length > 0),
    })),
    recordConfig: recordRows.map((r) => ({
      league: r.leagueId === null ? null : (slugOf.get(r.leagueId) ?? null),
      recordId: r.recordId,
      visible: r.visible,
      sortOrder: r.sortOrder,
      featured: r.featured,
    })),
    managers: managers.map((m) => ({
      name: m.name,
      avatar: m.avatar,
      identities: identities
        .filter((i) => i.managerId === m.id)
        .map((i) => ({ source: i.source, externalUserId: i.externalUserId })),
    })),
    overrides: overrides.map((o) => {
      const target = splitOverrideKey(o.entityId, seasonById);
      return {
        entity: o.entity,
        target,
        entityId: target ? null : o.entityId,
        field: o.field,
        value: o.value,
        reason: o.reason,
        active: o.active,
        createdAt: o.createdAt.toISOString(),
      };
    }),
    playerLinks: links.map((l) => ({
      sleeperId: l.sleeperId,
      espnId: l.espnId,
      gsisId: l.gsisId,
      yahooId: l.yahooId,
      pfrId: l.pfrId,
      name: l.name,
      player: l.playerId === null ? null : playerRef(playerById.get(l.playerId)),
    })),
    unmatchedPlayers: unmatched
      .filter((u) => u.status !== "open")
      .map((u) => ({
        source: u.source,
        externalId: u.externalId,
        name: u.name,
        position: u.position,
        nflTeam: u.nflTeam,
        status: u.status,
        resolvedPlayer:
          u.resolvedPlayerId === null ? null : playerRef(playerById.get(u.resolvedPlayerId)),
      })),
  };
}

export interface ImportOptions {
  /** Work out and report everything, then roll back. Seasons that do not exist yet are not created. */
  dryRun?: boolean;
  /** Creates the league season of a Sleeper league id (a call to Sleeper). Without it, missing seasons are reported. */
  bootstrapSeason?: (leagueId: number, externalId: string) => Promise<number>;
  log?: (message: string) => void;
}

export interface ImportReport {
  dryRun: boolean;
  /** What was created or changed, by kind. */
  changed: Record<string, number>;
  /** Things the file holds that could not be applied yet (a season, team or player that does not exist here). */
  notes: string[];
}

class DryRunRollback extends Error {}

/** Shallow equality for the JSON-ish values compared during import. */
const same = (a: unknown, b: unknown) => JSON.stringify(a) === JSON.stringify(b);

export async function importConfigBundle(
  db: Db,
  bundle: ConfigBundle,
  options: ImportOptions = {}
): Promise<ImportReport> {
  const dryRun = options.dryRun ?? false;
  const log = options.log ?? (() => {});
  const changed: Record<string, number> = {};
  const notes: string[] = [];
  const count = (kind: string, n = 1) => {
    changed[kind] = (changed[kind] ?? 0) + n;
  };

  // Leagues and their seasons first, outside the transaction: creating a season calls Sleeper and takes a while.
  const leagueIds = new Map<string, number>();
  for (const lg of bundle.leagues) {
    const [existing] = await db.select().from(league).where(eq(league.slug, lg.slug));
    if (existing) {
      leagueIds.set(lg.slug, existing.id);
      continue;
    }
    if (dryRun) {
      notes.push(
        `would create league ${lg.slug} with ${lg.seasons.length} season(s): ${lg.seasons.map((x) => x.year).join(", ")}`
      );
      count("leagues");
      continue;
    }
    const [row] = await db
      .insert(league)
      .values({
        slug: lg.slug,
        name: lg.name,
        type: lg.type,
        color: lg.color,
        displayOrder: lg.displayOrder,
        enabled: lg.enabled,
      })
      .returning({ id: league.id });
    leagueIds.set(lg.slug, row!.id);
    count("leagues");
  }
  for (const lg of bundle.leagues) {
    const leagueId = leagueIds.get(lg.slug);
    if (leagueId === undefined) continue;
    const have = await db
      .select({ year: leagueSeason.year })
      .from(leagueSeason)
      .where(eq(leagueSeason.leagueId, leagueId));
    const years = new Set(have.map((s) => s.year));
    for (const s of [...lg.seasons].sort((a, b) => a.year - b.year)) {
      if (years.has(s.year)) continue;
      if (s.source !== "sleeper") {
        notes.push(
          `${lg.slug} ${s.year}: an ESPN season; import its bundle (pnpm ingest espn <bundle>), then run this import again`
        );
        continue;
      }
      if (dryRun || !options.bootstrapSeason) {
        notes.push(
          `${lg.slug} ${s.year}: ${dryRun ? "would be created from" : "not created, needs"} Sleeper league ${s.externalId}`
        );
        continue;
      }
      log(`creating ${lg.slug} ${s.year} from Sleeper league ${s.externalId}`);
      await options.bootstrapSeason(leagueId, s.externalId);
      count("seasons");
    }
  }

  try {
    await db.transaction(async (tx) => {
      // A transaction exposes the same query API; bumpDataVersion only uses that.
      const q = tx as unknown as Db;
      const touchedSeasons = new Set<number>();

      // ---- site settings ----
      for (const row of bundle.site) {
        const [existing] = await q.select().from(siteConfig).where(eq(siteConfig.key, row.key));
        let value = row.value;
        if (row.key === "changelog" && Array.isArray(existing?.value) && Array.isArray(value)) {
          // Keep the versions this database already has; the file's entry wins for a version both have.
          const incoming = value as { version?: string; date?: string }[];
          const versions = new Set(incoming.map((e) => e.version));
          const kept = (existing.value as { version?: string; date?: string }[]).filter(
            (e) => !versions.has(e.version)
          );
          value = [...incoming, ...kept].sort((a, b) =>
            String(b.date ?? "").localeCompare(String(a.date ?? ""))
          );
        }
        if (existing && same(existing.value, value)) continue;
        await q
          .insert(siteConfig)
          .values({ key: row.key, value })
          .onConflictDoUpdate({
            target: siteConfig.key,
            set: { value, updatedAt: new Date() },
          });
        count("site settings");
      }

      // ---- leagues, seasons, thresholds ----
      const seasonIds = new Map<string, number>(); // "slug:year" -> league_season id
      for (const lg of bundle.leagues) {
        const leagueId = leagueIds.get(lg.slug);
        if (leagueId === undefined) continue;
        const [current] = await q.select().from(league).where(eq(league.id, leagueId));
        if (
          current &&
          (current.name !== lg.name ||
            current.type !== lg.type ||
            current.color !== lg.color ||
            current.displayOrder !== lg.displayOrder ||
            current.enabled !== lg.enabled)
        ) {
          await q
            .update(league)
            .set({
              name: lg.name,
              color: lg.color,
              displayOrder: lg.displayOrder,
              enabled: lg.enabled,
            })
            .where(eq(league.id, leagueId));
          count("leagues");
        }

        const localSeasons = await q
          .select()
          .from(leagueSeason)
          .where(eq(leagueSeason.leagueId, leagueId));
        for (const ls of localSeasons) {
          seasonIds.set(`${lg.slug}:${ls.year}`, ls.id);
          touchedSeasons.add(ls.id);
        }
        for (const s of lg.seasons) {
          const local = localSeasons.find((x) => x.year === s.year);
          if (!local) continue;
          const set: Partial<typeof leagueSeason.$inferInsert> = {};
          if (local.enabled !== s.enabled) set.enabled = s.enabled;
          if (!same(local.scoringOverrides, s.scoringOverrides)) {
            set.scoringOverrides = s.scoringOverrides;
            if (local.lastCompletedWeek > 0)
              notes.push(
                `${lg.slug} ${s.year}: scoring overrides changed on a season that already has data; run: pnpm ingest job recompute --season ${lg.slug}-${s.year}`
              );
          }
          const locked = new Set(local.lockedFlags);
          for (const [flag, value] of Object.entries(s.lockedFlags) as [DataFlag, boolean][]) {
            if (local[flag] !== value) (set as Record<string, unknown>)[flag] = value;
            locked.add(flag);
          }
          if (locked.size !== local.lockedFlags.length) set.lockedFlags = [...locked];
          if (Object.keys(set).length > 0) {
            await q.update(leagueSeason).set(set).where(eq(leagueSeason.id, local.id));
            count("seasons");
          }
        }

        for (const t of lg.thresholds) {
          const seasonId = t.year === null ? null : seasonIds.get(`${lg.slug}:${t.year}`);
          if (seasonId === undefined) {
            notes.push(`${lg.slug}: threshold ${t.key} for ${t.year} skipped, no such season yet`);
            continue;
          }
          const [existing] = await q
            .select()
            .from(leagueThreshold)
            .where(
              and(
                eq(leagueThreshold.leagueId, leagueId),
                seasonId === null
                  ? isNull(leagueThreshold.leagueSeasonId)
                  : eq(leagueThreshold.leagueSeasonId, seasonId),
                eq(leagueThreshold.key, t.key)
              )
            );
          if (existing && existing.value === t.value) continue;
          if (existing)
            await q
              .update(leagueThreshold)
              .set({ value: t.value })
              .where(eq(leagueThreshold.id, existing.id));
          else
            await q
              .insert(leagueThreshold)
              .values({ leagueId, leagueSeasonId: seasonId, key: t.key, value: t.value });
          count("thresholds");
        }
      }

      // ---- record settings ----
      for (const r of bundle.recordConfig) {
        const leagueId = r.league === null ? null : leagueIds.get(r.league);
        if (leagueId === undefined) {
          notes.push(`record ${r.recordId}: league ${r.league} is not here, setting skipped`);
          continue;
        }
        const [existing] = await q
          .select()
          .from(recordConfig)
          .where(
            and(
              leagueId === null
                ? isNull(recordConfig.leagueId)
                : eq(recordConfig.leagueId, leagueId),
              eq(recordConfig.recordId, r.recordId)
            )
          );
        const values = { visible: r.visible, sortOrder: r.sortOrder, featured: r.featured };
        if (
          existing &&
          existing.visible === r.visible &&
          existing.sortOrder === r.sortOrder &&
          existing.featured === r.featured
        )
          continue;
        if (existing)
          await q.update(recordConfig).set(values).where(eq(recordConfig.id, existing.id));
        else await q.insert(recordConfig).values({ leagueId, recordId: r.recordId, ...values });
        count("record settings");
      }

      // ---- managers: matched by Sleeper / ESPN identity, so a sync later adopts them ----
      for (const m of bundle.managers) {
        const found = m.identities.length
          ? await q
              .select({ managerId: managerIdentity.managerId })
              .from(managerIdentity)
              .where(
                sql`(${managerIdentity.source}, ${managerIdentity.externalUserId}) in (${sql.join(
                  m.identities.map((i) => sql`(${i.source}, ${i.externalUserId})`),
                  sql`, `
                )})`
              )
          : [];
        const ids = [...new Set(found.map((f) => f.managerId))].sort((a, b) => a - b);
        let managerId = ids[0];
        if (managerId === undefined) {
          const [row] = await q
            .insert(manager)
            .values({ name: m.name, avatar: m.avatar })
            .returning({ id: manager.id });
          managerId = row!.id;
          count("managers");
        } else {
          const [current] = await q.select().from(manager).where(eq(manager.id, managerId));
          if (current && (current.name !== m.name || current.avatar !== m.avatar)) {
            await q
              .update(manager)
              .set({ name: m.name, avatar: m.avatar })
              .where(eq(manager.id, managerId));
            count("managers");
          }
          // Accounts the file says are one person but a sync created as several managers: merge them.
          for (const dup of ids.slice(1)) {
            await q
              .update(managerIdentity)
              .set({ managerId })
              .where(eq(managerIdentity.managerId, dup));
            await q.execute(sql`
              delete from team_season_manager a
              where a.manager_id = ${dup}
                and exists (select 1 from team_season_manager b where b.team_season_id = a.team_season_id and b.manager_id = ${managerId})`);
            await q
              .update(teamSeasonManager)
              .set({ managerId })
              .where(eq(teamSeasonManager.managerId, dup));
            await q.delete(manager).where(eq(manager.id, dup));
            count("managers merged");
          }
        }
        for (const i of m.identities) {
          const inserted = await q
            .insert(managerIdentity)
            .values({ managerId, source: i.source, externalUserId: i.externalUserId })
            .onConflictDoNothing()
            .returning({ id: managerIdentity.id });
          if (inserted.length) count("identities");
        }
      }

      // ---- franchises: names, and which team seasons belong together (needs synced seasons) ----
      for (const lg of bundle.leagues) {
        const leagueId = leagueIds.get(lg.slug);
        if (leagueId === undefined) continue;
        const local = await q
          .select({
            id: teamSeason.id,
            franchiseId: teamSeason.franchiseId,
            leagueSeasonId: teamSeason.leagueSeasonId,
            roster: teamSeason.externalRosterId,
            year: leagueSeason.year,
          })
          .from(teamSeason)
          .innerJoin(leagueSeason, eq(leagueSeason.id, teamSeason.leagueSeasonId))
          .where(eq(leagueSeason.leagueId, leagueId));
        let pending = 0;
        for (const f of lg.franchises) {
          const members = f.teamSeasons
            .map((t) => local.find((x) => x.year === t.year && x.roster === t.roster))
            .filter((x): x is (typeof local)[number] => x !== undefined)
            .sort((a, b) => a.year - b.year);
          if (members.length < f.teamSeasons.length) pending++;
          if (members.length === 0) continue;
          const targetId = members[0]!.franchiseId;
          if (f.name !== null) {
            const [current] = await q.select().from(franchise).where(eq(franchise.id, targetId));
            if (current && current.name !== f.name) {
              await q.update(franchise).set({ name: f.name }).where(eq(franchise.id, targetId));
              count("franchises");
            }
          }
          for (const t of members.slice(1)) {
            if (t.franchiseId === targetId) continue;
            const clash = local.some(
              (x) => x.leagueSeasonId === t.leagueSeasonId && x.franchiseId === targetId
            );
            if (clash) {
              notes.push(
                `${lg.slug} ${t.year}: team ${t.roster} could not join its franchise (that franchise already has a team that season)`
              );
              continue;
            }
            await q
              .update(teamSeason)
              .set({ franchiseId: targetId })
              .where(eq(teamSeason.id, t.id));
            t.franchiseId = targetId;
            touchedSeasons.add(t.leagueSeasonId);
            count("team seasons moved");
          }
        }
        if (pending > 0)
          notes.push(
            `${lg.slug}: ${pending} franchise(s) have team seasons that are not synced yet; run this import again after the sync`
          );
      }

      // ---- corrections ----
      for (const o of bundle.overrides) {
        let entityId = o.entityId;
        if (o.target) {
          const seasonId = seasonIds.get(`${o.target.league}:${o.target.year}`);
          if (seasonId === undefined) {
            notes.push(
              `correction on ${o.target.league} ${o.target.year} (${o.field}) skipped, no such season yet`
            );
            continue;
          }
          entityId = joinOverrideKey(seasonId, o.target.rest);
        }
        if (entityId === null) continue;
        const [existing] = await q
          .select()
          .from(override)
          .where(
            and(
              eq(override.entity, o.entity),
              eq(override.entityId, entityId),
              eq(override.field, o.field)
            )
          );
        if (
          existing &&
          same(existing.value, o.value) &&
          existing.reason === o.reason &&
          existing.active === o.active
        )
          continue;
        if (existing)
          await q
            .update(override)
            .set({ value: o.value, reason: o.reason, active: o.active })
            .where(eq(override.id, existing.id));
        else
          await q.insert(override).values({
            entity: o.entity,
            entityId,
            field: o.field,
            value: o.value,
            reason: o.reason,
            active: o.active,
            createdAt: new Date(o.createdAt),
          });
        count("corrections");
        const m = OVERRIDE_PREFIX.exec(entityId);
        if (m) touchedSeasons.add(Number(m[1]));
      }

      // ---- players ----
      const findPlayer = async (ref: PlayerRef | null): Promise<number | null> => {
        if (!ref) return null;
        for (const [col, value] of [
          [player.sleeperId, ref.sleeperId],
          [player.gsisId, ref.gsisId],
          [player.espnId, ref.espnId],
        ] as const) {
          if (!value) continue;
          const [row] = await q
            .select({ id: player.id })
            .from(player)
            .where(eq(col, value))
            .limit(1);
          if (row) return row.id;
        }
        return null;
      };
      let playersPending = 0;
      for (const l of bundle.playerLinks) {
        const key =
          l.sleeperId !== null
            ? eq(playerIdMap.sleeperId, l.sleeperId)
            : l.espnId !== null
              ? eq(playerIdMap.espnId, l.espnId)
              : l.gsisId !== null
                ? eq(playerIdMap.gsisId, l.gsisId)
                : null;
        if (!key) continue;
        const playerId = await findPlayer(l.player);
        if (l.player && playerId === null) playersPending++;
        const [existing] = await q
          .select()
          .from(playerIdMap)
          .where(and(key, eq(playerIdMap.manual, true)));
        const values = {
          playerId,
          sleeperId: l.sleeperId,
          espnId: l.espnId,
          gsisId: l.gsisId,
          yahooId: l.yahooId,
          pfrId: l.pfrId,
          name: l.name,
          manual: true,
        };
        if (existing && existing.playerId === playerId) continue;
        if (existing)
          await q.update(playerIdMap).set(values).where(eq(playerIdMap.id, existing.id));
        else await q.insert(playerIdMap).values(values);
        count("player links");
      }
      for (const u of bundle.unmatchedPlayers) {
        const resolvedPlayerId = await findPlayer(u.resolvedPlayer);
        if (u.resolvedPlayer && resolvedPlayerId === null) playersPending++;
        const [existing] = await q
          .select()
          .from(unmatchedPlayer)
          .where(
            and(eq(unmatchedPlayer.source, u.source), eq(unmatchedPlayer.externalId, u.externalId))
          );
        if (
          existing &&
          existing.status === u.status &&
          existing.resolvedPlayerId === resolvedPlayerId
        )
          continue;
        const values = {
          name: u.name,
          position: u.position,
          nflTeam: u.nflTeam,
          status: u.status,
          resolvedPlayerId,
        };
        if (existing)
          await q.update(unmatchedPlayer).set(values).where(eq(unmatchedPlayer.id, existing.id));
        else
          await q
            .insert(unmatchedPlayer)
            .values({ source: u.source, externalId: u.externalId, ...values });
        count("unmatched players");
      }
      if (playersPending > 0)
        notes.push(
          `${playersPending} player link(s) point at players that are not loaded yet; run pnpm ingest players, then this import again`
        );

      if (Object.keys(changed).length > 0) await bumpDataVersion(q, [...touchedSeasons]);
      if (dryRun) throw new DryRunRollback();
    });
  } catch (err) {
    if (!(err instanceof DryRunRollback)) throw err;
  }
  return { dryRun, changed, notes };
}
