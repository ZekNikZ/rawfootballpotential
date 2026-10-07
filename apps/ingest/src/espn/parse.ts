// ESPN bundle (doc §5) -> a typed, source-neutral season. Pure: no database, no network, so it is tested on small
// synthetic payloads and re-run on a saved bundle at will. What the scraper stored is documented in apps/scraper.

type Obj = Record<string, unknown>;
const obj = (x: unknown): Obj =>
  x && typeof x === "object" && !Array.isArray(x) ? (x as Obj) : {};
const arr = (x: unknown): unknown[] => (Array.isArray(x) ? x : []);
const num = (x: unknown): number | null => (typeof x === "number" && Number.isFinite(x) ? x : null);
const str = (x: unknown): string | null => (typeof x === "string" && x.length > 0 ? x : null);

export interface BundleResponse {
  endpoint: string;
  params: Record<string, unknown>;
  status: number;
  payload: unknown;
}

/** ESPN lineup slot ids -> the slot names the optimal-lineup solver knows (packages/core lineup.ts). */
export const SLOT_NAMES: Readonly<Record<number, string>> = {
  0: "QB",
  2: "RB",
  3: "WRRB_FLEX",
  4: "WR",
  5: "REC_FLEX",
  6: "TE",
  7: "SUPER_FLEX",
  8: "DL",
  9: "DL",
  10: "LB",
  11: "DL",
  12: "DB",
  13: "DB",
  14: "DB",
  15: "IDP_FLEX",
  16: "DEF",
  17: "K",
  20: "BN",
  21: "IR",
  23: "FLEX",
};
export const BENCH_SLOT = 20;
export const IR_SLOT = 21;

/** ESPN default position ids -> our position codes. */
export const POSITIONS: Readonly<Record<number, string>> = {
  1: "QB",
  2: "RB",
  3: "WR",
  4: "TE",
  5: "K",
  16: "DEF",
};

/** ESPN pro team ids -> NFL abbreviations (the same ones Sleeper uses for team defenses). */
export const PRO_TEAMS: Readonly<Record<number, string>> = {
  1: "ATL",
  2: "BUF",
  3: "CHI",
  4: "CIN",
  5: "CLE",
  6: "DAL",
  7: "DEN",
  8: "DET",
  9: "GB",
  10: "TEN",
  11: "IND",
  12: "KC",
  13: "LV",
  14: "LAR",
  15: "MIA",
  16: "MIN",
  17: "NE",
  18: "NO",
  19: "NYG",
  20: "NYJ",
  21: "PHI",
  22: "ARI",
  23: "PIT",
  24: "LAC",
  25: "SF",
  26: "SEA",
  27: "TB",
  28: "WAS",
  29: "CAR",
  30: "JAX",
  33: "BAL",
  34: "HOU",
};

export type EspnTier =
  "NONE" | "WINNERS_BRACKET" | "WINNERS_CONSOLATION_LADDER" | "LOSERS_CONSOLATION_LADDER";

export interface EspnTeam {
  id: number;
  name: string;
  abbrev: string | null;
  logo: string | null;
  division: string | null;
  owners: string[];
  rankFinal: number | null;
  seed: number | null;
}

export interface EspnGame {
  week: number;
  tier: EspnTier;
  /** One side only = a playoff bye. */
  sides: { teamId: number; points: number | null }[];
}

export interface EspnRosterEntry {
  playerId: number;
  slotId: number;
  name: string;
  position: string | null;
  proTeamId: number | null;
  actual: number | null;
  projected: number | null;
}

export interface EspnTransactionItem {
  type: "ADD" | "DROP" | "TRADE";
  playerId: number;
  fromTeamId: number;
  toTeamId: number;
}

export interface EspnTransaction {
  id: string;
  kind: "waiver" | "free_agent" | "trade";
  complete: boolean;
  /** Why it did not happen (ESPN's status), for failed claims. */
  reason: string | null;
  week: number;
  at: number | null;
  teamId: number | null;
  bid: number | null;
  items: EspnTransactionItem[];
}

export interface EspnDraftPick {
  overall: number;
  round: number;
  roundPick: number;
  teamId: number;
  playerId: number;
  bid: number | null;
  keeper: boolean;
}

