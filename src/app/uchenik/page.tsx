import Link from "next/link";
import { getCurrentGuest } from "@/lib/guest-session";
import { getCourses, getGuestLessonProgress, getGuestBestAttempt } from "@/lib/training-queries";
import { startGuest } from "./actions";

export const dynamic = "force-dynamic";

export default async function UchenikPage() {
  const guest = await getCurrentGuest();

  if (!guest) {
    return (
      <div className="mx-auto max-w-sm space-y-6 pt-10 text-center">
        <div>
          <h1 className="page-title">Обучение AYAY KYZ</h1>
          <p className="page-subtitle">Как к вам обращаться?</p>
        </div>
        <form action={startGuest} className="space-y-3 text-left">
          <div>
            <label className="field-label" htmlFor="name">
              Имя
            </label>
            <input
              id="name"
              name="name"
              type="text"
              required
              maxLength={80}
              autoFocus
              placeholder="Например, Айгерим"
              className="input"
            />
          </div>
          <button type="submit" className="btn-primary w-full">
            Начать обучение
          </button>
        </form>
      </div>
    );
  }

  const allCourses = await getCourses();
  const rows = await Promise.all(
    allCourses.map(async (c) => {
      const progress = await getGuestLessonProgress(guest.id, c.id);
      const attempt = await getGuestBestAttempt(guest.id, c.id);
      return { course: c, progress, attempt };
    })
  );

  return (
    <div className="space-y-8">
      <div>
        <h1 className="page-title">Обучение AYAY KYZ</h1>
        <p className="page-subtitle">
          {guest.name} · {rows.length} модулей · пройдите уроки и тест в конце каждого модуля.
        </p>
      </div>

      <div className="grid gap-4 sm:grid-cols-2">
        {rows.map(({ course, progress, attempt }) => {
          const done = progress.completedLessonIds.size;
          const total = progress.total;
          const allLessonsDone = total > 0 && done === total;
          return (
            <Link
              key={course.id}
              href={`/uchenik/${course.slug}`}
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
