-- ============================================================
-- Раздел «Клиенты»: одна новая таблица clients.
-- Идемпотентно: безопасно запускать повторно.
-- Выполнить целиком в Neon → SQL Editor → Run.
-- ============================================================

CREATE TABLE IF NOT EXISTS "clients" (
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

DO $$ BEGIN
ALTER TABLE "clients" ADD CONSTRAINT "clients_added_by_user_id_users_id_fk" FOREIGN KEY ("added_by_user_id") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;

-- Если всё прошло, этот запрос покажет 0 (клиентов пока нет):
SELECT count(*) AS clients_count FROM "clients";
