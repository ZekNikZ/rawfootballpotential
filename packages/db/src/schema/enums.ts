import { pgEnum } from "drizzle-orm/pg-core";

// Fixed value sets from docs/records-architecture.md §3.2, §3.7 and §3.9.
export const rawSource = pgEnum("raw_source", [
  "sleeper",
  "espn",
  "nflverse",
  "dynastyprocess",
  "blog",
]);
export const leagueSource = pgEnum("league_source", ["sleeper", "espn"]);
export const leagueType = pgEnum("league_type", ["redraft", "dynasty"]);
export const seasonStatus = pgEnum("season_status", [
  "pre_draft",
  "drafting",
  "in_season",
  "post_season",
  "complete",
]);
export const weekStatus = pgEnum("week_status", ["upcoming", "in_progress", "complete"]);
export const waiverType = pgEnum("waiver_type", ["normal", "faab"]);
export const gameType = pgEnum("game_type", ["regular", "playoffs", "toilet_bowl", "none"]);
export const bracket = pgEnum("bracket", ["winners", "losers"]);
export const gameResultValue = pgEnum("result", ["W", "L", "T"]);
export const gameResultKind = pgEnum("game_result_kind", ["h2h", "median"]);
export const managerRole = pgEnum("manager_role", ["primary", "co"]);
export const slotKind = pgEnum("slot_kind", ["starter", "bench", "ir", "taxi"]);
export const txType = pgEnum("tx_type", ["trade", "waiver", "free_agent", "commissioner"]);
export const txStatus = pgEnum("tx_status", ["complete", "failed"]);
export const txItemKind = pgEnum("tx_item_kind", ["player", "pick", "faab"]);
export const txDirection = pgEnum("tx_direction", ["add", "drop", "move"]);
export const draftKind = pgEnum("draft_kind", ["startup", "rookie", "redraft"]);
export const draftType = pgEnum("draft_type", ["snake", "auction", "linear"]);
export const draftStatus = pgEnum("draft_status", ["pre_draft", "drafting", "complete"]);
export const nflGameType = pgEnum("nfl_game_type", ["REG", "POST"]);
export const nflGameStatus = pgEnum("nfl_game_status", ["scheduled", "in_progress", "final"]);
export const acquiredVia = pgEnum("acquired_via", [
  "draft",
  "waiver",
  "free_agent",
  "trade",
  "commissioner",
  "initial",
]);
export const leftVia = pgEnum("left_via", ["drop", "trade", "commissioner", "season_end"]);
export const trophyKind = pgEnum("trophy_kind", [
  "winners_circle",
  "podium",
  "losers_circle",
  "high_scorer",
  "benchwarmer",
]);
export const syncKind = pgEnum("sync_kind", [
  "live",
  "daily",
  "finalize",
  "nfl_reference",
  "season_rollover",
  "backfill",
  "recompute",
  "import_espn",
  "migrate_mongo",
]);
export const syncStatus = pgEnum("sync_status", ["queued", "running", "success", "failed"]);
export const adminRole = pgEnum("admin_role", ["owner", "admin"]);
export const unmatchedStatus = pgEnum("unmatched_status", ["open", "mapped", "ignored"]);
