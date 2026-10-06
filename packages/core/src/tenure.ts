import type { Id } from "./types";

export type AcquiredVia = "draft" | "waiver" | "free_agent" | "trade" | "commissioner" | "initial";
export type LeftVia = "drop" | "trade" | "commissioner" | "season_end";

/**
 * A roster event for one team season. A player added in week w is on the roster from week w;
 * a player removed in week w was last on it in week w - 1 (transactions apply before that week's games).
 * The draft is an add in week 1 (or the first week).
 */
export type RosterEvent =
  | { playerId: Id; week: number; kind: "add"; via: Exclude<AcquiredVia, "initial"> }
  | { playerId: Id; week: number; kind: "remove"; via: Exclude<LeftVia, "season_end"> };

export interface Tenure {
  playerId: Id;
  fromWeek: number;
  toWeek: number;
  acquiredVia: AcquiredVia;
  /** null while the stint is still open in an incomplete season. */
  leftVia: LeftVia | null;
}

export interface TenureInput {
  firstWeek: number;
  /** Last week to extend open stints to (the final week of the season, or the latest completed week). */
  throughWeek: number;
  /** True once the season is over: open stints end with `season_end`. */
  seasonComplete: boolean;
  /** Players already on the roster at `firstWeek` with no add event (data gaps). */
  initialPlayers?: readonly Id[];
  /** In chronological order; events in the same week keep their given order. */
  events: readonly RosterEvent[];
}

/**
 * Continuous stints of a player on one team within a season (doc §3.2 `player_tenure`). Dropping and later
 * re-acquiring the same player produces two stints, which is what draft retention relies on.
 */
export function buildTenures(input: TenureInput): Tenure[] {
  const open = new Map<Id, { fromWeek: number; via: AcquiredVia }>();
  const out: Tenure[] = [];

  for (const p of input.initialPlayers ?? [])
    open.set(p, { fromWeek: input.firstWeek, via: "initial" });

  const events = input.events
    .map((e, i) => ({ e, i }))
    .sort((a, b) => a.e.week - b.e.week || a.i - b.i)
    .map((x) => x.e);

  for (const ev of events) {
    if (ev.kind === "add") {
      if (!open.has(ev.playerId)) open.set(ev.playerId, { fromWeek: ev.week, via: ev.via });
      continue;
    }
    const stint = open.get(ev.playerId);
    if (!stint) continue; // removal of a player we never saw added: ignore
    open.delete(ev.playerId);
    const toWeek = ev.week - 1;
    // Added and removed in the same week (never on a scored roster): no stint.
    if (toWeek >= stint.fromWeek) {
      out.push({
        playerId: ev.playerId,
        fromWeek: stint.fromWeek,
        toWeek,
        acquiredVia: stint.via,
        leftVia: ev.via,
      });
    }
  }

  for (const [playerId, stint] of open) {
    if (stint.fromWeek > input.throughWeek) continue;
    out.push({
      playerId,
      fromWeek: stint.fromWeek,
      toWeek: input.throughWeek,
      acquiredVia: stint.via,
      leftVia: input.seasonComplete ? "season_end" : null,
    });
  }
  return out.sort(
    (a, b) => a.fromWeek - b.fromWeek || String(a.playerId).localeCompare(String(b.playerId))
  );
}
