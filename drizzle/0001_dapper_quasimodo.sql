-- Убрали обязательное подтверждение сотрудниками: статус "pending_employee"
-- больше не существует в приложении. Все графики, которые в нём застряли,
-- переводим сразу в "published" — это ровно то, для чего они и ждали.
UPDATE "schedules" SET "status" = 'published' WHERE "status" = 'pending_employee';--> statement-breakpoint
ALTER TABLE "shifts" DROP COLUMN "employee_ack";--> statement-breakpoint
ALTER TABLE "shifts" DROP COLUMN "employee_comment";