import type { EspnResponse } from "./espn";

// The data-gap report (doc §5): what ESPN returned for a season against what the canonical tables need. Pure functions
// over the bundle's responses, so the report can be re-run on a saved bundle and is unit-tested on synthetic payloads.

export type Level = "ok" | "gap" | "warn";
export interface Check {
  area: string;
  level: Level;
  detail: string;
  /** Why it matters: what record or page needs it. */
  needs?: string;
}

type Obj = Record<string, unknown>;
const obj = (x: unknown): Obj =>
  x && typeof x === "object" && !Array.isArray(x) ? (x as Obj) : {};
const arr = (x: unknown): unknown[] => (Array.isArray(x) ? x : []);
const num = (x: unknown): number | null => (typeof x === "number" && Number.isFinite(x) ? x : null);

/** ESPN lineup slot ids (football): 0 QB, 2 RB, 4 WR, 6 TE, 16 D/ST, 17 K, 20 bench, 21 IR, 23 FLEX, 24 WR/RB... */
const BENCH = 20;
const IR = 21;

const find = (rs: EspnResponse[], endpoint: string) => rs.find((r) => r.endpoint === endpoint);
const all = (rs: EspnResponse[], endpoint: string) => rs.filter((r) => r.endpoint === endpoint);
const week = (r: EspnResponse) => num(r.params.scoringPeriodId);

export interface GapReport {
  year: number;
  checks: Check[];
  numbers: Record<string, number | string>;
}

