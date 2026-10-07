import {
  leagueSeason,
  nflGame,
  nflPlayerWeek,
  nflTeamAlias,
  nflTeamWeek,
  player,
  playerIdMap,
  rosterCurrent,
  playerWeek,
  transactionItem,
  draftPick,
  eq,
  inArray,
  sql,
  type Db,
} from "@rfp/db";
import { parse } from "csv-parse/sync";
import { stringify } from "csv-stringify/sync";
import { log } from "../lib/log";
import { FOREVER, RawStore, hours, type FreshnessPolicy } from "../lib/raw-store";

const GAMES_URL = "https://raw.githubusercontent.com/nflverse/nfldata/master/data/games.csv";
const ROSTER_URL = (season: number) =>
  `https://github.com/nflverse/nflverse-data/releases/download/weekly_rosters/roster_weekly_${season}.csv`;
const CROSSWALK_URL = "https://github.com/dynastyprocess/data/raw/master/files/db_playerids.csv";

/** Abbreviations other sources use -> nflverse's (the canonical set, 32 teams). */
export const TEAM_ALIASES: Record<string, string> = {
  LAR: "LA",
  STL: "LA",
  SL: "LA",
  OAK: "LV",
  SD: "LAC",
  WSH: "WAS",
  JAC: "JAX",
  ARZ: "ARI",
  BLT: "BAL",
  CLV: "CLE",
  HST: "HOU",
  SFO: "SF",
  NWE: "NE",
  NOR: "NO",
  KAN: "KC",
  GNB: "GB",
  TAM: "TB",
  SDG: "LAC",
};
export const canonicalTeam = (t: string | null | undefined): string | null =>
  t ? (TEAM_ALIASES[t.toUpperCase()] ?? t.toUpperCase()) : null;

async function fetchText(url: string): Promise<string | null> {
  for (let attempt = 0; ; attempt++) {
    const res = await fetch(url, { redirect: "follow" });
    if (res.status === 404) return null;
    if (res.ok) return res.text();
    if (attempt < 3 && res.status >= 500) {
      await new Promise((r) => setTimeout(r, 1000 * 2 ** attempt));
      continue;
    }
    throw new Error(`${res.status} for ${url}`);
  }
}

const chunk = <T>(arr: readonly T[], size: number): T[][] => {
  const out: T[][] = [];
  for (let i = 0; i < arr.length; i += size) out.push(arr.slice(i, i + size));
  return out;
};

const na = (v: string | undefined): string | null =>
  v === undefined || v === "" || v === "NA" ? null : v;

type Row = Record<string, string>;
const parseCsv = (text: string): Row[] =>
  parse(text, { columns: true, skip_empty_lines: true, relax_column_count: true }) as Row[];

export interface NflReferenceSummary {
  seasons: number[];
  games: number;
  teamWeeks: number;
  byeWeeks: number;
  crosswalkRows: number;
  playerWeeks: number;
  playerWeeksFilled: number;
  playerWeeksWithoutNflRow: number;
}

