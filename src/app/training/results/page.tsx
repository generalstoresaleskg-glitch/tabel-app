import Link from "next/link";
import { requireRole } from "@/lib/session";
import { getAttemptSummary } from "@/lib/training-queries";

export const dynamic = "force-dynamic";

export default async function TrainingResultsPage() {
  await requireRole(["owner", "manager"]);
  const rows = await getAttemptSummary();

  // Группируем по человеку (kind+personId), а не только по имени — иначе
  // сотрудник и гость по ссылке с одинаковым именем визуально слились бы.
  const byPerson = new Map<string, typeof rows>();
  for (const r of rows) {
    const key = `${r.kind}:${r.personId}`;
    const arr = byPerson.get(key) ?? [];
    arr.push(r);
    byPerson.set(key, arr);
  }

  return (
    <div className="space-y-6">
      <div>
        <Link href="/training" className="text-slate-500 hover:text-slate-700 font-medium text-sm">
          ← Обучение
        </Link>
        <h1 className="page-title mt-1">Результаты обучения</h1>
        <p className="page-subtitle">
          Попытки прохождения тестов — сотрудники и те, кто прошёл по ссылке.
        </p>
      </div>

      {rows.length === 0 ? (
        <div className="card-pad text-slate-500">Пока никто не проходил тесты.</div>
      ) : (
        <div className="space-y-5">
          {Array.from(byPerson.values()).map((personRows) => {
            const { userName, kind } = personRows[0];
            return (
              <div key={`${kind}:${personRows[0].personId}`} className="card-pad space-y-3">
                <div className="flex items-center gap-2">
                  <span className="section-title">{userName}</span>
                  {kind === "guest" ? (
                    <span className="badge-neutral">по ссылке</span>
                  ) : (
                    <span className="badge-neutral">сотрудник</span>
                  )}
                </div>
                <div className="grid gap-2">
                  {personRows.map((r) => (
                    <div
                      key={r.courseId}
                      className="flex flex-wrap items-center justify-between gap-2 rounded-lg border border-slate-100 px-3 py-2 text-sm"
                    >
                      <span className="text-slate-700">
                        Модуль {r.moduleNumber} · {r.courseTitle}
                      </span>
                      <span className="flex items-center gap-2">
                        <span className="badge-neutral">Попыток: {r.attemptsCount}</span>
                        <span className="badge-neutral">Лучший: {r.bestPercent}%</span>
                        {r.everPassed ? (
                          <span className="badge-success">Сдан</span>
                        ) : (
                          <span className="badge-warning">Не сдан</span>
                        )}
                      </span>
                    </div>
                  ))}
                </div>
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
}
