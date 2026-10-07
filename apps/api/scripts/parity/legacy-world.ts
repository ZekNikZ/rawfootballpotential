/* eslint-disable @typescript-eslint/no-explicit-any -- the legacy app's objects are deliberately untyped here: this tool only feeds them to the unmodified legacy generators */
import { sql } from "@rfp/db";
import type { Db } from "@rfp/db";
import { MongoClient } from "mongodb";

/**
 * Rebuilds the legacy app's in-memory `League` objects without running its server: Sleeper seasons from the raw
 * Sleeper payloads cached in raw_payload (the exact responses the old route would have fetched), run through a
 * port of the old route's mapping (including its known quirks), and the ESPN seasons straight from the Mongo
 * `leagues` collection. Mongo is only read.
 */

const range = (a: number, b: number) => Array.from({ length: b - a }, (_, i) => a + i);

async function rawJson(db: Db, endpoint: string, params: Record<string, unknown>): Promise<any> {
  const conds = Object.entries(params).map(([k, v]) =>
    typeof v === "number" ? sql`(params->>${k})::int = ${v}` : sql`params->>${k} = ${String(v)}`
  );
  const where = conds.length ? sql.join(conds, sql` and `) : sql`true`;
  const res = await db.execute<{ payload: any }>(sql`
    select payload from raw_payload where source = 'sleeper' and endpoint = ${endpoint} and ${where}
    order by fetched_at desc limit 1`);
  return res.rows[0]?.payload ?? null;
}

export interface BuildOptions {
  /**
   * Feed the legacy generators *corrected data*: no idle-team fake games, no ESPN playoff games (they have no bracket),
   * scores as played (as-played scoring rules) and the bracket-derived final placements. What is left over after this
   * is a difference in logic, not in data.
   */
  corrected: boolean;
}

export interface LegacyWorld {
  config: any;
  leagueDefs: any[];
  leagues: Record<string, any>;
  nflData: any;
}

