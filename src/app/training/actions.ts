"use server";

import { randomUUID } from "crypto";
import { eq, and } from "drizzle-orm";
import { redirect } from "next/navigation";
import { revalidatePath } from "next/cache";
import { db } from "@/db";
import { lessonProgress, quizAttempts, quizQuestions, courses } from "@/db/schema";
import { requireUser } from "@/lib/session";
import { gradeQuiz } from "@/lib/training-queries";
import { notifyWhatsApp } from "@/lib/notify";

// Отмечает урок пройденным и переводит дальше — на следующий урок модуля
// или, если это был последний урок, на страницу теста.
export async function completeLessonAndContinue(
  courseSlug: string,
  lessonId: string,
  nextPath: string
) {
  const me = await requireUser();

  const existing = await db
    .select()
    .from(lessonProgress)
    .where(and(eq(lessonProgress.userId, me.id), eq(lessonProgress.lessonId, lessonId)));

  if (existing.length === 0) {
    await db.insert(lessonProgress).values({
      id: randomUUID(),
      userId: me.id,
      lessonId,
    });
  }

  revalidatePath(`/training/${courseSlug}`);
  redirect(nextPath);
}

export async function submitQuiz(courseSlug: string, courseId: string, formData: FormData) {
  const me = await requireUser();

  const questionRows = await db
    .select()
    .from(quizQuestions)
    .where(eq(quizQuestions.courseId, courseId));

  const answers: Record<string, string> = {};
  for (const q of questionRows) {
    const value = formData.get(`q_${q.id}`);
    if (typeof value === "string") answers[q.id] = value;
  }

  const { score, total, percent, passed } = await gradeQuiz(courseId, answers);

  const attemptId = randomUUID();
  await db.insert(quizAttempts).values({
    id: attemptId,
    userId: me.id,
    courseId,
    score,
    total,
    percent,
    passed,
  });

  if (passed) {
    const courseRows = await db.select().from(courses).where(eq(courses.id, courseId));
    const course = courseRows[0];
    await notifyWhatsApp(
      `${me.name} сдал(а) тест по модулю обучения «${course?.title ?? ""}»: ${percent}% (${score}/${total}).`
    );
  }

  revalidatePath(`/training/${courseSlug}`);
  revalidatePath("/training/results");
  redirect(`/training/${courseSlug}/quiz/result/${attemptId}`);
}
