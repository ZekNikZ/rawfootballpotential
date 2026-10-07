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

function entriesOf(side: unknown): Obj[] {
  const s = obj(side);
  return arr(obj(s.rosterForCurrentScoringPeriod).entries).map(obj);
}

const points = (e: Obj): number | null => {
  const pe = obj(e.playerPoolEntry);
  return num(pe.appliedStatTotal) ?? num(obj(e.playerPoints).totalPoints);
};

/** True when a player entry carries a projection (statSourceId 1) for the week. */
const hasProjection = (e: Obj): boolean =>
  arr(obj(obj(e.playerPoolEntry).player).stats).some((s) => obj(s).statSourceId === 1);

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
  add(
    "Schedule",
    sched.length && scored.length === sched.length ? "ok" : "gap",
    `${sched.length} matchups over ${byPeriod.size} weeks, ${scored.length} with both scores`,
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

  // ---- box scores (lineups)
  const boxes = all(rs, "mBoxscore");
  const boxWeeks = new Set(boxes.map((b) => week(b)).filter((w): w is number => w !== null));
  let sides = 0;
  let sidesWithRoster = 0;
  let entries = 0;
  let withPoints = 0;
  let withProjection = 0;
  let bench = 0;
  let ir = 0;
  const projWeeks = new Set<number>();
  const emptyWeeks: number[] = [];
  const playerIds = new Set<number>();
  for (const b of boxes) {
    const w = week(b);
    let any = false;
    for (const m of arr(obj(b.payload).schedule).map(obj)) {
      if (num(m.matchupPeriodId) !== w) continue;
      for (const side of [m.home, m.away]) {
        if (!side) continue;
        sides++;
        const es = entriesOf(side);
        if (es.length) sidesWithRoster++;
        for (const e of es) {
          any = true;
          entries++;
          if (points(e) !== null) withPoints++;
          if (hasProjection(e)) {
            withProjection++;
            if (w !== null) projWeeks.add(w);
          }
          const slot = num(e.lineupSlotId);
          if (slot === BENCH) bench++;
          if (slot === IR) ir++;
          const pid = num(e.playerId);
          if (pid !== null) playerIds.add(pid);
        }
      }
    }
    if (!any && w !== null) emptyWeeks.push(w);
  }
  numbers.lineupEntries = entries;
  numbers.players = playerIds.size;
  if (!boxes.length)
    add(
      "Lineups",
      "gap",
      "no box-score requests in the bundle",
      "potential points, lineup IQ, player records"
    );
  else if (!entries)
    add(
      "Lineups",
      "gap",
      "box scores came back without any player entries",
      "potential points, lineup IQ, player records, benchwarmer"
    );
  else {
    add(
      "Lineups",
      emptyWeeks.length || sidesWithRoster < sides || (finalPeriod && boxWeeks.size < finalPeriod)
        ? "warn"
        : "ok",
      `${entries} player entries over ${boxWeeks.size}/${finalPeriod || boxWeeks.size} weeks (${sidesWithRoster}/${sides} team sides have a roster), ` +
        `${bench} bench, ${ir} IR` +
        (emptyWeeks.length ? `; no lineups in weeks ${emptyWeeks.join(", ")}` : ""),
      "potential points, lineup IQ, player records"
    );
    add(
      "Actual points",
      withPoints === entries ? "ok" : "warn",
      `points on ${withPoints}/${entries} entries`,
      "player records, as-played scoring"
    );
    add(
      "Projections",
      withProjection ? (projWeeks.size >= (finalPeriod || boxWeeks.size) ? "ok" : "warn") : "gap",
      withProjection
        ? `projections on ${withProjection} entries in ${projWeeks.size}/${finalPeriod || boxWeeks.size} weeks`
        : "no projected points on any entry (ESPN drops them for past seasons)",
      "boom / bust and upset records"
    );
  }

  // ---- weekly rosters (scores for idle teams)
  const rosterWeeks = all(rs, "mRosterWeek");
  const rosterTeams = rosterWeeks.map(
    (r) =>
      arr(obj(r.payload).teams).filter((t) => arr(obj(obj(t).roster).entries).length > 0).length
  );
  add(
    "Weekly rosters",
    rosterWeeks.length && rosterTeams.every((n) => n > 0)
      ? "ok"
      : rosterWeeks.length
        ? "warn"
        : "gap",
    rosterWeeks.length
      ? `${rosterWeeks.length} weeks, ${Math.min(...rosterTeams)}-${Math.max(...rosterTeams)} teams with players per week`
      : "none fetched",
    "scores of teams without a game, roster history"
  );

  // ---- transactions
  const txs = all(rs, "mTransactions2").flatMap((r) => arr(obj(r.payload).transactions).map(obj));
  const txByType = new Map<string, number>();
  for (const t of txs) txByType.set(String(t.type), (txByType.get(String(t.type)) ?? 0) + 1);
  const failed = txs.filter((t) => /FAIL|CANCEL|DECLIN|REJECT/i.test(String(t.status))).length;
  const withBid = txs.filter((t) => num(t.bidAmount) !== null && num(t.bidAmount)! > 0).length;
  numbers.transactions = txs.length;
  add(
    "Transactions",
    txs.length ? "ok" : "gap",
    txs.length
      ? `${txs.length} (${[...txByType].map(([k, n]) => `${k} ${n}`).join(", ")}); ${failed} failed or cancelled; ${withBid} with a bid`
      : "ESPN returned no transactions for this season",
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

  // ---- players: names and positions for every player seen
  const named = new Set<number>();
  for (const b of boxes)
    for (const m of arr(obj(b.payload).schedule).map(obj))
      for (const side of [m.home, m.away])
        for (const e of entriesOf(side)) {
          const p = obj(obj(e.playerPoolEntry).player);
          if (typeof p.fullName === "string" && num(e.playerId) !== null)
            named.add(num(e.playerId)!);
        }
  if (playerIds.size)
    add(
      "Players",
      named.size === playerIds.size ? "ok" : "warn",
      `${playerIds.size} distinct ESPN players, ${named.size} with a name; matching to canonical players happens on import (unmatched ones go to the admin queue)`,
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
