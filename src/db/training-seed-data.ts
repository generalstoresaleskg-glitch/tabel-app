import { randomUUID } from "crypto";
import fs from "fs";
import path from "path";
import { eq } from "drizzle-orm";
import { db } from "./index";
import { courses, lessons, quizQuestions, quizOptions } from "./schema";

// Заголовки модулей — соответствуют согласованной структуре курса
// (см. claude/course-structure.md в проекте).
const MODULE_TITLES: Record<number, string> = {
  1: "Кожа и типы кожи",
  2: "Основа косметических средств",
  3: "Обновление кожи",
  4: "Антиоксиданты",
  5: "Защита от ультрафиолета",
  6: "Пептиды",
  7: "Ретиноиды",
  8: "Проблемная кожа",
  9: "Восстановление защитного барьера",
};

type ManifestLesson = {
  slug: string;
  module: number;
  lesson: number;
  title: string;
  sourceFile: string;
  pageCount: number;
  images: string[];
};

type QuizModule = {
  module: number;
  questions: {
    question: string;
    options: string[];
    correctIndex: number;
  }[];
};

function loadJson<T>(relPath: string): T {
  const full = path.join(process.cwd(), relPath);
  return JSON.parse(fs.readFileSync(full, "utf-8")) as T;
}

// Наполняет модули/уроки/тесты обучения. Безопасно перезапускать — таблицы
// courses/lessons/quiz_questions/quiz_options полностью пересобираются из
// manifest.json + quiz-data.json (это статичный учебный контент, не данные
// пользователей). Курсы и уроки обновляются ПО SLUG (стабильный ключ из
// manifest), а не пересоздаются — так их id не меняется и история
// quiz_attempts / lesson_progress не рвётся. Вопросы теста пересобираются
// заново при каждом запуске (они ссылаются только на course_id, не наоборот).
export async function seedTrainingContent() {
  const manifest = loadJson<ManifestLesson[]>("training-content/manifest.json");
  const quizData = loadJson<QuizModule[]>("training-content/quiz-data.json");

  const moduleNumbers = Array.from(new Set(manifest.map((l) => l.module))).sort(
    (a, b) => a - b
  );

  console.log(`Обучение: ${moduleNumbers.length} модулей, ${manifest.length} уроков...`);

  const courseIdByModule = new Map<number, string>();

  for (const moduleNumber of moduleNumbers) {
    const slug = `m${moduleNumber}`;
    const title = MODULE_TITLES[moduleNumber] ?? `Модуль ${moduleNumber}`;

    const existingRows = await db.select().from(courses).where(eq(courses.slug, slug));
    const existing = existingRows[0];

    let courseId: string;
    if (existing) {
      courseId = existing.id;
      await db.update(courses).set({ moduleNumber, title }).where(eq(courses.id, courseId));
    } else {
      courseId = randomUUID();
      await db.insert(courses).values({ id: courseId, slug, moduleNumber, title });
    }
    courseIdByModule.set(moduleNumber, courseId);
  }

  for (const l of manifest) {
    const courseId = courseIdByModule.get(l.module);
    if (!courseId) continue;

    const existingRows = await db.select().from(lessons).where(eq(lessons.slug, l.slug));
    const existing = existingRows[0];

    if (existing) {
      await db
        .update(lessons)
        .set({ courseId, lessonNumber: l.lesson, title: l.title, images: l.images })
        .where(eq(lessons.id, existing.id));
    } else {
      await db.insert(lessons).values({
        id: randomUUID(),
        courseId,
        slug: l.slug,
        lessonNumber: l.lesson,
        title: l.title,
        images: l.images,
      });
    }
  }

  for (const qm of quizData) {
    const courseId = courseIdByModule.get(qm.module);
    if (!courseId) continue;

    const oldQuestions = await db
      .select()
      .from(quizQuestions)
      .where(eq(quizQuestions.courseId, courseId));
    for (const oq of oldQuestions) {
      await db.delete(quizOptions).where(eq(quizOptions.questionId, oq.id));
    }
    await db.delete(quizQuestions).where(eq(quizQuestions.courseId, courseId));

    for (let qi = 0; qi < qm.questions.length; qi++) {
      const q = qm.questions[qi];
      const questionId = randomUUID();
      await db.insert(quizQuestions).values({
        id: questionId,
        courseId,
        orderIndex: qi,
        question: q.question,
      });
      for (let oi = 0; oi < q.options.length; oi++) {
        await db.insert(quizOptions).values({
          id: randomUUID(),
          questionId,
          orderIndex: oi,
          text: q.options[oi],
          isCorrect: oi === q.correctIndex,
        });
      }
    }
  }

  console.log("Обучение: контент загружен.");
}
