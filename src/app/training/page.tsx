import Link from "next/link";
import { requireUser } from "@/lib/session";
import { getCourses, getMyLessonProgress, getMyBestAttempt } from "@/lib/training-queries";

export const dynamic = "force-dynamic";

export default async function TrainingPage() {
  const me = await requireUser();
  const canManage = me.role === "owner" || me.role === "manager";
  const allCourses = await getCourses();

  const rows = await Promise.all(
    allCourses.map(async (c) => {
      const progress = await getMyLessonProgress(me.id, c.id);
      const attempt = await getMyBestAttempt(me.id, c.id);
      return { course: c, progress, attempt };
    })
  );

  return (
    <div className="space-y-8">
      <div className="flex items-start justify-between gap-3">
        <div>
          <h1 className="page-title">Обучение</h1>
          <p className="page-subtitle">
            {rows.length} модулей · пройдите уроки и тест в конце каждого модуля.
          </p>
        </div>
        {canManage && (
          <Link href="/training/results" className="btn-secondary btn-sm shrink-0">
            Результаты сотрудников
          </Link>
        )}
      </div>

      <div className="grid gap-4 sm:grid-cols-2">
        {rows.map(({ course, progress, attempt }) => {
          const done = progress.completedLessonIds.size;
          const total = progress.total;
          const allLessonsDone = total > 0 && done === total;
          return (
            <Link
              key={course.id}
              href={`/training/${course.slug}`}
              className="card-pad flex flex-col gap-3 transition-shadow hover:shadow-md"
            >
              <div className="flex items-center justify-between gap-2">
                <span className="badge-neutral">Модуль {course.moduleNumber}</span>
                {attempt?.everPassed ? (
                  <span className="badge-success">Тест сдан</span>
                ) : allLessonsDone ? (
                  <span className="badge-brand">Готово к тесту</span>
                ) : null}
              </div>
              <h2 className="section-title text-lg">{course.title}</h2>
              <div className="mt-auto space-y-1.5">
                <div className="flex items-center justify-between text-xs text-slate-500">
                  <span>
                    Уроки: {done}/{total}
                  </span>
                  {attempt && <span>Лучший результат теста: {attempt.best.percent}%</span>}
                </div>
                <div className="h-1.5 w-full overflow-hidden rounded-full bg-slate-100">
                  <div
                    className="h-full rounded-full bg-brand-500"
                    style={{ width: total > 0 ? `${(done / total) * 100}%` : "0%" }}
                  />
                </div>
              </div>
            </Link>
          );
        })}
      </div>
    </div>
  );
}