export async function syncNflReference(
  db: Db,
  opts: { seasons?: number[] | undefined; force?: boolean } = {}
): Promise<NflReferenceSummary> {
  const store = new RawStore(db);
  const force = opts.force ?? false;
  const seasons =
    opts.seasons ??
    (
      await db
        .selectDistinct({ y: leagueSeason.year })
        .from(leagueSeason)
        .where(eq(leagueSeason.hasPlayerData, true))
    )
      .map((r) => r.y)
      .sort();
  const summary: NflReferenceSummary = {
    seasons,
    games: 0,
    teamWeeks: 0,
    byeWeeks: 0,
    crosswalkRows: 0,
    playerWeeks: 0,
    playerWeeksFilled: 0,
    playerWeeksWithoutNflRow: 0,
  };
  if (seasons.length === 0) return summary;

  // ---- alias table ----
  for (const [alias, nflTeam] of Object.entries(TEAM_ALIASES)) {
    await db
      .insert(nflTeamAlias)
      .values({ alias, nflTeam })
      .onConflictDoUpdate({
        target: [nflTeamAlias.alias, nflTeamAlias.seasonFrom],
        set: { nflTeam },
      });
  }

  // ---- schedule: nfl_game + nfl_team_week ----
  const gamesCsv = await store.text(
    "nflverse",
    "games.csv",
    {},
    hours(20),
    () => fetchText(GAMES_URL),
    { force }
  );
  if (!gamesCsv.data) throw new Error("could not load nflverse games.csv");
  const gameRows = parseCsv(gamesCsv.data).filter((g) => seasons.includes(Number(g.season)));
  const games = gameRows.map((g) => {
    const final = g.home_score !== "" && g.away_score !== "";
    const kickoff = g.gameday ? new Date(`${g.gameday}T${g.gametime || "13:00"}:00-05:00`) : null;
    return {
      id: g.game_id!,
      season: Number(g.season),
      week: Number(g.week),
      gameType: g.game_type === "REG" ? ("REG" as const) : ("POST" as const),
      sourceGameType: g.game_type ?? null,
      kickoff: kickoff && !Number.isNaN(kickoff.getTime()) ? kickoff : null,
      homeTeam: canonicalTeam(g.home_team)!,
      awayTeam: canonicalTeam(g.away_team)!,
      homeScore: final ? Number(g.home_score) : null,
      awayScore: final ? Number(g.away_score) : null,
      status: final ? ("final" as const) : ("scheduled" as const),
    };
  });
  for (const b of chunk(games, 500)) {
    await db
      .insert(nflGame)
      .values(b)
      .onConflictDoUpdate({
        target: nflGame.id,
        set: {
          kickoff: sql`excluded.kickoff`,
          homeScore: sql`excluded.home_score`,
          awayScore: sql`excluded.away_score`,
          status: sql`excluded.status`,
          week: sql`excluded.week`,
        },
      });
  }
  summary.games = games.length;

  const teamWeeks: (typeof nflTeamWeek.$inferInsert)[] = [];
  for (const season of seasons) {
    const reg = games.filter((g) => g.season === season && g.gameType === "REG");
    const teams = new Set(reg.flatMap((g) => [g.homeTeam, g.awayTeam]));
    const maxWeek = Math.max(0, ...reg.map((g) => g.week));
    for (let week = 1; week <= maxWeek; week++) {
      const played = new Map<string, string>();
      for (const g of reg.filter((x) => x.week === week)) {
        played.set(g.homeTeam, g.id);
        played.set(g.awayTeam, g.id);
      }
      for (const team of teams) {
        const gameId = played.get(team) ?? null;
        teamWeeks.push({ season, week, nflTeam: team, nflGameId: gameId, isBye: gameId === null });
        if (gameId === null) summary.byeWeeks++;
      }
    }
  }
  for (const b of chunk(teamWeeks, 2000)) {
    await db
      .insert(nflTeamWeek)
      .values(b)
      .onConflictDoUpdate({
        target: [nflTeamWeek.season, nflTeamWeek.week, nflTeamWeek.nflTeam],
        set: { nflGameId: sql`excluded.nfl_game_id`, isBye: sql`excluded.is_bye` },
      });
  }
  summary.teamWeeks = teamWeeks.length;

  // ---- ID crosswalk ----
  const cw = await store.text(
    "dynastyprocess",
    "db_playerids.csv",
    {},
    hours(24 * 7),
    () => fetchText(CROSSWALK_URL),
    { force }
  );
  if (cw.data) summary.crosswalkRows = await loadCrosswalk(db, parseCsv(cw.data));

  // ---- weekly rosters (player's NFL team + status that week) ----
  const relevant = await relevantPlayers(db);
  const bySleeper = new Map<string, number>();
  const byGsis = new Map<string, number>();
  const byEspn = new Map<string, number>();
  for (const batch of chunk([...relevant], 2000)) {
    const rows = await db
      .select({
        id: player.id,
        sleeperId: player.sleeperId,
        gsisId: player.gsisId,
        espnId: player.espnId,
      })
      .from(player)
      .where(inArray(player.id, batch));
    for (const r of rows) {
      if (r.sleeperId) bySleeper.set(r.sleeperId, r.id);
      if (r.gsisId) byGsis.set(r.gsisId, r.id);
      if (r.espnId) byEspn.set(r.espnId, r.id);
    }
  }
  const currentYear = new Date().getFullYear();
  for (const season of seasons) {
    const policy: FreshnessPolicy = season < currentYear ? FOREVER : hours(20);
    const csv = await store.text(
      "nflverse",
      "weekly_rosters(trimmed)",
      { season },
      policy,
      async () => {
        const text = await fetchText(ROSTER_URL(season));
        if (!text) return null;
        // Keep only the columns we use; the full file is ~15MB per season.
        const keep = [
          "season",
          "team",
          "position",
          "depth_chart_position",
          "status",
          "full_name",
          "gsis_id",
          "espn_id",
          "sleeper_id",
          "week",
          "game_type",
        ];
        return stringify(
          parseCsv(text).map((r) => keep.map((k) => r[k] ?? "")),
          { header: true, columns: keep }
        );
      },
      { force }
    );
    if (!csv.data) {
      log.warn({ season }, "no nflverse weekly roster file for season");
      continue;
    }
    const best = new Map<
      string,
      {
        playerId: number;
        week: number;
        team: string;
        status: string | null;
        position: string | null;
      }
    >();
    for (const r of parseCsv(csv.data)) {
      if (r.game_type !== "REG") continue;
      const sleeperId = na(r.sleeper_id);
      const playerId =
        (sleeperId ? bySleeper.get(sleeperId) : undefined) ??
        (na(r.gsis_id) ? byGsis.get(r.gsis_id!) : undefined) ??
        (na(r.espn_id) ? byEspn.get(r.espn_id!) : undefined);
      if (playerId === undefined) continue;
      const key = `${r.week}:${playerId}`;
      const candidate = {
        playerId,
        week: Number(r.week),
        team: canonicalTeam(r.team)!,
        status: na(r.status),
        position: na(r.position),
      };
      const prev = best.get(key);
      // A player listed twice in a week (traded/re-signed): prefer the active-roster row.
      if (!prev || (candidate.status === "ACT" && prev.status !== "ACT")) best.set(key, candidate);
    }
    const rows = [...best.values()].map((b) => ({ season, ...b, nflTeam: b.team }));
    await db.delete(nflPlayerWeek).where(eq(nflPlayerWeek.season, season));
    for (const b of chunk(rows, 3000)) {
      if (b.length)
        await db.insert(nflPlayerWeek).values(
          b.map((r) => ({
            season: r.season,
            week: r.week,
            playerId: r.playerId,
            nflTeam: r.nflTeam,
            status: r.status,
            position: r.position,
          }))
        );
    }
    summary.playerWeeks += rows.length;
    const filled = await fillPlayerWeeks(db, season);
    summary.playerWeeksFilled += filled.filled;
    summary.playerWeeksWithoutNflRow += filled.missing;
  }
  return summary;
}

