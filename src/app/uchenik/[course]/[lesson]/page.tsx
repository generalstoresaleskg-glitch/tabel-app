import Link from "next/link";
import { notFound } from "next/navigation";
import { requireGuest } from "@/lib/guest-session";
import { getLessonBySlug } from "@/lib/training-queries";
import { completeLessonAndContinueGuest } from "@/app/uchenik/actions";

export const dynamic = "force-dynamic";

export default async function GuestLessonPage({
  params,
}: {
  params: Promise<{ course: string; lesson: string }>;
}) {
  const { course: courseSlug, lesson: lessonSlug } = await params;
  await requireGuest();

  const data = await getLessonBySlug(courseSlug, lessonSlug);
  if (!data) notFound();

  const { course, lesson, prevLesson, nextLesson, isLastLesson, lessonNumberDisplay, totalLessons } =
    data;

  const nextPath = isLastLesson
    ? `/uchenik/${course.slug}/quiz`
    : `/uchenik/${course.slug}/${nextLesson!.slug}`;

  const continueAction = completeLessonAndContinueGuest.bind(null, course.slug, lesson.id, nextPath);

  return (
    <div className="space-y-5">
      <div>
        <Link href={`/uchenik/${course.slug}`} className="text-slate-500 hover:text-slate-700 font-medium text-sm">
          ← {course.title}
        </Link>
        <div className="mt-1 flex items-center justify-between gap-2">
          <h1 className="page-title">{lesson.title}</h1>
          <span className="badge-neutral shrink-0">
            Урок {lessonNumberDisplay}/{totalLessons}
          </span>
        </div>
      </div>

      {/* Полностраничные картинки исходной презентации — сохраняем визуал
          1:1, без пересобранного текста. */}
      <div className="card overflow-hidden">
        <div className="flex flex-col">
          {lesson.images.map((src, i) => (
            // eslint-disable-next-line @next/next/no-img-element -- статичные
            // страницы исходной презентации, разное соотношение сторон у
            // каждого урока; обычный <img> сохраняет пропорции 1:1 без next/image.
            <img
              key={src}
              src={src}
              alt={`${lesson.title} — страница ${i + 1}`}
              loading={i === 0 ? "eager" : "lazy"}
              className="w-full h-auto block"
            />
          ))}
        </div>
      </div>

      <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
        <div className="flex gap-2">
          {prevLesson ? (
            <Link href={`/uchenik/${course.slug}/${prevLesson.slug}`} className="btn-secondary">
              ← Предыдущий урок
            </Link>
          ) : (
            <span />
          )}
        </div>
        <form action={continueAction}>
          <button type="submit" className="btn-primary w-full sm:w-auto">
            {isLastLesson ? "Урок пройден · К тесту →" : "Урок пройден · Далее →"}
          </button>
        </form>
      </div>
    </div>
  );
}