export interface EspnSeason {
  year: number;
  leagueId: string;
  settings: {
    teamCount: number;
    regularSeasonWeeks: number;
    playoffTeams: number;
    playoffWeekStart: number;
    lastWeek: number;
    /** Starting slots in lineup order, as slot names (BN and IR excluded). */
    rosterSlots: string[];
    benchSlots: number;
    irSlots: number;
    hasFaab: boolean;
    faabBudget: number | null;
    scoringItems: unknown[];
  };
  teams: EspnTeam[];
  /** SWID -> display name. */
  members: Map<string, string>;
  games: EspnGame[];
  /** `${teamId}:${week}` -> that team's roster entries that week. */
  rosters: Map<string, EspnRosterEntry[]>;
  /** The team score of a week from the schedule (both sides, or a bye's pointsByScoringPeriod). */
  weekScores: Map<string, number>;
  /** ESPN player id -> what ESPN calls him, for players the database does not know. */
  players: Map<number, { name: string; position: string | null; proTeamId: number | null }>;
  transactions: EspnTransaction[];
  draft: { type: "snake" | "linear" | "auction"; rounds: number; picks: EspnDraftPick[] } | null;
  /** Things the importer could not make sense of; the caller reports them. */
  anomalies: string[];
}

const find = (rs: BundleResponse[], endpoint: string) => rs.find((r) => r.endpoint === endpoint);

function parseSettings(
  root: Obj,
  schedule: unknown[],
  anomalies: string[]
): EspnSeason["settings"] {
  const settings = obj(root.settings);
  const sched = obj(settings.scheduleSettings);
  const regular = num(sched.matchupPeriodCount) ?? 0;
  const lastWeek = Math.max(
    num(obj(root.status).finalScoringPeriod) ?? 0,
    ...schedule.map((m) => num(obj(m).matchupPeriodId) ?? 0)
  );
  const counts = obj(obj(settings.rosterSettings).lineupSlotCounts);
  const rosterSlots: string[] = [];
  let benchSlots = 0;
  let irSlots = 0;
  for (const [slotId, n] of Object.entries(counts)
    .map(([k, v]) => [Number(k), num(v) ?? 0] as const)
    .sort((a, b) => a[0] - b[0])) {
    if (slotId === BENCH_SLOT) benchSlots = n;
    else if (slotId === IR_SLOT) irSlots = n;
    else if (n > 0) {
      const name = SLOT_NAMES[slotId];
      if (!name) anomalies.push(`unknown lineup slot id ${slotId} (${n} slots)`);
      for (let i = 0; i < n; i++) rosterSlots.push(name ?? `SLOT_${slotId}`);
    }
  }
  const acq = obj(settings.acquisitionSettings);
  const hasFaab = acq.isUsingAcquisitionBudget === true;
  return {
    teamCount: num(settings.size) ?? 0,
    regularSeasonWeeks: regular,
    playoffTeams: num(sched.playoffTeamCount) ?? 0,
    playoffWeekStart: regular + 1,
    lastWeek,
    rosterSlots,
    benchSlots,
    irSlots,
    hasFaab,
    faabBudget: hasFaab ? num(acq.acquisitionBudget) : null,
    scoringItems: arr(obj(settings.scoringSettings).scoringItems),
  };
}

function parseTeams(root: Obj): { teams: EspnTeam[]; members: Map<string, string> } {
  const members = new Map<string, string>();
  for (const m of arr(root.members).map(obj)) {
    const id = str(m.id);
    if (!id) continue;
    const name =
      str(m.displayName) ?? ([str(m.firstName), str(m.lastName)].filter(Boolean).join(" ") || id);
    members.set(id, name);
  }
  const teams = arr(root.teams)
    .map(obj)
    .map((t): EspnTeam | null => {
      const id = num(t.id);
      if (id === null) return null;
      const name =
        str(t.name) ??
        ([str(t.location), str(t.nickname)].filter(Boolean).join(" ") || `Team ${id}`);
      const divisionId = num(t.divisionId);
      return {
        id,
        name,
        abbrev: str(t.abbrev),
        logo: str(t.logo),
        division: divisionId === null ? null : String(divisionId),
        owners: arr(t.owners).filter((o): o is string => typeof o === "string"),
        rankFinal: num(t.rankCalculatedFinal) ?? num(obj(t.rank).final) ?? null,
        seed: num(t.playoffSeed) && num(t.playoffSeed)! > 0 ? num(t.playoffSeed) : null,
      };
    })
    .filter((t): t is EspnTeam => t !== null);
  return { teams, members };
}

