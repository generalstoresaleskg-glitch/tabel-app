-- ============================================================
-- Подарочные сертификаты: одна новая таблица certificates.
-- Идемпотентно: безопасно запускать повторно.
-- Выполнить целиком в Neon → SQL Editor → Run.
-- ============================================================

CREATE TABLE IF NOT EXISTS "certificates" (
	"id" text PRIMARY KEY NOT NULL,
	"code" text NOT NULL,
	"recipient" text NOT NULL,
	"sender" text NOT NULL,
	"amount" integer NOT NULL,
	"message" text NOT NULL,
	"status" text DEFAULT 'issued' NOT NULL,
	"source_message_id" text,
	"issued_by_user_id" text,
	"issued_by_name" text,
	"redeemed_at" text,
	"redeemed_by_name" text,
	"created_at" text DEFAULT now()::text NOT NULL,
	CONSTRAINT "certificates_code_unique" UNIQUE("code"),
	CONSTRAINT "certificates_source_message_id_unique" UNIQUE("source_message_id")
);

DO $$ BEGIN
ALTER TABLE "certificates" ADD CONSTRAINT "certificates_issued_by_user_id_users_id_fk" FOREIGN KEY ("issued_by_user_id") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;

-- Если всё прошло, этот запрос покажет 0 (сертификатов пока нет):
SELECT count(*) AS certificates_count FROM "certificates";
