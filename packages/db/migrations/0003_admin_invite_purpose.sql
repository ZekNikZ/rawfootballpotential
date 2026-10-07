ALTER TABLE "admin_invite" ADD COLUMN "purpose" text DEFAULT 'invite' NOT NULL;--> statement-breakpoint
ALTER TABLE "admin_invite" ADD COLUMN "user_id" text;--> statement-breakpoint
ALTER TABLE "admin_invite" ADD CONSTRAINT "admin_invite_user_id_admin_user_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."admin_user"("id") ON DELETE cascade ON UPDATE no action;