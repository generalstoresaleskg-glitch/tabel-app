import Link from "next/link";
import { requireUser } from "@/lib/session";
import { getShiftsInRange } from "@/lib/schedule-queries";
import {
  currentMonthStr,
  shiftMonth,
  monthRange,
  monthLabel,
  formatDateHuman,
  formatTimeHHMM,
  weekdayShort,
} from "@/lib/dates";

const STATUS_LABEL: Record<string, string> = {
  on_time: "вовремя",
  late: "опоздание",
  early: "ушёл раньше",
  overtime: "переработка",
};

export default async function TabelPage({
  searchParams,
}: {
  searchParams: Promise<{ month?: string }>;
}) {
  const me = await requireUser();
  const { month } = await searchParams;
  const currentMonth = month || currentMonthStr();
  const { start, end } = monthRange(currentMonth);

  const allRows = await getShiftsInRange(start, end);
  const canSeeAll = me.role === "owner" || me.role === "manager";
  const rows = canSeeAll ? allRows : allRows.filter((r) => r.shift.userId === me.id);

  // Агрегаты по сотрудникам
  const byUser = new Map<
    string,
    { name: string; days: number; late: number; visits: number; minutes: number }
  >();
  for (const r of rows) {
    if (!r.user) continue;
    const agg = byUser.get(r.user.id) ?? {
      name: r.user.name,
      days: 0,
      late: 0,
      visits: 0,
      minutes: 0,
    };
    if (r.shift.type === "SHIFT" && r.attendance?.checkinAt) {
      agg.days += 1;
      if (r.attendance.checkinStatus === "late") agg.late += 1;
      if (r.attendance.checkoutAt) {
        const mins =
          (new Date(r.attendance.checkoutAt).getTime() -
            new Date(r.attendance.checkinAt).getTime()) /
          60000;
        agg.minutes += Math.max(0, Math.round(mins));
      }
    }
    if (r.shift.type === "VISIT" && r.attendance?.checkinAt) {
      agg.visits += 1;
    }
    byUser.set(r.user.id, agg);
  }

  const sortedRows = [...rows].sort((a, b) => a.shift.date.localeCompare(b.shift.date));

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between flex-wrap gap-3">
        <div>
          <h1 className="page-title">Табель</h1>
          <p className="page-subtitle capitalize">{monthLabel(currentMonth)}</p>
        </div>
        <div className="flex flex-wrap items-center gap-2">
          <Link href={`/tabel?month=${shiftMonth(currentMonth, -1)}`} className="btn-secondary btn-sm">
            ← Пред. месяц
          </Link>
          <Link href={`/tabel?month=${currentMonthStr()}`} className="btn-secondary btn-sm">
            Текущий
          </Link>
          <Link href={`/tabel?month=${shiftMonth(currentMonth, 1)}`} className="btn-secondary btn-sm">
            След. месяц →
          </Link>
          {canSeeAll && (
            <a href={`/tabel/export?month=${currentMonth}`} className="btn-primary btn-sm">
              Скачать CSV
            </a>
          )}
        </div>
      </div>

      {canSeeAll && (
        <div className="card overflow-x-auto">
          <table className="w-full text-sm">
            <thead>
              <tr className="border-b border-slate-200 text-left text-xs font-semibold uppercase tracking-wide text-slate-500">
                <th className="p-3">Сотрудник</th>
                <th className="p-3">Смен отработано</th>
                <th className="p-3">Опозданий</th>
                <th className="p-3">Часов (смены)</th>
                <th className="p-3">Визитов</th>
              </tr>
            </thead>
            <tbody>
              {[...byUser.values()].map((u) => (
                <tr key={u.name} className="border-b border-slate-100 last:border-0 hover:bg-slate-50">
                  <td className="p-3 font-medium text-slate-900">{u.name}</td>
                  <td className="p-3 text-slate-700">{u.days}</td>
                  <td className="p-3 text-slate-700">
                    {u.late > 0 ? (
                      <span className="badge-warning">{u.late}</span>
                    ) : (
                      u.late
                    )}
                  </td>
                  <td className="p-3 text-slate-700">{(u.minutes / 60).toFixed(1)}</td>
                  <td className="p-3 text-slate-700">{u.visits}</td>
                </tr>
              ))}
              {byUser.size === 0 && (
                <tr>
                  <td className="p-3 text-slate-400" colSpan={5}>
                    Пока нет данных за этот месяц.
                  </td>
                </tr>
              )}
            </tbody>
          </table>
        </div>
      )}

      {/* Мобильный вид: карточки по дням вместо широкой таблицы */}
      <div className="card divide-y divide-slate-100 sm:hidden">
        {sortedRows.length === 0 && (
          <div className="p-4 text-sm text-slate-400">Нет записей.</div>
        )}
        {sortedRows.map((r) => (
          <div key={r.shift.id} className="p-4 space-y-1.5">
            <div className="flex items-center justify-between">
              <span className="font-medium text-slate-900">
                {weekdayShort(r.shift.date)} {formatDateHuman(r.shift.date)}
              </span>
              {r.attendance?.checkinStatus && (
                <span
                  className={
                    r.attendance.checkinStatus === "late"
                      ? "badge-warning"
                      : "badge-success"
                  }
                >
                  {STATUS_LABEL[r.attendance.checkinStatus]}
                </span>
              )}
            </div>
            {canSeeAll && <div className="text-sm text-slate-600">{r.user?.name}</div>}
            <div className="text-sm text-slate-500">{r.point?.name}</div>
            <div className="text-sm text-slate-700">
              План:{" "}
              {r.shift.type === "SHIFT"
                ? `${r.shift.plannedStart}–${r.shift.plannedEnd}`
                : `визит${r.shift.note ? ": " + r.shift.note : ""}`}
            </div>
            <div className="text-sm text-slate-700">
              Факт:{" "}
              {r.attendance?.checkinAt ? (
                <>
                  {formatTimeHHMM(r.attendance.checkinAt)}
                  {r.attendance.checkoutAt ? ` – ${formatTimeHHMM(r.attendance.checkoutAt)}` : ""}
                </>
              ) : (
                <span className="text-slate-400">нет отметки</span>
              )}
            </div>
          </div>
        ))}
      </div>

      {/* Десктоп: таблица */}
      <div className="card overflow-x-auto hidden sm:block">
        <table className="w-full text-sm">
          <thead>
            <tr className="border-b border-slate-200 text-left text-xs font-semibold uppercase tracking-wide text-slate-500">
              <th className="p-3">Дата</th>
              {canSeeAll && <th className="p-3">Сотрудник</th>}
              <th className="p-3">Точка</th>
              <th className="p-3">План</th>
              <th className="p-3">Факт</th>
              <th className="p-3">Статус</th>
            </tr>
          </thead>
          <tbody>
            {sortedRows.map((r) => (
              <tr key={r.shift.id} className="border-b border-slate-100 last:border-0 hover:bg-slate-50">
                <td className="p-3 whitespace-nowrap text-slate-700">
                  {weekdayShort(r.shift.date)} {formatDateHuman(r.shift.date)}
                </td>
                {canSeeAll && <td className="p-3 text-slate-700">{r.user?.name}</td>}
                <td className="p-3 text-slate-700">{r.point?.name}</td>
                <td className="p-3 text-slate-700">
                  {r.shift.type === "SHIFT"
                    ? `${r.shift.plannedStart}–${r.shift.plannedEnd}`
                    : `визит${r.shift.note ? ": " + r.shift.note : ""}`}
                </td>
                <td className="p-3 text-slate-700">
                  {r.shift.type === "SHIFT" ? (
                    r.attendance?.checkinAt ? (
                      <>
                        {formatTimeHHMM(r.attendance.checkinAt)}
                        {r.attendance.checkoutAt
                          ? ` – ${formatTimeHHMM(r.attendance.checkoutAt)}`
                          : ""}
                      </>
                    ) : (
                      <span className="text-slate-400">нет отметки</span>
                    )
                  ) : r.attendance?.checkinAt ? (
                    formatTimeHHMM(r.attendance.checkinAt)
                  ) : (
                    <span className="text-slate-400">нет отметки</span>
                  )}
                </td>
                <td className="p-3">
                  {r.attendance?.checkinStatus && (
                    <span
                      className={
                        r.attendance.checkinStatus === "late"
                          ? "badge-warning"
                          : "badge-success"
                      }
                    >
                      {STATUS_LABEL[r.attendance.checkinStatus]}
                    </span>
                  )}
                  {r.attendance?.checkoutStatus &&
                    r.attendance.checkoutStatus !== "on_time" && (
                      <span className="badge-warning ml-1">
                        {STATUS_LABEL[r.attendance.checkoutStatus]}
                      </span>
                    )}
                </td>
              </tr>
            ))}
            {sortedRows.length === 0 && (
              <tr>
                <td className="p-3 text-slate-400" colSpan={canSeeAll ? 6 : 5}>
                  Нет записей.
                </td>
              </tr>
            )}
          </tbody>
        </table>
      </div>
    </div>
  );
}