export function gapReport(year: number, rs: EspnResponse[]): GapReport {
  const checks: Check[] = [];
  const numbers: GapReport["numbers"] = {};
  const add = (area: string, level: Level, detail: string, needs?: string) =>
    checks.push({ area, level, detail, ...(needs ? { needs } : {}) });

  // ---- transport
  const bad = rs.filter((r) => r.status !== 200 || r.payload === null);
  numbers.responses = rs.length;
  if (bad.length)
    add(
      "Requests",
      "gap",
      `${bad.length} of ${rs.length} requests failed: ${bad
        .slice(0, 5)
        .map((r) => `${r.endpoint}${week(r) ? ` wk${week(r)}` : ""} (HTTP ${r.status})`)
        .join(", ")}${bad.length > 5 ? ", ..." : ""}`
    );
  else add("Requests", "ok", `${rs.length} requests, all returned data`);

  // ---- settings
  const settingsRoot = obj(find(rs, "mSettings")?.payload);
  const settings = obj(settingsRoot.settings);
  const size = num(settings.size);
  const schedule = obj(settings.scheduleSettings);
  const status = obj(settingsRoot.status);
  const finalPeriod = num(status.finalScoringPeriod) ?? 0;
  const slotCounts = obj(obj(settings.rosterSettings).lineupSlotCounts);
  const scoringItems = arr(obj(settings.scoringSettings).scoringItems);
  if (!size || !scoringItems.length) {
    add(
      "League settings",
      "gap",
      "mSettings is missing the size or the scoring rules",
      "game types, optimal lineups"
    );
  } else {
    numbers.teams = size;
    numbers.regularSeasonWeeks = num(schedule.matchupPeriodCount) ?? "?";
    numbers.playoffTeams = num(schedule.playoffTeamCount) ?? "?";
    add(
      "League settings",
      "ok",
      `${size} teams, ${schedule.matchupPeriodCount} regular-season weeks, ${schedule.playoffTeamCount} playoff teams, ` +
        `${scoringItems.length} scoring rules, ${Object.values(slotCounts).reduce<number>((a, v) => a + (num(v) ?? 0), 0)} roster slots`
    );
  }
  const hasBudget = obj(settings.acquisitionSettings).isUsingAcquisitionBudget === true;
  numbers.faab = hasBudget ? "yes" : "no";
  add(
    "League settings",
    "ok",
    `waivers: ${hasBudget ? `FAAB budget ${obj(settings.acquisitionSettings).acquisitionBudget}` : "no FAAB"}`
  );

  // ---- teams and owners
  const teamRoot = obj(find(rs, "mTeam")?.payload);
  const teams = arr(teamRoot.teams).map(obj);
  const members = arr(teamRoot.members).map(obj);
  if (!teams.length) add("Teams", "gap", "mTeam returned no teams", "everything");
  else {
    numbers.teamsFound = teams.length;
    const noOwner = teams.filter((t) => arr(t.owners).length === 0);
    const named = teams.filter((t) => typeof t.name === "string" || typeof t.nickname === "string");
    add(
      "Teams",
      size && teams.length !== size ? "warn" : "ok",
      `${teams.length} teams${size && teams.length !== size ? ` (settings say ${size})` : ""}, ${members.length} members, ` +
        `${named.length} named`
    );
    if (noOwner.length)
      add(
        "Owners",
        "gap",
        `${noOwner.length} teams have no owner id (SWID): ${noOwner.map((t) => t.id).join(", ")}`,
        "manager identity"
      );
    else add("Owners", "ok", "every team has an owner id (SWID) to map to a manager");
    const finals = teams.filter(
      (t) => num(t.rankCalculatedFinal) !== null || num(obj(t.rank).final) !== null
    );
    const seeds = teams.filter((t) => num(t.playoffSeed) !== null && num(t.playoffSeed)! > 0);
    add(
      "Final standings",
      finals.length === teams.length ? "ok" : "gap",
      `final rank on ${finals.length}/${teams.length} teams, playoff seed on ${seeds.length}`,
      "placement records, trophies"
    );
  }

  // ---- schedule, brackets
  const sched = arr(obj(find(rs, "mMatchupScore")?.payload).schedule).map(obj);
  const byPeriod = new Map<number, Obj[]>();
  for (const m of sched) {
    const p = num(m.matchupPeriodId);
    if (p !== null) byPeriod.set(p, [...(byPeriod.get(p) ?? []), m]);
  }
  numbers.matchupWeeks = byPeriod.size;
  const tiers = new Map<string, number>();
  for (const m of sched)
    tiers.set(
      String(m.playoffTierType ?? "NONE"),
      (tiers.get(String(m.playoffTierType ?? "NONE")) ?? 0) + 1
    );
  const scored = sched.filter(
    (m) => num(obj(m.home).totalPoints) !== null && num(obj(m.away).totalPoints) !== null
  );
  // A bye (a playoff bye, or the odd team out in a league with an odd number of teams) is a matchup with one side only; its score is in pointsByScoringPeriod.
  const byeGames = sched.filter((m) => {
    const sides = [obj(m.home), obj(m.away)];
    const present = sides.filter((x) => num(x.teamId) !== null);
    return present.length === 1 && Object.keys(obj(present[0]?.pointsByScoringPeriod)).length > 0;
  });
  const unexplained = sched.length - scored.length - byeGames.length;
  add(
    "Schedule",
    sched.length && unexplained === 0 ? "ok" : "gap",
    `${sched.length} matchups over ${byPeriod.size} weeks, ${scored.length} with both scores, ${byeGames.length} byes` +
      (unexplained ? `, ${unexplained} unexplained` : ""),
    "weekly scores"
  );
  const playoffTiers = [...tiers].filter(([k]) => k !== "NONE");
  add(
    "Playoff bracket",
    playoffTiers.length ? "ok" : "gap",
    playoffTiers.length
      ? `playoff games by tier: ${playoffTiers.map(([k, n]) => `${k} ${n}`).join(", ")}`
      : "no playoffTierType on any matchup, so games can't be told apart as playoffs or toilet bowl",
    "scopes (playoffs / toilet bowl), placements"
  );
  const byes = [...byPeriod]
    .filter(([, ms]) => size && ms.length * 2 < size)
    .map(([p, ms]) => `wk${p} (${ms.length * 2} of ${size} teams play)`);
  if (byes.length)
    add(
      "Teams without a game",
      "warn",
      `${byes.join(", ")}: their scores come from the weekly rosters`,
      "scores that didn't count"
    );

  // ---- team-week rosters: lineups, actual and projected points, scores of teams without a game
  const rosterRequests = all(rs, "rosterTeamWeek");
  const teamCount = teams.length || size || 0;
  const expectedTeamWeeks = teamCount * (finalPeriod || new Set(rosterRequests.map(week)).size);
  let teamWeeksWithRoster = 0;
  let entries = 0;
  let withPoints = 0;
  let withProjection = 0;
  let bench = 0;
  let ir = 0;
  const projWeeks = new Set<number>();
  const rosterWeeks = new Set<number>();
  const playerIds = new Set<number>();
  const named = new Set<number>();
  for (const r of rosterRequests) {
    const w = week(r);
    for (const t of arr(obj(r.payload).teams).map(obj)) {
      const es = arr(obj(t.roster).entries).map(obj);
      if (!es.length) continue;
      teamWeeksWithRoster++;
      if (w !== null) rosterWeeks.add(w);
      for (const e of es) {
        entries++;
        const player = obj(obj(e.playerPoolEntry).player);
        const stats = arr(player.stats).map(obj);
        const forWeek = (source: number) =>
          stats.some(
            (s) => s.statSourceId === source && s.statSplitTypeId === 1 && s.scoringPeriodId === w
          );
        if (forWeek(0)) withPoints++;
        if (forWeek(1)) {
          withProjection++;
          if (w !== null) projWeeks.add(w);
        }
        const slot = num(e.lineupSlotId);
        if (slot === BENCH) bench++;
        if (slot === IR) ir++;
        const pid = num(e.playerId);
        if (pid !== null) {
          playerIds.add(pid);
          if (typeof player.fullName === "string") named.add(pid);
        }
      }
    }
  }
  numbers.lineupEntries = entries;
  numbers.players = playerIds.size;
  if (!rosterRequests.length)
    add(
      "Lineups",
      "gap",
      "no team-week rosters in the bundle",
      "potential points, lineup IQ, player records, benchwarmer"
    );
  else if (!entries)
    add(
      "Lineups",
      "gap",
      "the rosters came back without any player entries",
      "potential points, lineup IQ, player records"
    );
  else {
    add(
      "Lineups",
      teamWeeksWithRoster < expectedTeamWeeks ? "warn" : "ok",
      `${teamWeeksWithRoster}/${expectedTeamWeeks} team-weeks have a roster (${entries} player entries, ${bench} bench, ${ir} IR), ` +
        `${rosterWeeks.size} weeks`,
      "potential points, lineup IQ, player records, scores of teams without a game"
    );
    add(
      "Actual points",
      withPoints / entries >= 0.9 ? "ok" : "warn",
      `that week's points on ${withPoints}/${entries} entries (players on a bye or injured may have none)`,
      "player records, as-played scoring"
    );
    add(
      "Projections",
      withProjection
        ? projWeeks.size >= (finalPeriod || rosterWeeks.size)
          ? "ok"
          : "warn"
        : "gap",
      withProjection
        ? `that week's projection on ${withProjection}/${entries} entries in ${projWeeks.size}/${finalPeriod || rosterWeeks.size} weeks`
        : "no weekly projections on any entry",
      "boom / bust and upset records"
    );
  }

  // ---- transactions: the feed, plus the ones carried on player cards (de-duplicated by id)
  const cards = all(rs, "playerCards").flatMap((r) => arr(obj(r.payload).players).map(obj));
  const feed = all(rs, "mTransactions2").flatMap((r) => arr(obj(r.payload).transactions).map(obj));
  const txById = new Map<string, Obj>();
  for (const t of [...feed, ...cards.flatMap((c) => arr(c.transactions).map(obj))])
    txById.set(String(t.id ?? JSON.stringify(t).slice(0, 60)), t);
  const txs = [...txById.values()];
  const isDraft = (t: Obj) => arr(t.items).some((i) => obj(i).type === "DRAFT");
  const moves = txs.filter((t) => !isDraft(t));
  const txByType = new Map<string, number>();
  for (const t of moves) txByType.set(String(t.type), (txByType.get(String(t.type)) ?? 0) + 1);
  const failed = moves.filter((t) => t.status !== "EXECUTED").length;
  const withBid = moves.filter((t) => num(t.bidAmount) !== null && num(t.bidAmount)! > 0).length;
  const txWeeks = new Set(moves.map((t) => num(t.scoringPeriodId)).filter((w) => w !== null));
  numbers.transactions = moves.length;
  add(
    "Transactions",
    moves.length ? "ok" : "gap",
    moves.length
      ? `${moves.length} (${[...txByType].map(([k, n]) => `${k} ${n}`).join(", ")}) in ${txWeeks.size} weeks; ` +
          `${failed} not executed; ${withBid} with a bid; feed ${feed.length}, player cards ${cards.length}`
      : "no transactions on the feed or on any player card",
    "transaction records, most moved, player tenure, retention"
  );

  // ---- draft
  const picks = arr(obj(obj(find(rs, "mDraftDetail")?.payload).draftDetail).picks).map(obj);
  const bids = picks.filter((p) => num(p.bidAmount) !== null && num(p.bidAmount)! > 0).length;
  numbers.draftPicks = picks.length;
  add(
    "Draft",
    picks.length ? "ok" : "gap",
    picks.length
      ? `${picks.length} picks, ${bids} with a price, ${picks.filter((p) => p.keeper === true).length} keepers`
      : "no draft picks",
    "draft records, retention %"
  );

  // ---- players
  for (const c of cards) {
    const pid = num(c.id);
    if (pid !== null && typeof obj(c.player).fullName === "string") named.add(pid);
  }
  if (playerIds.size)
    add(
      "Players",
      named.size >= playerIds.size ? "ok" : "warn",
      `${playerIds.size} distinct ESPN players on rosters, ${named.size} with a name; matching to canonical players happens on import (unmatched ones go to the admin queue)`,
      "player records"
    );

  void year;
  return { year, checks, numbers };
}

export function formatReport(r: GapReport): string {
  const mark: Record<Level, string> = { ok: "ok  ", warn: "WARN", gap: "GAP " };
  const lines = [`ESPN ${r.year} data-gap report`, ""];
  for (const c of r.checks) {
    lines.push(`${mark[c.level]} ${c.area}: ${c.detail}`);
    if (c.level !== "ok" && c.needs) lines.push(`       needed for: ${c.needs}`);
  }
  const gaps = r.checks.filter((c) => c.level === "gap").length;
  const warns = r.checks.filter((c) => c.level === "warn").length;
  lines.push("", `${gaps} gaps, ${warns} warnings`);
  return lines.join("\n");
}
