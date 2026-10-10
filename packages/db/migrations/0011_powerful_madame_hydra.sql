CREATE TABLE "player_week_points" (
	"league_season_id" integer NOT NULL,
	"week" integer NOT NULL,
	"player_id" integer NOT NULL,
	"points" numeric(10, 3) NOT NULL,
	CONSTRAINT "player_week_points_league_season_id_week_player_id_pk" PRIMARY KEY("league_season_id","week","player_id")
);
--> statement-breakpoint
ALTER TABLE "player_week_points" ADD CONSTRAINT "player_week_points_league_season_id_league_season_id_fk" FOREIGN KEY ("league_season_id") REFERENCES "public"."league_season"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "player_week_points" ADD CONSTRAINT "player_week_points_player_id_player_id_fk" FOREIGN KEY ("player_id") REFERENCES "public"."player"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "player_week_points_player_idx" ON "player_week_points" USING btree ("player_id");