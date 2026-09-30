import Link from "next/link";
import { notFound } from "next/navigation";
import { requireGuest } from "@/lib/guest-session";
import { getAttemptById } from "@/lib/training-queries";

export const dynamic = "force-dynamic";

export default async function GuestQuizResultPage({
  params,
}: {
  params: Promise<{ course: string; attemptId: string }>;
}) {
  const { course: courseSlug, attemptId } = await params;
  const guest = await requireGuest();

  const data = await getAttemptById(attemptId);
  if (!data || !data.course || data.attempt.guestId !== guest.id) notFound();

  const { attempt, course } = data;

  return (
    <div className="mx-auto max-w-md space-y-6 text-center">
      <div
        className={
          "mx-auto flex h-20 w-20 items-center justify-center rounded-full text-3xl font-bold " +
          (attempt.passed ? "bg-emerald-50 text-emerald-600" : "bg-red-50 text-red-600")
        }
      >
        {attempt.percent}%
      </div>
      <div>
        <h1 className="page-title">{attempt.passed ? "Тест сдан!" : "Тест не сдан"}</h1>
        <p className="page-subtitle">
          {course!.title} · {attempt.score}/{attempt.total} правильных ответов
        </p>
      </div>

      {!attempt.passed && (
        <p className="text-sm text-slate-500">
          Для сдачи нужно набрать от 70%. Пересмотрите уроки модуля и попробуйте ещё раз.
        </p>
      )}

      <div className="flex flex-col gap-2 sm:flex-row sm:justify-center">
        {!attempt.passed && (
          <Link href={`/uchenik/${courseSlug}/quiz`} className="btn-primary">
            Пройти ещё раз
          </Link>
        )}
        <Link href={`/uchenik/${courseSlug}`} className="btn-secondary">
          Вернуться к модулю
        </Link>
        <Link href="/uchenik" className="text-slate-500 hover:text-slate-700 font-medium self-center text-sm">
          Все модули
        </Link>
      </div>
    </div>
  );
}
