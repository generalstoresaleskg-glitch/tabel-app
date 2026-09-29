import Link from "next/link";
import { notFound } from "next/navigation";
import { requireUser } from "@/lib/session";
import { getCourseBySlug, getQuizQuestions } from "@/lib/training-queries";
import { submitQuiz } from "@/app/training/actions";

export const dynamic = "force-dynamic";

export default async function QuizPage({
  params,
}: {
  params: Promise<{ course: string }>;
}) {
  const { course: courseSlug } = await params;
  await requireUser();

  const course = await getCourseBySlug(courseSlug);
  if (!course) notFound();

  const questions = await getQuizQuestions(course.id);
  const action = submitQuiz.bind(null, course.slug, course.id);

  return (
    <div className="space-y-6">
      <div>
        <Link href={`/training/${course.slug}`} className="text-slate-500 hover:text-slate-700 font-medium text-sm">
          ← {course.title}
        </Link>
        <h1 className="page-title mt-1">Тест: {course.title}</h1>
        <p className="page-subtitle">
          {questions.length} вопросов · для сдачи нужно набрать от 70%.
        </p>
      </div>

      {questions.length === 0 ? (
        <div className="card-pad text-slate-500">Тест для этого модуля ещё не готов.</div>
      ) : (
        <form action={action} className="space-y-4">
          {questions.map((q, qi) => (
            <div key={q.id} className="card-pad space-y-3">
              <div className="font-medium text-slate-900">
                {qi + 1}. {q.question}
              </div>
              <div className="space-y-2">
                {q.options.map((o) => (
                  <label
                    key={o.id}
                    className="flex cursor-pointer items-center gap-2.5 rounded-lg border border-slate-200 px-3 py-2.5 text-sm text-slate-700 transition-colors has-[:checked]:border-brand-500 has-[:checked]:bg-brand-50 has-[:checked]:text-brand-700"
                  >
                    <input
                      type="radio"
                      name={`q_${q.id}`}
                      value={o.id}
                      required
                      className="h-4 w-4 text-brand-600 focus:ring-2 focus:ring-brand-200"
                    />
                    {o.text}
                  </label>
                ))}
              </div>
            </div>
          ))}
          <button type="submit" className="btn-primary w-full sm:w-auto">
            Завершить тест
          </button>
        </form>
      )}
    </div>
  );
}
