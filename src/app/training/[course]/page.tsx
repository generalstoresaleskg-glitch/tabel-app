import Link from "next/link";
import { notFound } from "next/navigation";
import { requireUser } from "@/lib/session";
import {
  getCourseBySlug,
  getCourseLessons,
  getMyLessonProgress,
  getMyBestAttempt,
} from "@/lib/training-queries";

export const dynamic = "force-dynamic";

export default async function CourseLessonsPage({
  params,
}: {
  params: Promise<{ course: string }>;
}) {
  const { course: courseSlug } = await params;
  const me = await requireUser();

  const course = await getCourseBySlug(courseSlug);
  if (!course) notFound();

  const lessonRows = await getCourseLessons(course.id);
  const progress = await getMyLessonProgress(me.id, course.id);
  const attempt = await getMyBestAttempt(me.id, course.id);

  const done = progress.completedLessonIds.size;
  const allLessonsDone = lessonRows.length > 0 && done === lessonRows.length;

  return (
    <div className="space-y-6">
      <div>
        <Link href="/training" className="text-slate-500 hover:text-slate-700 font-medium text-sm">
          ← Все модули
        </Link>
        <div className="mt-1 flex items-center gap-2">
          <span className="badge-neutral">Модуль {course.moduleNumber}</span>
          {attempt?.everPassed && <span className="badge-success">Тест сдан</span>}
        </div>
        <h1 className="page-title mt-1">{course.title}</h1>
        <p className="page-subtitle">
          {done}/{lessonRows.length} уроков пройдено
        </p>
      </div>

      <div className="grid gap-3">
        {lessonRows.map((l, i) => {
          const isDone = progress.completedLessonIds.has(l.id);
          return (
            <Link
              key={l.id}
              href={`/training/${course.slug}/${l.slug}`}
              className="card-pad flex items-center gap-3 transition-shadow hover:shadow-md"
            >
              <span
                className={
                  "flex h-8 w-8 shrink-0 items-center justify-center rounded-full text-sm font-semibold " +
                  (isDone ? "bg-emerald-50 text-emerald-700" : "bg-slate-100 text-slate-500")
                }
              >
                {isDone ? "✓" : i + 1}
              </span>
              <span className="flex-1 font-medium text-slate-900">{l.title}</span>
              <span className="text-slate-300">→</span>
            </Link>
          );
        })}
      </div>

      <div className="card-pad flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
        <div>
          <div className="section-title">Тест по модулю</div>
          <p className="page-subtitle">
            {attempt
              ? `Попыток: ${attempt.attemptsCount} · лучший результат: ${attempt.best.percent}%`
              : "Пройдите все уроки, затем — тест."}
          </p>
        </div>
        <Link
          href={`/training/${course.slug}/quiz`}
          className={allLessonsDone ? "btn-primary" : "btn-secondary"}
        >
          {attempt ? "Пройти тест ещё раз" : "Пройти тест"}
        </Link>
      </div>
    </div>
  );
}