function parseGames(schedule: unknown[]): { games: EspnGame[]; weekScores: Map<string, number> } {
  const games: EspnGame[] = [];
  const weekScores = new Map<string, number>();
  for (const m of schedule.map(obj)) {
    const week = num(m.matchupPeriodId);
    if (week === null) continue;
    const tier = (str(m.playoffTierType) ?? "NONE") as EspnTier;
    const sides: EspnGame["sides"] = [];
    for (const side of [obj(m.home), obj(m.away)]) {
      const teamId = num(side.teamId);
      if (teamId === null) continue;
      const points =
        num(side.totalPoints) ?? num(obj(side.pointsByScoringPeriod)[String(week)]) ?? null;
      sides.push({ teamId, points });
      if (points !== null) weekScores.set(`${teamId}:${week}`, points);
    }
    if (sides.length > 0) games.push({ week, tier, sides });
  }
  return { games, weekScores };
}

function parseRosters(rs: BundleResponse[]): Map<string, EspnRosterEntry[]> {
  const rosters = new Map<string, EspnRosterEntry[]>();
  for (const r of rs.filter((x) => x.endpoint === "rosterTeamWeek")) {
    const week = num(r.params.scoringPeriodId);
    if (week === null) continue;
    for (const t of arr(obj(r.payload).teams).map(obj)) {
      const teamId = num(t.id);
      if (teamId === null) continue;
      const entries: EspnRosterEntry[] = [];
      for (const e of arr(obj(t.roster).entries).map(obj)) {
        const playerId = num(e.playerId);
        const slotId = num(e.lineupSlotId);
        if (playerId === null || slotId === null) continue;
        const player = obj(obj(e.playerPoolEntry).player);
        const stats = arr(player.stats).map(obj);
        const forWeek = (source: number) =>
          num(
            stats.find(
              (s) =>
                s.statSourceId === source && s.statSplitTypeId === 1 && s.scoringPeriodId === week
            )?.appliedTotal
          );
        const defaultPosition = num(player.defaultPositionId);
        entries.push({
          playerId,
          slotId,
          name: str(player.fullName) ?? `ESPN player ${playerId}`,
          position: defaultPosition === null ? null : (POSITIONS[defaultPosition] ?? null),
          proTeamId: num(player.proTeamId),
          actual: forWeek(0),
          projected: forWeek(1),
        });
      }
      rosters.set(`${teamId}:${week}`, entries);
    }
  }
  return rosters;
}

const FAILED_REASONS = /^(FAILED|CANCEL|PENDING|DECLIN|REJECT|VETO)/i;

function parseTransactions(rs: BundleResponse[], anomalies: string[]): EspnTransaction[] {
  // The feed and the player cards carry the same records; a transaction rides on every player it touches.
  const byId = new Map<string, Obj>();
  for (const r of rs) {
    if (r.endpoint === "mTransactions2")
      for (const t of arr(obj(r.payload).transactions).map(obj)) byId.set(String(t.id), t);
    if (r.endpoint === "playerCards")
      for (const p of arr(obj(r.payload).players).map(obj))
        for (const t of arr(p.transactions).map(obj))
          if (!byId.has(String(t.id))) byId.set(String(t.id), t);
  }
  const out: EspnTransaction[] = [];
  for (const [id, t] of byId) {
    const type = str(t.type) ?? "";
    const status = str(t.status) ?? "";
    const items = arr(t.items)
      .map(obj)
      .flatMap((i): EspnTransactionItem[] => {
        const kind = str(i.type);
        const playerId = num(i.playerId);
        if ((kind !== "ADD" && kind !== "DROP" && kind !== "TRADE") || playerId === null) return [];
        return [
          {
            type: kind,
            playerId,
            fromTeamId: num(i.fromTeamId) ?? 0,
            toTeamId: num(i.toTeamId) ?? 0,
          },
        ];
      });
    const week = num(t.scoringPeriodId);
    const at = num(t.processDate) ?? num(t.proposedDate);
    const bid = num(t.bidAmount) && num(t.bidAmount)! > 0 ? num(t.bidAmount) : null;
    const base = {
      id,
      week: week ?? 1,
      at,
      teamId: num(t.teamId),
      bid,
      items,
    };
    if (type === "WAIVER" || type === "FREEAGENT" || type === "ROSTER") {
      if (items.length === 0) continue;
      const complete = status === "EXECUTED";
      out.push({
        ...base,
        // A plain drop (ROSTER) is a free-agent move with only a drop item, as on Sleeper.
        kind: type === "WAIVER" ? "waiver" : "free_agent",
        complete,
        reason: complete ? null : FAILED_REASONS.test(status) || status ? status : "not executed",
      });
    } else if (type === "TRADE_ACCEPT") {
      // An accepted trade is a TRADE_ACCEPT carrying the player moves; league votes (TRADE_UPHOLD), proposals and
      // declines carry none and are not transactions.
      const moves = items.filter((i) => i.type === "TRADE");
      if (moves.length === 0) continue;
      const complete = status === "EXECUTED";
      out.push({
        ...base,
        kind: "trade",
        complete,
        reason: complete ? null : status || "not executed",
      });
    } else if (
      type !== "DRAFT" &&
      type !== "FUTURE_ROSTER" &&
      type !== "TRADE_PROPOSAL" &&
      type !== "TRADE_DECLINE" &&
      type !== "TRADE_UPHOLD"
    ) {
      anomalies.push(`transaction ${id}: unknown type ${type}`);
    }
  }
  return out.sort((a, b) => (a.at ?? 0) - (b.at ?? 0) || a.id.localeCompare(b.id));
}

