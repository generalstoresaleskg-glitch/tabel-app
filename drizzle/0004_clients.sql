CREATE TABLE "clients" (
	"id" text PRIMARY KEY NOT NULL,
	"name" text NOT NULL,
	"phone" text NOT NULL,
	"birth_day" integer NOT NULL,
	"birth_month" integer NOT NULL,
	"birth_year" integer,
	"source" text DEFAULT 'whatsapp' NOT NULL,
	"added_by_user_id" text,
	"added_by_name" text,
	"created_at" text DEFAULT now()::text NOT NULL,
	"updated_at" text DEFAULT now()::text NOT NULL,
	CONSTRAINT "clients_phone_unique" UNIQUE("phone")
);
--> statement-breakpoint
ALTER TABLE "clients" ADD CONSTRAINT "clients_added_by_user_id_users_id_fk" FOREIGN KEY ("added_by_user_id") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;