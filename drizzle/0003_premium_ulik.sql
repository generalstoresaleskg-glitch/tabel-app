CREATE TABLE "guest_learners" (
	"id" text PRIMARY KEY NOT NULL,
	"name" text NOT NULL,
	"created_at" text DEFAULT now()::text NOT NULL
);
--> statement-breakpoint
ALTER TABLE "lesson_progress" ALTER COLUMN "user_id" DROP NOT NULL;--> statement-breakpoint
ALTER TABLE "quiz_attempts" ALTER COLUMN "user_id" DROP NOT NULL;--> statement-breakpoint
ALTER TABLE "lesson_progress" ADD COLUMN "guest_id" text;--> statement-breakpoint
ALTER TABLE "quiz_attempts" ADD COLUMN "guest_id" text;--> statement-breakpoint
ALTER TABLE "lesson_progress" ADD CONSTRAINT "lesson_progress_guest_id_guest_learners_id_fk" FOREIGN KEY ("guest_id") REFERENCES "public"."guest_learners"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "quiz_attempts" ADD CONSTRAINT "quiz_attempts_guest_id_guest_learners_id_fk" FOREIGN KEY ("guest_id") REFERENCES "public"."guest_learners"("id") ON DELETE cascade ON UPDATE no action;