function parseDraft(rs: BundleResponse[], teamCount: number): EspnSeason["draft"] {
  const picks = arr(obj(obj(find(rs, "mDraftDetail")?.payload).draftDetail).picks)
    .map(obj)
    .flatMap((p): EspnDraftPick[] => {
      const overall = num(p.overallPickNumber);
      const teamId = num(p.teamId);
      const playerId = num(p.playerId);
      if (overall === null || teamId === null || playerId === null) return [];
      const round = num(p.roundId) ?? Math.ceil(overall / Math.max(teamCount, 1));
      return [
        {
          overall,
          round,
          roundPick: num(p.roundPickNumber) ?? ((overall - 1) % Math.max(teamCount, 1)) + 1,
          teamId,
          playerId,
          bid: num(p.bidAmount) && num(p.bidAmount)! > 0 ? num(p.bidAmount) : null,
          keeper: p.keeper === true,
        },
      ];
    })
    .sort((a, b) => a.overall - b.overall);
  if (picks.length === 0) return null;
  const settings = obj(obj(obj(find(rs, "mSettings")?.payload).settings).draftSettings);
  const rounds = Math.max(...picks.map((p) => p.round));
  const priced = picks.some((p) => p.bid !== null) || str(settings.type) === "AUCTION";
  let type: "snake" | "linear" | "auction" = "snake";
  if (priced) type = "auction";
  else {
    // ESPN calls an offline draft "OFFLINE": tell snake from linear by whether round 2 runs the other way.
    const r1 = picks.filter((p) => p.round === 1).sort((a, b) => a.roundPick - b.roundPick);
    const r2 = picks.filter((p) => p.round === 2).sort((a, b) => a.roundPick - b.roundPick);
    if (r1.length > 1 && r2.length === r1.length && r2[0]!.teamId === r1[0]!.teamId)
      type = "linear";
  }
  return { type, rounds, picks };
}

function parsePlayers(rs: BundleResponse[], rosters: Map<string, EspnRosterEntry[]>) {
  const players: EspnSeason["players"] = new Map();
  for (const entries of rosters.values())
    for (const e of entries)
      if (!players.has(e.playerId))
        players.set(e.playerId, { name: e.name, position: e.position, proTeamId: e.proTeamId });
  for (const r of rs.filter((x) => x.endpoint === "playerCards"))
    for (const c of arr(obj(r.payload).players).map(obj)) {
      const id = num(c.id);
      const p = obj(c.player);
      if (id === null || players.has(id) || !str(p.fullName)) continue;
      const pos = num(p.defaultPositionId);
      players.set(id, {
        name: str(p.fullName)!,
        position: pos === null ? null : (POSITIONS[pos] ?? null),
        proTeamId: num(p.proTeamId),
      });
    }
  return players;
}

export function parseEspnBundle(year: number, leagueId: string, rs: BundleResponse[]): EspnSeason {
  const anomalies: string[] = [];
  const settingsRoot = obj(find(rs, "mSettings")?.payload);
  if (!find(rs, "mSettings") || !Object.keys(settingsRoot).length)
    throw new Error("the bundle has no mSettings response");
  const schedule = arr(obj(find(rs, "mMatchupScore")?.payload).schedule);
  const settings = parseSettings(settingsRoot, schedule, anomalies);
  const { teams, members } = parseTeams(obj(find(rs, "mTeam")?.payload));
  if (teams.length === 0) throw new Error("the bundle has no teams (mTeam)");
  const { games, weekScores } = parseGames(schedule);
  const rosters = parseRosters(rs);
  return {
    year,
    leagueId,
    settings,
    teams,
    members,
    games,
    rosters,
    weekScores,
    players: parsePlayers(rs, rosters),
    transactions: parseTransactions(rs, anomalies),
    draft: parseDraft(rs, teams.length),
    anomalies,
  };
}
