"use server";

import { randomUUID } from "crypto";
import { eq, and } from "drizzle-orm";
import { redirect } from "next/navigation";
import { revalidatePath } from "next/cache";
import { db } from "@/db";
import { guestLearners, lessonProgress, quizAttempts, quizQuestions, courses } from "@/db/schema";
import { requireGuest, setGuestCookie } from "@/lib/guest-session";
import { gradeQuiz } from "@/lib/training-queries";
import { notifyWhatsApp } from "@/lib/notify";

// Создаёт гостя по введённому имени и пускает его в раздел обучения.
export async function startGuest(formData: FormData) {
  const raw = formData.get("name");
  const name = typeof raw === "string" ? raw.trim().slice(0, 80) : "";
  if (!name) redirect("/uchenik");

  const id = randomUUID();
  await db.insert(guestLearners).values({ id, name });
  await setGuestCookie(id);

  redirect("/uchenik");
}

// Аналог completeLessonAndContinue из /training/actions.ts, но для гостя.
export async function completeLessonAndContinueGuest(
  courseSlug: string,
  lessonId: string,
  nextPath: string
) {
  const guest = await requireGuest();

  const existing = await db
    .select()
    .from(lessonProgress)
    .where(and(eq(lessonProgress.guestId, guest.id), eq(lessonProgress.lessonId, lessonId)));

  if (existing.length === 0) {
    await db.insert(lessonProgress).values({
      id: randomUUID(),
      guestId: guest.id,
      lessonId,
    });
  }

  revalidatePath(`/uchenik/${courseSlug}`);
  redirect(nextPath);
}

// Аналог submitQuiz из /training/actions.ts, но для гостя.
export async function submitQuizGuest(courseSlug: string, courseId: string, formData: FormData) {
  const guest = await requireGuest();

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
    guestId: guest.id,
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
      `${guest.name} (по ссылке) сдал(а) тест по модулю обучения «${course?.title ?? ""}»: ${percent}% (${score}/${total}).`
    );
  }

  revalidatePath(`/uchenik/${courseSlug}`);
  revalidatePath("/training/results");
  redirect(`/uchenik/${courseSlug}/quiz/result/${attemptId}`);
}