/** Port of legacy/api/routes/leagues.route.ts (Sleeper branch), reading cached payloads instead of fetching. */
async function buildSleeperLeague(
  db: Db,
  config: any,
  year: any,
  groupType: string,
  opts: BuildOptions
): Promise<any> {
  const id: string = year.internalId;
  const leagueId = year.leagueId;
  const leagueJson = await rawJson(db, "league", { id });
  const managerJson: any[] = await rawJson(db, "league/users", { id });
  const teamJson: any[] = await rawJson(db, "league/rosters", { id });
  if (!leagueJson || !managerJson || !teamJson)
    throw new Error(`missing cached Sleeper payloads for ${leagueId}`);

  const divisionNames =
    leagueJson.settings.divisions > 0
      ? range(1, leagueJson.settings.divisions + 1).map((i) => leagueJson.metadata[`division_${i}`])
      : undefined;
  const numRegularSeasonWeeks = leagueJson.settings.playoff_week_start - 1;
  const numPlayoffWeeks = Math.ceil(Math.log2(leagueJson.settings.playoff_teams));
  const weeks = range(1, numRegularSeasonWeeks + numPlayoffWeeks + 1);

  const managers: Record<string, any> = {};
  for (const manager of managerJson) {
    const configManager = config.managers.find((m: any) => m.sleeperIds.includes(manager.user_id));
    const managerId = configManager?.id ?? `M-ERROR-${manager.user_id}`;
    managers[managerId] = {
      managerId,
      avatar: manager.metadata?.avatar,
      name: configManager?.name ?? manager.display_name,
    };
  }

  const teams: Record<string, any> = {};
  for (const team of teamJson) {
    const managerId =
      config.managers.find((m: any) => m.sleeperIds.includes(team.owner_id))?.id ??
      `M-NOT-CONFIGURED-${team.owner_id}`;
    const managerData = managerJson.find((m) => m.user_id === team.owner_id);
    const teamId = `R-${team.league_id}-${team.roster_id}`;
    teams[teamId] = {
      teamId,
      leagueId,
      managerId,
      division: divisionNames ? divisionNames[(team.settings.division ?? 0) - 1] : undefined,
      name: managerData.metadata.team_name ?? `Team ${managerData.display_name}`,
      players: team.starters,
      bench: team.players.filter(
        (p: string) => !team.starters.includes(p) && !(team.reserve ?? []).includes(p)
      ),
      injuryReserve: team.reserve ?? [],
      sleeperRosterId: team.roster_id,
      playoffSortOrder:
        team.settings.wins * 100000000 + team.settings.fpts * 10000 + team.settings.fpts_against,
    };
  }
  const teamAssignments: Record<string, string> = {};
  for (const [teamId, team] of Object.entries<any>(teams)) teamAssignments[team.managerId] = teamId;
  // The old route guessed playoff teams from the *current* roster standings (doc §1.4 bug 6).
  const playoffQualifiedTeams = Object.values<any>(teams)
    .sort((a, b) => b.playoffSortOrder - a.playoffSortOrder)
    .slice(0, leagueJson.settings.playoff_teams)
    .map((t) => t.teamId);

  const seasonRow = (
    await db.execute<{
      id: number;
      year: number;
      scoring: Record<string, number>;
      overrides: { stat: string; points: number; fromWeek?: number; toWeek?: number }[];
    }>(
      sql`select id, year, scoring_settings as scoring, scoring_overrides as overrides from league_season where source = 'sleeper' and external_id = ${id}`
    )
  ).rows[0];
  const placements: Record<string, number> = {};
  if (opts.corrected && seasonRow) {
    const rows = await db.execute<{ r: string; p: number }>(
      sql`select external_roster_id as r, final_place as p from team_season where league_season_id = ${seasonRow.id}`
    );
    for (const r of rows.rows) if (r.p !== null) placements[`R-${id}-${r.r}`] = r.p;
  }

  const matchups: any[] = [];
  for (const week of weeks) {
    let entries: any[] = (await rawJson(db, "league/matchups", { id, week })) ?? [];
    if (opts.corrected && seasonRow) {
      const rules = seasonRow.overrides.filter(
        (r) => (r.fromWeek ?? 1) <= week && week <= (r.toWeek ?? Infinity)
      );
      if (rules.length) {
        const stats = (await rawJson(db, "stats", { season: seasonRow.year, week })) ?? {};
        const delta = (pid: string) =>
          Math.round(
            rules.reduce(
              (a, r) =>
                a + (stats[pid]?.[r.stat] ?? 0) * (r.points - (seasonRow.scoring[r.stat] ?? 0)),
              0
            ) * 100
          ) / 100;
        entries = entries.map((e) => {
          const team = e.starters.reduce(
            (a: number, p: string) => (p === "0" ? a : a + delta(p)),
            0
          );
          return {
            ...e,
            points: Math.round((e.points + team) * 100) / 100,
            players_points: Object.fromEntries(
              Object.entries<number>(e.players_points).map(([p, v]) => [
                p,
                Math.round((v + delta(p)) * 100) / 100,
              ])
            ),
          };
        });
      }
    }
    // lodash groupBy: a null matchup_id becomes the group "null", so exactly two idle teams look like a real game
    // (doc §1.4 bug 7) and three or more idle teams collapse to their first team versus a "BYE".
    const groups = new Map<string, any[]>();
    const keys = [...new Set(entries.map((e) => String(e.matchup_id)))];
    const numeric = keys.filter((k) => k !== "null").sort((a, b) => Number(a) - Number(b));
    for (const k of [...numeric, ...keys.filter((k) => k === "null")])
      groups.set(
        k,
        entries.filter((e) => String(e.matchup_id) === k)
      );
    const side = (m: any) => ({
      teamId: `R-${id}-${m.roster_id}`,
      hasPlayerData: true,
      points: m.custom_points ?? m.points,
      werePointsOverrided: !!m.custom_points,
      players: m.starters.map((x: string) => (x === "0" ? null : x)),
      bench: m.players.filter(
        (p: string) => !m.starters.includes(p) && !(m.reserve ?? []).includes(p)
      ),
      injuryReserve: m.reserve ?? [],
      playerPoints: m.players_points,
      playerProjectedPoints: {},
    });
    for (const [matchupId, group] of groups) {
      if (opts.corrected && matchupId === "null") continue; // idle teams are not a game
      matchups.push({
        week,
        matchupId: `M-${week}-${matchupId}`,
        leagueId,
        team1: side(group[0]),
        team2: group.length === 2 ? side(group[1]) : "BYE",
      });
    }
  }

  return {
    leagueId,
    year: parseInt(leagueJson.season, 10),
    leagueType: groupType,
    status: leagueJson.status,
    source: year.source,
    sleeperLeagueId: id,
    managerData: { managers, teamAssignments },
    teamData: {
      teams,
      teamCount: Object.keys(teams).length,
      divisionNames,
      rosterPositions: leagueJson.roster_positions.filter((p: string) => p !== "BN"),
      benchSize: leagueJson.roster_positions.filter((p: string) => p === "BN").length,
      injuryReserveSize: leagueJson.settings.reserve_slots ?? 0,
      playoffQualifiedTeams,
      finalPlacements:
        opts.corrected && Object.keys(placements).length ? placements : year.finalPlacements,
    },
    matchupData: {
      matchups,
      winnersBracket: "NOT IMPLEMENTED",
      losersBracket: "NOT IMPLEMENTED",
      playoffSpots: leagueJson.settings.playoff_teams,
      playoffWeekStart: leagueJson.settings.playoff_week_start,
      totalWeekCount: numRegularSeasonWeeks + numPlayoffWeeks,
      medianEnabled: leagueJson.settings.league_average_match === 1,
    },
  };
}

