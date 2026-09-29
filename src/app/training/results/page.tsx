import Link from "next/link";
import { requireRole } from "@/lib/session";
import { getAttemptSummary } from "@/lib/training-queries";

export const dynamic = "force-dynamic";

export default async function TrainingResultsPage() {
  await requireRole(["owner", "manager"]);
  const rows = await getAttemptSummary();

  const byUser = new Map<string, typeof rows>();
  for (const r of rows) {
    const arr = byUser.get(r.userName) ?? [];
    arr.push(r);
    byUser.set(r.userName, arr);
  }

  return (
    <div className="space-y-6">
      <div>
        <Link href="/training" className="text-slate-500 hover:text-slate-700 font-medium text-sm">
          ← Обучение
        </Link>
        <h1 className="page-title mt-1">Результаты обучения</h1>
        <p className="page-subtitle">Попытки прохождения тестов по каждому сотруднику и модулю.</p>
      </div>

      {rows.length === 0 ? (
        <div className="card-pad text-slate-500">Пока никто не проходил тесты.</div>
      ) : (
        <div className="space-y-5">
          {Array.from(byUser.entries()).map(([userName, userRows]) => (
            <div key={userName} className="card-pad space-y-3">
              <div className="section-title">{userName}</div>
              <div className="grid gap-2">
                {userRows.map((r) => (
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
          ))}
        </div>
      )}
    </div>
  );
}