/** Player ids that appear anywhere we need NFL context for (rostered, moved or drafted). */
async function relevantPlayers(db: Db): Promise<Set<number>> {
  const ids = new Set<number>();
  for (const q of [
    db.selectDistinct({ id: playerWeek.playerId }).from(playerWeek),
    db.selectDistinct({ id: rosterCurrent.playerId }).from(rosterCurrent),
    db.selectDistinct({ id: transactionItem.playerId }).from(transactionItem),
    db.selectDistinct({ id: draftPick.playerId }).from(draftPick),
  ]) {
    for (const r of await q) if (r.id !== null) ids.add(r.id);
  }
  return ids;
}

async function loadCrosswalk(db: Db, rows: Row[]): Promise<number> {
  const records = rows
    .map((r) => ({
      sleeperId: na(r.sleeper_id),
      espnId: na(r.espn_id),
      gsisId: na(r.gsis_id),
      yahooId: na(r.yahoo_id),
      pfrId: na(r.pfr_id),
      name: na(r.name),
    }))
    .filter((r) => r.sleeperId || r.espnId || r.gsisId);
  await db.delete(playerIdMap).where(eq(playerIdMap.manual, false));
  for (const b of chunk(records, 3000))
    await db.insert(playerIdMap).values(b.map((r) => ({ ...r, manual: false })));
  // Link crosswalk rows to players and backfill missing ids on player.
  await db.execute(sql`
    update player_id_map m set player_id = p.id
    from player p
    where m.manual = false and m.player_id is null and m.sleeper_id is not null and p.sleeper_id = m.sleeper_id`);
  await db.execute(sql`
    update player p set espn_id = m.espn_id
    from player_id_map m
    where m.player_id = p.id and p.espn_id is null and m.espn_id is not null`);
  await db.execute(sql`
    update player p set gsis_id = m.gsis_id
    from player_id_map m
    where m.player_id = p.id and p.gsis_id is null and m.gsis_id is not null`);
  return records.length;
}

/**
 * Fill player_week.nfl_team / nfl_game_id / nfl_status (and the position snapshot) for one season from the
 * weekly rosters + schedule. Team defenses use their team code. A known team with no game = bye.
 */
