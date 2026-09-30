-- ============================================================
-- Обучение по публичной ссылке (гости, /uchenik): таблица гостей +
-- разрешаем lesson_progress/quiz_attempts принадлежать либо сотруднику
-- (user_id), либо гостю (guest_id) — ровно одно из двух.
-- Идемпотентно: безопасно запускать повторно.
-- Выполнить целиком одним запросом в Neon SQL Editor (после того как уже
-- применён training-content/neon-migration.sql).
-- ============================================================

CREATE TABLE IF NOT EXISTS "guest_learners" (
	"id" text PRIMARY KEY NOT NULL,
	"name" text NOT NULL,
	"created_at" text DEFAULT now()::text NOT NULL
);
--> statement-breakpoint
ALTER TABLE "lesson_progress" ALTER COLUMN "user_id" DROP NOT NULL;
--> statement-breakpoint
ALTER TABLE "quiz_attempts" ALTER COLUMN "user_id" DROP NOT NULL;
--> statement-breakpoint
ALTER TABLE "lesson_progress" ADD COLUMN IF NOT EXISTS "guest_id" text;
--> statement-breakpoint
ALTER TABLE "quiz_attempts" ADD COLUMN IF NOT EXISTS "guest_id" text;
--> statement-breakpoint
DO $$ BEGIN
ALTER TABLE "lesson_progress" ADD CONSTRAINT "lesson_progress_guest_id_guest_learners_id_fk" FOREIGN KEY ("guest_id") REFERENCES "public"."guest_learners"("id") ON DELETE cascade ON UPDATE no action;
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;--> statement-breakpoint
DO $$ BEGIN
ALTER TABLE "quiz_attempts" ADD CONSTRAINT "quiz_attempts_guest_id_guest_learners_id_fk" FOREIGN KEY ("guest_id") REFERENCES "public"."guest_learners"("id") ON DELETE cascade ON UPDATE no action;
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;--> statement-breakpoint
