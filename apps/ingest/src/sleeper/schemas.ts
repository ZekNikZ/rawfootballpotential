import { z } from "zod";

// Lenient schemas for the parts of Sleeper's payloads we read. Unknown fields are ignored; the full payload
// is always kept in raw_payload.

const num = z.number();
const optNum = z.number().nullish();
const idStr = z.union([z.string(), z.number()]).transform(String);

export const sleeperLeague = z.object({
  league_id: idStr,
  previous_league_id: idStr.nullish(),
  name: z.string(),
  season: idStr,
  status: z.string(),
  total_rosters: num,
  roster_positions: z.array(z.string()),
  scoring_settings: z.record(z.string(), z.number()),
  metadata: z.record(z.string(), z.unknown()).nullish(),
  draft_id: idStr.nullish(),
  settings: z
    .object({
      num_teams: optNum,
      playoff_week_start: num,
      playoff_teams: num,
      playoff_round_type: optNum,
      playoff_type: optNum,
      league_average_match: optNum,
      waiver_type: optNum,
      waiver_budget: optNum,
      reserve_slots: optNum,
      taxi_slots: optNum,
      divisions: optNum,
      last_scored_leg: optNum,
      leg: optNum,
      type: optNum,
      pick_trading: optNum,
    })
    .loose(),
});
export type SleeperLeague = z.infer<typeof sleeperLeague>;

export const sleeperUser = z.object({
  user_id: idStr,
  display_name: z.string(),
  avatar: z.string().nullish(),
  metadata: z.record(z.string(), z.unknown()).nullish(),
});
export type SleeperUser = z.infer<typeof sleeperUser>;

export const sleeperRoster = z.object({
  roster_id: num,
  owner_id: idStr.nullish(),
  co_owners: z.array(idStr).nullish(),
  players: z.array(idStr).nullish(),
  starters: z.array(idStr).nullish(),
  reserve: z.array(idStr).nullish(),
  taxi: z.array(idStr).nullish(),
  settings: z
    .object({
      wins: optNum,
      losses: optNum,
      ties: optNum,
      fpts: optNum,
      fpts_decimal: optNum,
      fpts_against: optNum,
      fpts_against_decimal: optNum,
      division: optNum,
    })
    .loose(),
});
export type SleeperRoster = z.infer<typeof sleeperRoster>;

export const sleeperMatchupEntry = z.object({
  roster_id: num,
  matchup_id: optNum,
  points: z.number().nullish(),
  custom_points: z.number().nullish(),
  starters: z.array(idStr).nullish(),
  starters_points: z.array(z.number().nullable()).nullish(),
  players: z.array(idStr).nullish(),
  players_points: z.record(z.string(), z.number().nullable()).nullish(),
});
export type SleeperMatchupEntry = z.infer<typeof sleeperMatchupEntry>;

const bracketTeam = z.union([z.number(), z.null()]).optional();
export const sleeperBracketGame = z.object({
  r: num,
  m: num,
  t1: bracketTeam,
  t2: bracketTeam,
  w: bracketTeam,
  l: bracketTeam,
  p: z.number().nullish(),
});
export type SleeperBracketGame = z.infer<typeof sleeperBracketGame>;

export const sleeperTransaction = z.object({
  transaction_id: idStr,
  type: z.string(),
  status: z.string(),
  leg: num,
  created: optNum,
  status_updated: optNum,
  creator: idStr.nullish(),
  roster_ids: z.array(num).nullish(),
  consenter_ids: z.array(num).nullish(),
  adds: z.record(z.string(), num).nullish(),
  drops: z.record(z.string(), num).nullish(),
  draft_picks: z
    .array(
      z.object({
        season: idStr,
        round: num,
        roster_id: num,
        previous_owner_id: num,
        owner_id: num,
      })
    )
    .nullish(),
  waiver_budget: z.array(z.object({ sender: num, receiver: num, amount: num })).nullish(),
  settings: z.record(z.string(), z.unknown()).nullish(),
  metadata: z.record(z.string(), z.unknown()).nullish(),
});
export type SleeperTransaction = z.infer<typeof sleeperTransaction>;

export const sleeperDraft = z.object({
  draft_id: idStr,
  status: z.string(),
  type: z.string(),
  start_time: optNum,
  season: idStr,
  draft_order: z.record(z.string(), z.number()).nullish(),
  slot_to_roster_id: z.record(z.string(), z.number()).nullish(),
  settings: z.record(z.string(), z.unknown()).nullish(),
});
export type SleeperDraft = z.infer<typeof sleeperDraft>;

export const sleeperDraftPick = z.object({
  pick_no: num,
  round: num,
  draft_slot: optNum,
  roster_id: optNum,
  player_id: idStr.nullish(),
  is_keeper: z.boolean().nullish(),
  metadata: z.record(z.string(), z.unknown()).nullish(),
});
export type SleeperDraftPick = z.infer<typeof sleeperDraftPick>;

export const sleeperTradedPick = z.object({
  season: idStr,
  round: num,
  roster_id: num,
  owner_id: num,
  previous_owner_id: optNum,
});
export type SleeperTradedPick = z.infer<typeof sleeperTradedPick>;

export const sleeperNflState = z.object({
  week: num,
  season: idStr,
  season_type: z.string(),
  display_week: optNum,
  league_season: idStr.nullish(),
  previous_season: idStr.nullish(),
});
export type SleeperNflState = z.infer<typeof sleeperNflState>;

export const sleeperPlayer = z
  .object({
    player_id: idStr,
    first_name: z.string().nullish(),
    last_name: z.string().nullish(),
    full_name: z.string().nullish(),
    position: z.string().nullish(),
    fantasy_positions: z.array(z.string()).nullish(),
    team: z.string().nullish(),
    injury_status: z.string().nullish(),
    status: z.string().nullish(),
    active: z.boolean().nullish(),
    espn_id: idStr.nullish(),
    gsis_id: idStr.nullish(),
  })
  .loose();
export type SleeperPlayer = z.infer<typeof sleeperPlayer>;

export const sleeperProjection = z.object({
  player_id: idStr,
  stats: z.record(z.string(), z.number()).nullish(),
});
export type SleeperProjection = z.infer<typeof sleeperProjection>;

export const sleeperUserLeague = z.object({
  league_id: idStr,
  previous_league_id: idStr.nullish(),
  name: z.string(),
  season: idStr,
});
