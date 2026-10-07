CREATE TYPE "public"."acquired_via" AS ENUM('draft', 'waiver', 'free_agent', 'trade', 'commissioner', 'initial');--> statement-breakpoint
CREATE TYPE "public"."admin_role" AS ENUM('owner', 'admin');--> statement-breakpoint
CREATE TYPE "public"."bracket" AS ENUM('winners', 'losers');--> statement-breakpoint
CREATE TYPE "public"."draft_kind" AS ENUM('startup', 'rookie', 'redraft');--> statement-breakpoint
CREATE TYPE "public"."draft_status" AS ENUM('pre_draft', 'drafting', 'complete');--> statement-breakpoint
CREATE TYPE "public"."draft_type" AS ENUM('snake', 'auction', 'linear');--> statement-breakpoint
CREATE TYPE "public"."game_result_kind" AS ENUM('h2h', 'median');--> statement-breakpoint
CREATE TYPE "public"."result" AS ENUM('W', 'L', 'T');--> statement-breakpoint
CREATE TYPE "public"."game_type" AS ENUM('regular', 'playoffs', 'toilet_bowl', 'none');--> statement-breakpoint
CREATE TYPE "public"."league_source" AS ENUM('sleeper', 'espn');--> statement-breakpoint
CREATE TYPE "public"."league_type" AS ENUM('redraft', 'dynasty');--> statement-breakpoint
CREATE TYPE "public"."left_via" AS ENUM('drop', 'trade', 'commissioner', 'season_end');--> statement-breakpoint
CREATE TYPE "public"."manager_role" AS ENUM('primary', 'co');--> statement-breakpoint
CREATE TYPE "public"."nfl_game_status" AS ENUM('scheduled', 'in_progress', 'final');--> statement-breakpoint
CREATE TYPE "public"."nfl_game_type" AS ENUM('REG', 'POST');--> statement-breakpoint
CREATE TYPE "public"."raw_source" AS ENUM('sleeper', 'espn', 'nflverse', 'dynastyprocess', 'blog');--> statement-breakpoint
CREATE TYPE "public"."season_status" AS ENUM('pre_draft', 'drafting', 'in_season', 'post_season', 'complete');--> statement-breakpoint
CREATE TYPE "public"."slot_kind" AS ENUM('starter', 'bench', 'ir', 'taxi');--> statement-breakpoint
CREATE TYPE "public"."sync_kind" AS ENUM('live', 'daily', 'finalize', 'nfl_reference', 'season_rollover', 'backfill', 'recompute', 'import_espn', 'migrate_mongo');--> statement-breakpoint
CREATE TYPE "public"."sync_status" AS ENUM('queued', 'running', 'success', 'failed');--> statement-breakpoint
CREATE TYPE "public"."trophy_kind" AS ENUM('winners_circle', 'podium', 'losers_circle', 'high_scorer', 'benchwarmer');--> statement-breakpoint
CREATE TYPE "public"."tx_direction" AS ENUM('add', 'drop', 'move');--> statement-breakpoint
CREATE TYPE "public"."tx_item_kind" AS ENUM('player', 'pick', 'faab');--> statement-breakpoint
CREATE TYPE "public"."tx_status" AS ENUM('complete', 'failed');--> statement-breakpoint
CREATE TYPE "public"."tx_type" AS ENUM('trade', 'waiver', 'free_agent', 'commissioner');--> statement-breakpoint
CREATE TYPE "public"."unmatched_status" AS ENUM('open', 'mapped', 'ignored');--> statement-breakpoint
CREATE TYPE "public"."waiver_type" AS ENUM('normal', 'faab');--> statement-breakpoint
CREATE TYPE "public"."week_status" AS ENUM('upcoming', 'in_progress', 'complete');--> statement-breakpoint
CREATE TABLE "raw_payload" (
	"id" integer PRIMARY KEY GENERATED ALWAYS AS IDENTITY (sequence name "raw_payload_id_seq" INCREMENT BY 1 MINVALUE 1 MAXVALUE 2147483647 START WITH 1 CACHE 1),
	"source" "raw_source" NOT NULL,
	"endpoint" text NOT NULL,
	"params" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"params_hash" text NOT NULL,
	"fetched_at" timestamp with time zone DEFAULT now() NOT NULL,
	"http_status" integer,
	"payload" jsonb,
	"body" text,
	"bundle" text
);
--> statement-breakpoint
CREATE TABLE "league" (
	"id" integer PRIMARY KEY GENERATED ALWAYS AS IDENTITY (sequence name "league_id_seq" INCREMENT BY 1 MINVALUE 1 MAXVALUE 2147483647 START WITH 1 CACHE 1),
	"slug" text NOT NULL,
	"name" text NOT NULL,
	"type" "league_type" NOT NULL,
	"color" text DEFAULT 'blue' NOT NULL,
	"display_order" integer DEFAULT 0 NOT NULL,
	"enabled" boolean DEFAULT true NOT NULL,
	CONSTRAINT "league_slug_unique" UNIQUE("slug")
);
--> statement-breakpoint
CREATE TABLE "league_season" (
	"id" integer PRIMARY KEY GENERATED ALWAYS AS IDENTITY (sequence name "league_season_id_seq" INCREMENT BY 1 MINVALUE 1 MAXVALUE 2147483647 START WITH 1 CACHE 1),
	"league_id" integer NOT NULL,
	"year" integer NOT NULL,
	"source" "league_source" NOT NULL,
	"external_id" text NOT NULL,
	"previous_external_id" text,
	"status" "season_status" DEFAULT 'pre_draft' NOT NULL,
	"enabled" boolean DEFAULT true NOT NULL,
	"regular_season_weeks" integer NOT NULL,
	"playoff_week_start" integer NOT NULL,
	"last_week" integer NOT NULL,
	"playoff_teams" integer NOT NULL,
	"team_count" integer NOT NULL,
	"median_enabled" boolean DEFAULT false NOT NULL,
	"has_losers_bracket" boolean DEFAULT false NOT NULL,
	"roster_slots" text[] DEFAULT '{}'::text[] NOT NULL,
	"bench_slots" integer DEFAULT 0 NOT NULL,
	"ir_slots" integer DEFAULT 0 NOT NULL,
	"taxi_slots" integer DEFAULT 0 NOT NULL,
	"scoring_settings" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"settings" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"waiver_type" "waiver_type" DEFAULT 'normal' NOT NULL,
	"faab_budget" integer,
	"has_player_data" boolean DEFAULT false NOT NULL,
	"has_projections" boolean DEFAULT false NOT NULL,
	"has_transactions" boolean DEFAULT false NOT NULL,
	"has_draft" boolean DEFAULT false NOT NULL,
	"has_faab" boolean DEFAULT false NOT NULL,
	"has_auction_draft" boolean DEFAULT false NOT NULL,
	"locked_flags" text[] DEFAULT '{}'::text[] NOT NULL,
	"last_completed_week" integer DEFAULT 0 NOT NULL,
	CONSTRAINT "league_season_league_year_uq" UNIQUE("league_id","year"),
	CONSTRAINT "league_season_source_external_uq" UNIQUE("source","external_id"),
	CONSTRAINT "league_season_weeks_ck" CHECK ("league_season"."playoff_week_start" > "league_season"."regular_season_weeks" AND "league_season"."last_week" >= "league_season"."playoff_week_start")
);
--> statement-breakpoint
CREATE TABLE "league_season_week" (
	"league_season_id" integer NOT NULL,
	"week" integer NOT NULL,
	"status" "week_status" DEFAULT 'upcoming' NOT NULL,
	"game_type_default" "game_type" NOT NULL,
	"finalized_at" timestamp with time zone,
	CONSTRAINT "league_season_week_league_season_id_week_pk" PRIMARY KEY("league_season_id","week")
);
--> statement-breakpoint
CREATE TABLE "league_threshold" (
	"id" integer PRIMARY KEY GENERATED ALWAYS AS IDENTITY (sequence name "league_threshold_id_seq" INCREMENT BY 1 MINVALUE 1 MAXVALUE 2147483647 START WITH 1 CACHE 1),
	"league_id" integer NOT NULL,
	"league_season_id" integer,
	"key" text NOT NULL,
	"value" numeric(10, 3) NOT NULL,
	CONSTRAINT "league_threshold_uq" UNIQUE NULLS NOT DISTINCT("league_id","league_season_id","key")
);
--> statement-breakpoint
CREATE TABLE "franchise" (
	"id" integer PRIMARY KEY GENERATED ALWAYS AS IDENTITY (sequence name "franchise_id_seq" INCREMENT BY 1 MINVALUE 1 MAXVALUE 2147483647 START WITH 1 CACHE 1),
	"league_id" integer NOT NULL,
	"name" text
);
--> statement-breakpoint
CREATE TABLE "manager" (
	"id" integer PRIMARY KEY GENERATED ALWAYS AS IDENTITY (sequence name "manager_id_seq" INCREMENT BY 1 MINVALUE 1 MAXVALUE 2147483647 START WITH 1 CACHE 1),
	"name" text NOT NULL,
	"avatar" text
);
--> statement-breakpoint
CREATE TABLE "manager_identity" (
	"id" integer PRIMARY KEY GENERATED ALWAYS AS IDENTITY (sequence name "manager_identity_id_seq" INCREMENT BY 1 MINVALUE 1 MAXVALUE 2147483647 START WITH 1 CACHE 1),
	"manager_id" integer NOT NULL,
	"source" "league_source" NOT NULL,
	"external_user_id" text NOT NULL,
	CONSTRAINT "manager_identity_uq" UNIQUE("source","external_user_id")
);
--> statement-breakpoint
CREATE TABLE "team_season" (
	"id" integer PRIMARY KEY GENERATED ALWAYS AS IDENTITY (sequence name "team_season_id_seq" INCREMENT BY 1 MINVALUE 1 MAXVALUE 2147483647 START WITH 1 CACHE 1),
	"league_season_id" integer NOT NULL,
	"franchise_id" integer NOT NULL,
	"external_roster_id" text NOT NULL,
	"name" text NOT NULL,
	"avatar" text,
	"division" text,
	"seed" integer,
	"final_place" integer,
	"made_playoffs" boolean,
	CONSTRAINT "team_season_franchise_uq" UNIQUE("league_season_id","franchise_id"),
	CONSTRAINT "team_season_roster_uq" UNIQUE("league_season_id","external_roster_id")
);
--> statement-breakpoint
CREATE TABLE "team_season_manager" (
	"team_season_id" integer NOT NULL,
	"manager_id" integer NOT NULL,
	"role" "manager_role" DEFAULT 'primary' NOT NULL,
	"from_week" integer,
	"to_week" integer,
	CONSTRAINT "team_season_manager_team_season_id_manager_id_pk" PRIMARY KEY("team_season_id","manager_id")
);
--> statement-breakpoint
CREATE TABLE "player" (
	"id" integer PRIMARY KEY GENERATED ALWAYS AS IDENTITY (sequence name "player_id_seq" INCREMENT BY 1 MINVALUE 1 MAXVALUE 2147483647 START WITH 1 CACHE 1),
	"sleeper_id" text,
	"espn_id" text,
	"gsis_id" text,
	"full_name" text NOT NULL,
	"position" text,
	"fantasy_positions" text[],
	"nfl_team" text,
	"injury_status" text,
	"status" text,
	"active" boolean,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "player_sleeperId_unique" UNIQUE("sleeper_id")
);
--> statement-breakpoint
CREATE TABLE "player_id_map" (
	"id" integer PRIMARY KEY GENERATED ALWAYS AS IDENTITY (sequence name "player_id_map_id_seq" INCREMENT BY 1 MINVALUE 1 MAXVALUE 2147483647 START WITH 1 CACHE 1),
	"player_id" integer,
	"sleeper_id" text,
	"espn_id" text,
	"gsis_id" text,
	"yahoo_id" text,
	"pfr_id" text,
	"name" text,
	"manual" boolean DEFAULT false NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "nfl_game" (
	"id" text PRIMARY KEY NOT NULL,
	"season" integer NOT NULL,
	"week" integer NOT NULL,
	"game_type" "nfl_game_type" NOT NULL,
	"source_game_type" text,
	"kickoff" timestamp with time zone,
	"home_team" text NOT NULL,
	"away_team" text NOT NULL,
	"home_score" integer,
	"away_score" integer,
	"status" "nfl_game_status" DEFAULT 'scheduled' NOT NULL
);
--> statement-breakpoint
CREATE TABLE "nfl_player_week" (
	"season" integer NOT NULL,
	"week" integer NOT NULL,
	"player_id" integer NOT NULL,
	"nfl_team" text NOT NULL,
	"status" text,
	"position" text,
	CONSTRAINT "nfl_player_week_season_week_player_id_pk" PRIMARY KEY("season","week","player_id")
);
--> statement-breakpoint
CREATE TABLE "nfl_state" (
	"season" integer PRIMARY KEY NOT NULL,
	"week" integer NOT NULL,
	"season_type" text NOT NULL,
	"display_week" integer,
	"league_season" text,
	"raw" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "nfl_team_alias" (
	"id" integer PRIMARY KEY GENERATED ALWAYS AS IDENTITY (sequence name "nfl_team_alias_id_seq" INCREMENT BY 1 MINVALUE 1 MAXVALUE 2147483647 START WITH 1 CACHE 1),
	"alias" text NOT NULL,
	"nfl_team" text NOT NULL,
	"season_from" integer,
	"season_to" integer,
	CONSTRAINT "nfl_team_alias_uq" UNIQUE NULLS NOT DISTINCT("alias","season_from")
);
--> statement-breakpoint
CREATE TABLE "nfl_team_week" (
	"season" integer NOT NULL,
	"week" integer NOT NULL,
	"nfl_team" text NOT NULL,
	"nfl_game_id" text,
	"is_bye" boolean DEFAULT false NOT NULL,
	CONSTRAINT "nfl_team_week_season_week_nfl_team_pk" PRIMARY KEY("season","week","nfl_team")
);
--> statement-breakpoint
CREATE TABLE "matchup" (
	"id" integer PRIMARY KEY GENERATED ALWAYS AS IDENTITY (sequence name "matchup_id_seq" INCREMENT BY 1 MINVALUE 1 MAXVALUE 2147483647 START WITH 1 CACHE 1),
	"league_season_id" integer NOT NULL,
	"week" integer NOT NULL,
	"external_matchup_id" integer,
	"game_type" "game_type" NOT NULL,
	"bracket" "bracket",
	"bracket_round" integer,
	"placement_at_stake" integer,
	"is_championship" boolean DEFAULT false NOT NULL,
	CONSTRAINT "matchup_external_uq" UNIQUE("league_season_id","week","external_matchup_id")
);
--> statement-breakpoint
CREATE TABLE "player_week" (
	"team_week_id" integer NOT NULL,
	"player_id" integer NOT NULL,
	"slot" text NOT NULL,
	"slot_kind" "slot_kind" NOT NULL,
	"points" numeric(10, 3),
	"projected_points" numeric(10, 3),
	"position" text,
	"eligible_positions" text[],
	"nfl_team" text,
	"nfl_game_id" text,
	"nfl_status" text,
	CONSTRAINT "player_week_team_week_id_player_id_pk" PRIMARY KEY("team_week_id","player_id")
);
--> statement-breakpoint
CREATE TABLE "roster_current" (
	"team_season_id" integer NOT NULL,
	"player_id" integer NOT NULL,
	"slot" text,
	"slot_kind" "slot_kind" NOT NULL,
	"acquired_via" "acquired_via",
	"acquired_at" timestamp with time zone,
	CONSTRAINT "roster_current_team_season_id_player_id_pk" PRIMARY KEY("team_season_id","player_id")
);
--> statement-breakpoint
CREATE TABLE "team_week" (
	"id" integer PRIMARY KEY GENERATED ALWAYS AS IDENTITY (sequence name "team_week_id_seq" INCREMENT BY 1 MINVALUE 1 MAXVALUE 2147483647 START WITH 1 CACHE 1),
	"league_season_id" integer NOT NULL,
	"team_season_id" integer NOT NULL,
	"week" integer NOT NULL,
	"matchup_id" integer,
	"opponent_team_season_id" integer,
	"counts" boolean DEFAULT true NOT NULL,
	"points" numeric(10, 3) DEFAULT 0 NOT NULL,
	"points_overridden" boolean DEFAULT false NOT NULL,
	"result" "result",
	"margin" numeric(10, 3),
	"is_final" boolean DEFAULT false NOT NULL,
	CONSTRAINT "team_week_team_week_uq" UNIQUE("team_season_id","week")
);
--> statement-breakpoint
CREATE TABLE "draft" (
	"id" integer PRIMARY KEY GENERATED ALWAYS AS IDENTITY (sequence name "draft_id_seq" INCREMENT BY 1 MINVALUE 1 MAXVALUE 2147483647 START WITH 1 CACHE 1),
	"league_season_id" integer NOT NULL,
	"external_id" text,
	"kind" "draft_kind" NOT NULL,
	"type" "draft_type" NOT NULL,
	"status" "draft_status" NOT NULL,
	"rounds" integer,
	"started_at" timestamp with time zone,
	"slot_order" jsonb,
	CONSTRAINT "draft_external_uq" UNIQUE("league_season_id","external_id")
);
--> statement-breakpoint
CREATE TABLE "draft_pick" (
	"draft_id" integer NOT NULL,
	"pick_no" integer NOT NULL,
	"round" integer NOT NULL,
	"slot" integer,
	"team_season_id" integer NOT NULL,
	"original_team_season_id" integer,
	"player_id" integer,
	"amount" integer,
	"is_keeper" boolean DEFAULT false NOT NULL,
	CONSTRAINT "draft_pick_draft_id_pick_no_pk" PRIMARY KEY("draft_id","pick_no")
);
--> statement-breakpoint
CREATE TABLE "traded_pick" (
	"id" integer PRIMARY KEY GENERATED ALWAYS AS IDENTITY (sequence name "traded_pick_id_seq" INCREMENT BY 1 MINVALUE 1 MAXVALUE 2147483647 START WITH 1 CACHE 1),
	"league_id" integer NOT NULL,
	"season" integer NOT NULL,
	"round" integer NOT NULL,
	"original_franchise_id" integer NOT NULL,
	"owner_franchise_id" integer NOT NULL,
	"as_of" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "traded_pick_uq" UNIQUE("league_id","season","round","original_franchise_id")
);
--> statement-breakpoint
CREATE TABLE "transaction" (
	"id" integer PRIMARY KEY GENERATED ALWAYS AS IDENTITY (sequence name "transaction_id_seq" INCREMENT BY 1 MINVALUE 1 MAXVALUE 2147483647 START WITH 1 CACHE 1),
	"league_season_id" integer NOT NULL,
	"external_id" text,
	"type" "tx_type" NOT NULL,
	"status" "tx_status" NOT NULL,
	"failure_reason" text,
	"week" integer NOT NULL,
	"executed_at" timestamp with time zone,
	"waiver_priority" integer,
	"creator_team_season_id" integer,
	CONSTRAINT "transaction_external_uq" UNIQUE("league_season_id","external_id")
);
--> statement-breakpoint
CREATE TABLE "transaction_item" (
	"id" integer PRIMARY KEY GENERATED ALWAYS AS IDENTITY (sequence name "transaction_item_id_seq" INCREMENT BY 1 MINVALUE 1 MAXVALUE 2147483647 START WITH 1 CACHE 1),
	"transaction_id" integer NOT NULL,
	"kind" "tx_item_kind" NOT NULL,
	"direction" "tx_direction" NOT NULL,
	"player_id" integer,
	"pick_season" integer,
	"pick_round" integer,
	"pick_original_franchise_id" integer,
	"amount" integer,
	"faab_bid" integer,
	"from_team_season_id" integer,
	"to_team_season_id" integer
);
--> statement-breakpoint
CREATE TABLE "data_version" (
	"league_season_id" integer PRIMARY KEY NOT NULL,
	"version" integer DEFAULT 1 NOT NULL,
	"derive_version" integer DEFAULT 0 NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "game_result" (
	"team_season_id" integer NOT NULL,
	"franchise_id" integer NOT NULL,
	"league_season_id" integer NOT NULL,
	"week" integer NOT NULL,
	"seq" integer NOT NULL,
	"kind" "game_result_kind" NOT NULL,
	"matchup_id" integer,
	"opponent_team_season_id" integer,
	"opponent_franchise_id" integer,
	"result" "result" NOT NULL,
	"game_type" "game_type" NOT NULL,
	"points_for" numeric(10, 3) NOT NULL,
	"points_against" numeric(10, 3) NOT NULL,
	CONSTRAINT "game_result_team_season_id_week_seq_pk" PRIMARY KEY("team_season_id","week","seq")
);
--> statement-breakpoint
CREATE TABLE "player_tenure" (
	"id" integer PRIMARY KEY GENERATED ALWAYS AS IDENTITY (sequence name "player_tenure_id_seq" INCREMENT BY 1 MINVALUE 1 MAXVALUE 2147483647 START WITH 1 CACHE 1),
	"player_id" integer NOT NULL,
	"team_season_id" integer NOT NULL,
	"from_week" integer NOT NULL,
	"to_week" integer NOT NULL,
	"acquired_via" "acquired_via" NOT NULL,
	"left_via" "left_via"
);
--> statement-breakpoint
CREATE TABLE "record_cache" (
	"record_id" text NOT NULL,
	"params_hash" text NOT NULL,
	"version_key" text NOT NULL,
	"payload" jsonb NOT NULL,
	"computed_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "record_cache_record_id_params_hash_version_key_pk" PRIMARY KEY("record_id","params_hash","version_key")
);
--> statement-breakpoint
CREATE TABLE "sync_run" (
	"id" integer PRIMARY KEY GENERATED ALWAYS AS IDENTITY (sequence name "sync_run_id_seq" INCREMENT BY 1 MINVALUE 1 MAXVALUE 2147483647 START WITH 1 CACHE 1),
	"kind" "sync_kind" NOT NULL,
	"league_season_id" integer,
	"triggered_by" text DEFAULT 'schedule' NOT NULL,
	"started_at" timestamp with time zone DEFAULT now() NOT NULL,
	"finished_at" timestamp with time zone,
	"status" "sync_status" DEFAULT 'running' NOT NULL,
	"log" text,
	"stats" jsonb
);
--> statement-breakpoint
CREATE TABLE "team_season_week" (
	"team_season_id" integer NOT NULL,
	"week" integer NOT NULL,
	"wins" integer NOT NULL,
	"losses" integer NOT NULL,
	"ties" integer NOT NULL,
	"pf" numeric(10, 3) NOT NULL,
	"pa" numeric(10, 3) NOT NULL,
	"rank" integer NOT NULL,
	"games_back" numeric(10, 3),
	"clinched" text,
	"eliminated" boolean,
	CONSTRAINT "team_season_week_team_season_id_week_pk" PRIMARY KEY("team_season_id","week")
);
--> statement-breakpoint
CREATE TABLE "team_week_stats" (
	"team_week_id" integer PRIMARY KEY NOT NULL,
	"optimal_points" numeric(10, 3),
	"bench_points" numeric(10, 3),
	"ir_points" numeric(10, 3),
	"projected_points" numeric(10, 3),
	"lineup_iq" numeric(10, 3),
	"is_perfect" boolean,
	"week_median" numeric(10, 3),
	"week_mean" numeric(10, 3),
	"week_rank" integer,
	"week_zscore" numeric(10, 3),
	"allplay_w" integer,
	"allplay_l" integer,
	"allplay_t" integer,
	"top_player_share" numeric(10, 3)
);
--> statement-breakpoint
CREATE TABLE "trophy" (
	"id" integer PRIMARY KEY GENERATED ALWAYS AS IDENTITY (sequence name "trophy_id_seq" INCREMENT BY 1 MINVALUE 1 MAXVALUE 2147483647 START WITH 1 CACHE 1),
	"kind" "trophy_kind" NOT NULL,
	"team_season_id" integer NOT NULL,
	"team_week_id" integer,
	"value" numeric(10, 3)
);
--> statement-breakpoint
CREATE TABLE "admin_account" (
	"id" text PRIMARY KEY NOT NULL,
	"user_id" text NOT NULL,
	"account_id" text NOT NULL,
	"provider_id" text NOT NULL,
	"access_token" text,
	"refresh_token" text,
	"id_token" text,
	"access_token_expires_at" timestamp with time zone,
	"refresh_token_expires_at" timestamp with time zone,
	"scope" text,
	"password" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "admin_invite" (
	"id" integer PRIMARY KEY GENERATED ALWAYS AS IDENTITY (sequence name "admin_invite_id_seq" INCREMENT BY 1 MINVALUE 1 MAXVALUE 2147483647 START WITH 1 CACHE 1),
	"token_hash" text NOT NULL,
	"email" text,
	"role" "admin_role" DEFAULT 'admin' NOT NULL,
	"created_by" text,
	"expires_at" timestamp with time zone NOT NULL,
	"used_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "admin_invite_tokenHash_unique" UNIQUE("token_hash")
);
--> statement-breakpoint
CREATE TABLE "admin_session" (
	"id" text PRIMARY KEY NOT NULL,
	"user_id" text NOT NULL,
	"token" text NOT NULL,
	"expires_at" timestamp with time zone NOT NULL,
	"ip_address" text,
	"user_agent" text,
	"impersonated_by" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "admin_session_token_unique" UNIQUE("token")
);
--> statement-breakpoint
CREATE TABLE "admin_user" (
	"id" text PRIMARY KEY NOT NULL,
	"name" text NOT NULL,
	"email" text NOT NULL,
	"email_verified" boolean DEFAULT false NOT NULL,
	"image" text,
	"role" "admin_role" DEFAULT 'admin' NOT NULL,
	"banned" boolean DEFAULT false NOT NULL,
	"ban_reason" text,
	"ban_expires" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	"last_login_at" timestamp with time zone,
	CONSTRAINT "admin_user_email_unique" UNIQUE("email")
);
--> statement-breakpoint
CREATE TABLE "admin_verification" (
	"id" text PRIMARY KEY NOT NULL,
	"identifier" text NOT NULL,
	"value" text NOT NULL,
	"expires_at" timestamp with time zone NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "audit_log" (
	"id" integer PRIMARY KEY GENERATED ALWAYS AS IDENTITY (sequence name "audit_log_id_seq" INCREMENT BY 1 MINVALUE 1 MAXVALUE 2147483647 START WITH 1 CACHE 1),
	"user_id" text,
	"action" text NOT NULL,
	"entity" text NOT NULL,
	"entity_id" text,
	"before" jsonb,
	"after" jsonb,
	"at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "override" (
	"id" integer PRIMARY KEY GENERATED ALWAYS AS IDENTITY (sequence name "override_id_seq" INCREMENT BY 1 MINVALUE 1 MAXVALUE 2147483647 START WITH 1 CACHE 1),
	"entity" text NOT NULL,
	"entity_id" text NOT NULL,
	"field" text NOT NULL,
	"value" jsonb NOT NULL,
	"reason" text NOT NULL,
	"created_by" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"active" boolean DEFAULT true NOT NULL
);
--> statement-breakpoint
CREATE TABLE "record_config" (
	"id" integer PRIMARY KEY GENERATED ALWAYS AS IDENTITY (sequence name "record_config_id_seq" INCREMENT BY 1 MINVALUE 1 MAXVALUE 2147483647 START WITH 1 CACHE 1),
	"league_id" integer,
	"record_id" text NOT NULL,
	"visible" boolean DEFAULT true NOT NULL,
	"sort_order" integer DEFAULT 0 NOT NULL,
	"featured" boolean DEFAULT false NOT NULL,
	CONSTRAINT "record_config_uq" UNIQUE NULLS NOT DISTINCT("league_id","record_id")
);
--> statement-breakpoint
CREATE TABLE "site_config" (
	"key" text PRIMARY KEY NOT NULL,
	"value" jsonb NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "unmatched_player" (
	"id" integer PRIMARY KEY GENERATED ALWAYS AS IDENTITY (sequence name "unmatched_player_id_seq" INCREMENT BY 1 MINVALUE 1 MAXVALUE 2147483647 START WITH 1 CACHE 1),
	"source" "league_source" NOT NULL,
	"external_id" text NOT NULL,
	"name" text,
	"position" text,
	"nfl_team" text,
	"context" jsonb,
	"status" "unmatched_status" DEFAULT 'open' NOT NULL,
	"resolved_player_id" integer,
	"first_seen_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "unmatched_player_uq" UNIQUE("source","external_id")
);
--> statement-breakpoint
ALTER TABLE "league_season" ADD CONSTRAINT "league_season_league_id_league_id_fk" FOREIGN KEY ("league_id") REFERENCES "public"."league"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "league_season_week" ADD CONSTRAINT "league_season_week_league_season_id_league_season_id_fk" FOREIGN KEY ("league_season_id") REFERENCES "public"."league_season"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "league_threshold" ADD CONSTRAINT "league_threshold_league_id_league_id_fk" FOREIGN KEY ("league_id") REFERENCES "public"."league"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "league_threshold" ADD CONSTRAINT "league_threshold_league_season_id_league_season_id_fk" FOREIGN KEY ("league_season_id") REFERENCES "public"."league_season"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "franchise" ADD CONSTRAINT "franchise_league_id_league_id_fk" FOREIGN KEY ("league_id") REFERENCES "public"."league"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "manager_identity" ADD CONSTRAINT "manager_identity_manager_id_manager_id_fk" FOREIGN KEY ("manager_id") REFERENCES "public"."manager"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "team_season" ADD CONSTRAINT "team_season_league_season_id_league_season_id_fk" FOREIGN KEY ("league_season_id") REFERENCES "public"."league_season"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "team_season" ADD CONSTRAINT "team_season_franchise_id_franchise_id_fk" FOREIGN KEY ("franchise_id") REFERENCES "public"."franchise"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "team_season_manager" ADD CONSTRAINT "team_season_manager_team_season_id_team_season_id_fk" FOREIGN KEY ("team_season_id") REFERENCES "public"."team_season"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "team_season_manager" ADD CONSTRAINT "team_season_manager_manager_id_manager_id_fk" FOREIGN KEY ("manager_id") REFERENCES "public"."manager"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "player_id_map" ADD CONSTRAINT "player_id_map_player_id_player_id_fk" FOREIGN KEY ("player_id") REFERENCES "public"."player"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "nfl_player_week" ADD CONSTRAINT "nfl_player_week_player_id_player_id_fk" FOREIGN KEY ("player_id") REFERENCES "public"."player"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "nfl_team_week" ADD CONSTRAINT "nfl_team_week_nfl_game_id_nfl_game_id_fk" FOREIGN KEY ("nfl_game_id") REFERENCES "public"."nfl_game"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "matchup" ADD CONSTRAINT "matchup_league_season_id_league_season_id_fk" FOREIGN KEY ("league_season_id") REFERENCES "public"."league_season"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "player_week" ADD CONSTRAINT "player_week_team_week_id_team_week_id_fk" FOREIGN KEY ("team_week_id") REFERENCES "public"."team_week"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "player_week" ADD CONSTRAINT "player_week_player_id_player_id_fk" FOREIGN KEY ("player_id") REFERENCES "public"."player"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "player_week" ADD CONSTRAINT "player_week_nfl_game_id_nfl_game_id_fk" FOREIGN KEY ("nfl_game_id") REFERENCES "public"."nfl_game"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "roster_current" ADD CONSTRAINT "roster_current_team_season_id_team_season_id_fk" FOREIGN KEY ("team_season_id") REFERENCES "public"."team_season"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "roster_current" ADD CONSTRAINT "roster_current_player_id_player_id_fk" FOREIGN KEY ("player_id") REFERENCES "public"."player"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "team_week" ADD CONSTRAINT "team_week_league_season_id_league_season_id_fk" FOREIGN KEY ("league_season_id") REFERENCES "public"."league_season"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "team_week" ADD CONSTRAINT "team_week_team_season_id_team_season_id_fk" FOREIGN KEY ("team_season_id") REFERENCES "public"."team_season"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "team_week" ADD CONSTRAINT "team_week_matchup_id_matchup_id_fk" FOREIGN KEY ("matchup_id") REFERENCES "public"."matchup"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "team_week" ADD CONSTRAINT "team_week_opponent_team_season_id_team_season_id_fk" FOREIGN KEY ("opponent_team_season_id") REFERENCES "public"."team_season"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "draft" ADD CONSTRAINT "draft_league_season_id_league_season_id_fk" FOREIGN KEY ("league_season_id") REFERENCES "public"."league_season"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "draft_pick" ADD CONSTRAINT "draft_pick_draft_id_draft_id_fk" FOREIGN KEY ("draft_id") REFERENCES "public"."draft"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "draft_pick" ADD CONSTRAINT "draft_pick_team_season_id_team_season_id_fk" FOREIGN KEY ("team_season_id") REFERENCES "public"."team_season"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "draft_pick" ADD CONSTRAINT "draft_pick_original_team_season_id_team_season_id_fk" FOREIGN KEY ("original_team_season_id") REFERENCES "public"."team_season"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "draft_pick" ADD CONSTRAINT "draft_pick_player_id_player_id_fk" FOREIGN KEY ("player_id") REFERENCES "public"."player"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "traded_pick" ADD CONSTRAINT "traded_pick_league_id_league_id_fk" FOREIGN KEY ("league_id") REFERENCES "public"."league"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "traded_pick" ADD CONSTRAINT "traded_pick_original_franchise_id_franchise_id_fk" FOREIGN KEY ("original_franchise_id") REFERENCES "public"."franchise"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "traded_pick" ADD CONSTRAINT "traded_pick_owner_franchise_id_franchise_id_fk" FOREIGN KEY ("owner_franchise_id") REFERENCES "public"."franchise"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "transaction" ADD CONSTRAINT "transaction_league_season_id_league_season_id_fk" FOREIGN KEY ("league_season_id") REFERENCES "public"."league_season"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "transaction" ADD CONSTRAINT "transaction_creator_team_season_id_team_season_id_fk" FOREIGN KEY ("creator_team_season_id") REFERENCES "public"."team_season"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "transaction_item" ADD CONSTRAINT "transaction_item_transaction_id_transaction_id_fk" FOREIGN KEY ("transaction_id") REFERENCES "public"."transaction"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "transaction_item" ADD CONSTRAINT "transaction_item_player_id_player_id_fk" FOREIGN KEY ("player_id") REFERENCES "public"."player"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "transaction_item" ADD CONSTRAINT "transaction_item_pick_original_franchise_id_franchise_id_fk" FOREIGN KEY ("pick_original_franchise_id") REFERENCES "public"."franchise"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "transaction_item" ADD CONSTRAINT "transaction_item_from_team_season_id_team_season_id_fk" FOREIGN KEY ("from_team_season_id") REFERENCES "public"."team_season"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "transaction_item" ADD CONSTRAINT "transaction_item_to_team_season_id_team_season_id_fk" FOREIGN KEY ("to_team_season_id") REFERENCES "public"."team_season"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "data_version" ADD CONSTRAINT "data_version_league_season_id_league_season_id_fk" FOREIGN KEY ("league_season_id") REFERENCES "public"."league_season"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "game_result" ADD CONSTRAINT "game_result_team_season_id_team_season_id_fk" FOREIGN KEY ("team_season_id") REFERENCES "public"."team_season"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "game_result" ADD CONSTRAINT "game_result_franchise_id_franchise_id_fk" FOREIGN KEY ("franchise_id") REFERENCES "public"."franchise"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "game_result" ADD CONSTRAINT "game_result_league_season_id_league_season_id_fk" FOREIGN KEY ("league_season_id") REFERENCES "public"."league_season"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "game_result" ADD CONSTRAINT "game_result_matchup_id_matchup_id_fk" FOREIGN KEY ("matchup_id") REFERENCES "public"."matchup"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "game_result" ADD CONSTRAINT "game_result_opponent_team_season_id_team_season_id_fk" FOREIGN KEY ("opponent_team_season_id") REFERENCES "public"."team_season"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "game_result" ADD CONSTRAINT "game_result_opponent_franchise_id_franchise_id_fk" FOREIGN KEY ("opponent_franchise_id") REFERENCES "public"."franchise"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "player_tenure" ADD CONSTRAINT "player_tenure_player_id_player_id_fk" FOREIGN KEY ("player_id") REFERENCES "public"."player"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "player_tenure" ADD CONSTRAINT "player_tenure_team_season_id_team_season_id_fk" FOREIGN KEY ("team_season_id") REFERENCES "public"."team_season"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "sync_run" ADD CONSTRAINT "sync_run_league_season_id_league_season_id_fk" FOREIGN KEY ("league_season_id") REFERENCES "public"."league_season"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "team_season_week" ADD CONSTRAINT "team_season_week_team_season_id_team_season_id_fk" FOREIGN KEY ("team_season_id") REFERENCES "public"."team_season"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "team_week_stats" ADD CONSTRAINT "team_week_stats_team_week_id_team_week_id_fk" FOREIGN KEY ("team_week_id") REFERENCES "public"."team_week"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "trophy" ADD CONSTRAINT "trophy_team_season_id_team_season_id_fk" FOREIGN KEY ("team_season_id") REFERENCES "public"."team_season"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "trophy" ADD CONSTRAINT "trophy_team_week_id_team_week_id_fk" FOREIGN KEY ("team_week_id") REFERENCES "public"."team_week"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "admin_account" ADD CONSTRAINT "admin_account_user_id_admin_user_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."admin_user"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "admin_invite" ADD CONSTRAINT "admin_invite_created_by_admin_user_id_fk" FOREIGN KEY ("created_by") REFERENCES "public"."admin_user"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "admin_session" ADD CONSTRAINT "admin_session_user_id_admin_user_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."admin_user"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "audit_log" ADD CONSTRAINT "audit_log_user_id_admin_user_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."admin_user"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "override" ADD CONSTRAINT "override_created_by_admin_user_id_fk" FOREIGN KEY ("created_by") REFERENCES "public"."admin_user"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "record_config" ADD CONSTRAINT "record_config_league_id_league_id_fk" FOREIGN KEY ("league_id") REFERENCES "public"."league"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "unmatched_player" ADD CONSTRAINT "unmatched_player_resolved_player_id_player_id_fk" FOREIGN KEY ("resolved_player_id") REFERENCES "public"."player"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "raw_payload_lookup_idx" ON "raw_payload" USING btree ("source","endpoint","params_hash","fetched_at" DESC NULLS LAST);--> statement-breakpoint
CREATE INDEX "league_threshold_league_idx" ON "league_threshold" USING btree ("league_id");--> statement-breakpoint
CREATE INDEX "franchise_league_idx" ON "franchise" USING btree ("league_id");--> statement-breakpoint
CREATE INDEX "manager_identity_manager_idx" ON "manager_identity" USING btree ("manager_id");--> statement-breakpoint
CREATE INDEX "team_season_franchise_idx" ON "team_season" USING btree ("franchise_id");--> statement-breakpoint
CREATE INDEX "team_season_manager_manager_idx" ON "team_season_manager" USING btree ("manager_id");--> statement-breakpoint
CREATE INDEX "player_espn_idx" ON "player" USING btree ("espn_id");--> statement-breakpoint
CREATE INDEX "player_gsis_idx" ON "player" USING btree ("gsis_id");--> statement-breakpoint
CREATE INDEX "player_id_map_sleeper_idx" ON "player_id_map" USING btree ("sleeper_id");--> statement-breakpoint
CREATE INDEX "player_id_map_espn_idx" ON "player_id_map" USING btree ("espn_id");--> statement-breakpoint
CREATE INDEX "player_id_map_gsis_idx" ON "player_id_map" USING btree ("gsis_id");--> statement-breakpoint
CREATE INDEX "player_id_map_player_idx" ON "player_id_map" USING btree ("player_id");--> statement-breakpoint
CREATE INDEX "nfl_game_season_week_idx" ON "nfl_game" USING btree ("season","week");--> statement-breakpoint
CREATE INDEX "nfl_player_week_player_idx" ON "nfl_player_week" USING btree ("player_id");--> statement-breakpoint
CREATE INDEX "matchup_season_week_idx" ON "matchup" USING btree ("league_season_id","week");--> statement-breakpoint
CREATE INDEX "player_week_player_idx" ON "player_week" USING btree ("player_id");--> statement-breakpoint
CREATE INDEX "roster_current_player_idx" ON "roster_current" USING btree ("player_id");--> statement-breakpoint
CREATE INDEX "team_week_season_week_idx" ON "team_week" USING btree ("league_season_id","week");--> statement-breakpoint
CREATE INDEX "team_week_matchup_idx" ON "team_week" USING btree ("matchup_id");--> statement-breakpoint
CREATE INDEX "draft_pick_team_idx" ON "draft_pick" USING btree ("team_season_id");--> statement-breakpoint
CREATE INDEX "draft_pick_player_idx" ON "draft_pick" USING btree ("player_id");--> statement-breakpoint
CREATE INDEX "transaction_season_week_idx" ON "transaction" USING btree ("league_season_id","week");--> statement-breakpoint
CREATE INDEX "transaction_item_tx_idx" ON "transaction_item" USING btree ("transaction_id");--> statement-breakpoint
CREATE INDEX "transaction_item_player_idx" ON "transaction_item" USING btree ("player_id");--> statement-breakpoint
CREATE INDEX "transaction_item_to_idx" ON "transaction_item" USING btree ("to_team_season_id");--> statement-breakpoint
CREATE INDEX "transaction_item_from_idx" ON "transaction_item" USING btree ("from_team_season_id");--> statement-breakpoint
CREATE INDEX "game_result_franchise_idx" ON "game_result" USING btree ("franchise_id","league_season_id","kind","game_type");--> statement-breakpoint
CREATE INDEX "game_result_season_idx" ON "game_result" USING btree ("league_season_id","week");--> statement-breakpoint
CREATE INDEX "game_result_opponent_idx" ON "game_result" USING btree ("franchise_id","opponent_franchise_id");--> statement-breakpoint
CREATE INDEX "player_tenure_team_idx" ON "player_tenure" USING btree ("team_season_id");--> statement-breakpoint
CREATE INDEX "player_tenure_player_idx" ON "player_tenure" USING btree ("player_id");--> statement-breakpoint
CREATE INDEX "sync_run_kind_idx" ON "sync_run" USING btree ("kind","status","started_at" DESC NULLS LAST);--> statement-breakpoint
CREATE INDEX "trophy_team_season_idx" ON "trophy" USING btree ("team_season_id","kind");--> statement-breakpoint
CREATE INDEX "admin_account_user_idx" ON "admin_account" USING btree ("user_id");--> statement-breakpoint
CREATE INDEX "admin_session_user_idx" ON "admin_session" USING btree ("user_id");--> statement-breakpoint
CREATE INDEX "audit_log_at_idx" ON "audit_log" USING btree ("at" DESC NULLS LAST);--> statement-breakpoint
CREATE INDEX "audit_log_entity_idx" ON "audit_log" USING btree ("entity","entity_id");--> statement-breakpoint
CREATE INDEX "override_entity_idx" ON "override" USING btree ("entity","entity_id","active");