export async function fillPlayerWeeks(
  db: Db,
  season: number
): Promise<{ filled: number; missing: number }> {
  // Position snapshot: nflverse's position that week; keep the dump's eligibility only when it agrees,
  // and keep the slot a starter actually filled as evidence.
  const result = await db.execute<{ filled: string; missing: string }>(sql`
    with slot_accept(slot, accepted) as (
      values ('FLEX', array['RB','WR','TE']), ('WRRB_FLEX', array['RB','WR']), ('REC_FLEX', array['WR','TE']),
             ('SUPER_FLEX', array['QB','RB','WR','TE']), ('IDP_FLEX', array['DL','LB','DB'])
    ), target as (
      select pw.team_week_id, pw.player_id, tw.week, p.position as dump_pos, p.fantasy_positions, p.sleeper_id,
             pw.slot, pw.slot_kind
      from player_week pw
      join team_week tw on tw.id = pw.team_week_id
      join league_season ls on ls.id = tw.league_season_id and ls.year = ${season}
      join player p on p.id = pw.player_id
    ), resolved as (
      select t.*,
             case when t.dump_pos = 'DEF' then null::text else coalesce(npw.nfl_team, near.nfl_team) end as roster_team,
             npw.status as roster_status,
             -- nflverse's position is kept unless it conflicts with Sleeper's fantasy view (an ID collision, e.g. an RB
             -- listed as a DB, or a player Sleeper counts at another position, e.g. a QB who is TE-eligible), or the
             -- lineup contradicts it (a starter's flex slot rejects nflverse's position but accepts the dump's)
             case when sa.accepted is not null and t.slot_kind = 'starter' and not (npw.position = any(sa.accepted)) and t.dump_pos = any(sa.accepted)
                  then null
                  when npw.position is not null and t.dump_pos is not null and npw.position <> t.dump_pos
                       and not (npw.position = any(coalesce(t.fantasy_positions, '{}'::text[])))
                  then null
                  else npw.position end as roster_pos
      from target t
      left join slot_accept sa on sa.slot = t.slot
      left join nfl_player_week npw on npw.season = ${season} and npw.week = t.week and npw.player_id = t.player_id
      -- nflverse has no roster row for a team's bye week: carry the adjacent week's team so the schedule marks the bye
      left join lateral (
        select np2.nfl_team from nfl_player_week np2
        where np2.season = ${season} and np2.player_id = t.player_id and np2.week in (t.week - 1, t.week + 1)
        order by case when np2.week = t.week - 1 then 0 else 1 end limit 1
      ) near on npw.nfl_team is null
    ), teamed as (
      select r.*,
             case when r.dump_pos = 'DEF' then coalesce(a.nfl_team, r.sleeper_id) else r.roster_team end as team
      from resolved r
      left join nfl_team_alias a on a.alias = r.sleeper_id and r.dump_pos = 'DEF' and a.season_from is null
    ), upd as (
      update player_week pw set
        nfl_team = x.team,
        nfl_game_id = ntw.nfl_game_id,
        nfl_status = case when x.dump_pos = 'DEF' then 'ACT' else x.roster_status end,
        position = coalesce(x.roster_pos, pw.position),
        eligible_positions = (
          select coalesce(array_agg(distinct e), '{}'::text[]) from unnest(
            array_remove(
              array[coalesce(x.roster_pos, x.dump_pos)]
              -- eligibility is the union of what nflverse and Sleeper say (Sleeper has no per-week eligibility)
              || coalesce(x.fantasy_positions, '{}'::text[])
              || case when x.dump_pos is null then '{}'::text[] else array[x.dump_pos] end
              || case when x.slot_kind = 'starter' and x.slot in ('QB','RB','WR','TE','K','DEF','DL','LB','DB') then array[x.slot] else '{}'::text[] end,
              null)
          ) as e
        )
      from teamed x
      left join nfl_team_week ntw on ntw.season = ${season} and ntw.week = x.week and ntw.nfl_team = x.team
      where pw.team_week_id = x.team_week_id and pw.player_id = x.player_id and (x.team is not null)
      returning 1
    )
    select (select count(*) from upd) as filled, (select count(*) from teamed where team is null) as missing`);
  const row = result.rows[0];
  return { filled: Number(row?.filled ?? 0), missing: Number(row?.missing ?? 0) };
}