/** ESPN seasons come from Mongo as stored; corrected mode drops the playoff weeks (no bracket exists for them, doc §2). */
function espnLeague(doc: any, opts: BuildOptions): any {
  if (!opts.corrected) return doc;
  const start = doc.matchupData.playoffWeekStart;
  return {
    ...doc,
    matchupData: {
      ...doc.matchupData,
      matchups: doc.matchupData.matchups.filter((m: any) => m.week < start),
    },
  };
}

/** Port of legacy/api/services/nfl.service.ts, from the cached player dump. */
async function buildNflData(db: Db): Promise<any> {
  const dump = await rawJson(db, "players/nfl", {});
  if (!dump) throw new Error("no cached players/nfl payload");
  const players: Record<string, any> = {};
  for (const [playerId, data] of Object.entries<any>(dump)) {
    players[playerId] = {
      playerId,
      firstName: data.first_name,
      lastName: data.last_name,
      fullName: data.full_name,
      positions: data.fantasy_positions,
      nflTeamId: data.team,
      nflPosition: data.position,
    };
  }
  return { players, teams: {} };
}

export async function buildLegacyWorld(
  db: Db,
  mongoUrl: string,
  mongoDatabase: string,
  opts: BuildOptions
): Promise<LegacyWorld> {
  const mongo = new MongoClient(mongoUrl);
  await mongo.connect();
  try {
    const mdb = mongo.db(mongoDatabase);
    const config: any = await mdb.collection("config").findOne();
    const espn: Record<string, any> = {};
    for await (const doc of mdb.collection("leagues").find()) espn[doc.leagueId] = doc;

    const leagues: Record<string, any> = {};
    for (const def of config.leagues) {
      for (const year of def.years) {
        leagues[year.leagueId] =
          year.source === "sleeper"
            ? await buildSleeperLeague(db, config, year, def.type, opts)
            : espnLeague(espn[year.leagueId], opts);
      }
    }
    return { config, leagueDefs: config.leagues, leagues, nflData: await buildNflData(db) };
  } finally {
    await mongo.close();
  }
}
