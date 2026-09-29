import { asc, desc, eq, inArray } from "drizzle-orm";
import { db } from "@/db";
import {
  courses,
  lessons,
  lessonProgress,
  quizQuestions,
  quizOptions,
  quizAttempts,
  users,
} from "@/db/schema";

export async function getCourses() {
  const allCourses = await db.select().from(courses).orderBy(asc(courses.moduleNumber));
  const allLessons = await db.select().from(lessons);

  const lessonCountByCourse = new Map<string, number>();
  for (const l of allLessons) {
    lessonCountByCourse.set(l.courseId, (lessonCountByCourse.get(l.courseId) ?? 0) + 1);
  }

  return allCourses.map((c) => ({
    ...c,
    lessonCount: lessonCountByCourse.get(c.id) ?? 0,
  }));
}

export async function getCourseBySlug(slug: string) {
  const rows = await db.select().from(courses).where(eq(courses.slug, slug));
  return rows[0] ?? null;
}

export async function getCourseLessons(courseId: string) {
  return db
    .select()
    .from(lessons)
    .where(eq(lessons.courseId, courseId))
    .orderBy(asc(lessons.lessonNumber));
}

export async function getLessonBySlug(courseSlug: string, lessonSlug: string) {
  const course = await getCourseBySlug(courseSlug);
  if (!course) return null;

  const courseLessons = await getCourseLessons(course.id);
  const index = courseLessons.findIndex((l) => l.slug === lessonSlug);
  if (index === -1) return null;

  return {
    course,
    lesson: courseLessons[index],
    prevLesson: index > 0 ? courseLessons[index - 1] : null,
    nextLesson: index < courseLessons.length - 1 ? courseLessons[index + 1] : null,
    isLastLesson: index === courseLessons.length - 1,
    lessonNumberDisplay: index + 1,
    totalLessons: courseLessons.length,
  };
}

export async function getQuizQuestions(courseId: string) {
  const questions = await db
    .select()
    .from(quizQuestions)
    .where(eq(quizQuestions.courseId, courseId))
    .orderBy(asc(quizQuestions.orderIndex));

  if (questions.length === 0) return [];

  const options = await db
    .select()
    .from(quizOptions)
    .where(
      inArray(
        quizOptions.questionId,
        questions.map((q) => q.id)
      )
    )
    .orderBy(asc(quizOptions.orderIndex));

  return questions.map((q) => ({
    id: q.id,
    question: q.question,
    options: options
      .filter((o) => o.questionId === q.id)
      .map((o) => ({ id: o.id, text: o.text })),
  }));
}

// Только для проверки ответов на сервере — никогда не отправлять на клиент.
async function getQuizAnswerKey(courseId: string) {
  const questions = await db
    .select()
    .from(quizQuestions)
    .where(eq(quizQuestions.courseId, courseId));
  const options = await db
    .select()
    .from(quizOptions)
    .where(
      inArray(
        quizOptions.questionId,
        questions.map((q) => q.id)
      )
    );

  return questions.map((q) => ({
    id: q.id,
    correctOptionId: options.find((o) => o.questionId === q.id && o.isCorrect)?.id ?? null,
  }));
}

export async function gradeQuiz(courseId: string, answers: Record<string, string>) {
  const key = await getQuizAnswerKey(courseId);
  let score = 0;
  for (const q of key) {
    if (q.correctOptionId && answers[q.id] === q.correctOptionId) score++;
  }
  const total = key.length;
  const percent = total > 0 ? Math.round((score / total) * 100) : 0;
  const passed = percent >= 70;
  return { score, total, percent, passed };
}

export async function getMyLessonProgress(userId: string, courseId: string) {
  const courseLessons = await getCourseLessons(courseId);
  if (courseLessons.length === 0) return { completedLessonIds: new Set<string>(), total: 0 };

  const rows = await db
    .select()
    .from(lessonProgress)
    .where(eq(lessonProgress.userId, userId));

  const lessonIds = new Set(courseLessons.map((l) => l.id));
  const completedLessonIds = new Set(
    rows.filter((r) => lessonIds.has(r.lessonId)).map((r) => r.lessonId)
  );

  return { completedLessonIds, total: courseLessons.length };
}

export async function getMyBestAttempt(userId: string, courseId: string) {
  const rows = await db
    .select()
    .from(quizAttempts)
    .where(eq(quizAttempts.userId, userId));

  const forCourse = rows.filter((r) => r.courseId === courseId);
  if (forCourse.length === 0) return null;

  forCourse.sort((a, b) => b.percent - a.percent);
  return {
    best: forCourse[0],
    attemptsCount: forCourse.length,
    everPassed: forCourse.some((r) => r.passed),
  };
}

export async function getAttemptById(id: string) {
  const rows = await db.select().from(quizAttempts).where(eq(quizAttempts.id, id));
  const attempt = rows[0];
  if (!attempt) return null;
  const course = await db.select().from(courses).where(eq(courses.id, attempt.courseId));
  return { attempt, course: course[0] ?? null };
}

// Для владельца/управляющей: сводка попыток по всем сотрудникам и модулям.
export async function getAttemptSummary() {
  const allAttempts = await db
    .select()
    .from(quizAttempts)
    .orderBy(desc(quizAttempts.completedAt));
  const allUsers = await db.select().from(users);
  const allCourses = await db.select().from(courses);

  const userById = new Map(allUsers.map((u) => [u.id, u]));
  const courseById = new Map(allCourses.map((c) => [c.id, c]));

  type Key = string; // `${userId}::${courseId}`
  const summary = new Map<
    Key,
    {
      userId: string;
      userName: string;
      courseId: string;
      courseTitle: string;
      moduleNumber: number;
      attemptsCount: number;
      bestPercent: number;
      everPassed: boolean;
      lastCompletedAt: string;
      lastPassed: boolean;
    }
  >();

  for (const a of allAttempts) {
    const user = userById.get(a.userId);
    const course = courseById.get(a.courseId);
    if (!user || !course) continue;
    const key: Key = `${a.userId}::${a.courseId}`;
    const existing = summary.get(key);
    if (!existing) {
      summary.set(key, {
        userId: a.userId,
        userName: user.name,
        courseId: a.courseId,
        courseTitle: course.title,
        moduleNumber: course.moduleNumber,
        attemptsCount: 1,
        bestPercent: a.percent,
        everPassed: a.passed,
        lastCompletedAt: a.completedAt,
        lastPassed: a.passed,
      });
    } else {
      existing.attemptsCount += 1;
      existing.bestPercent = Math.max(existing.bestPercent, a.percent);
      existing.everPassed = existing.everPassed || a.passed;
      // allAttempts уже отсортирован по completedAt desc, поэтому первая
      // встреченная попытка для пары user+course — самая свежая.
    }
  }

  return Array.from(summary.values()).sort((a, b) => {
    if (a.userName !== b.userName) return a.userName.localeCompare(b.userName, "ru");
    return a.moduleNumber - b.moduleNumber;
  });
}
