import Link from "next/link";
import { requireUser } from "@/lib/session";
import {
  mondayOf,
  addDays,
  weekDates,
  weekdayShort,
  formatDateHuman,
  todayISO,
  formatTimeHHMM,
} from "@/lib/dates";
import {
  getScheduleByWeek,
  getShiftsWithDetails,
  getAllActivePoints,
  getAssignableUsers,
  ShiftRow,
} from "@/lib/schedule-queries";
import {
  createDraftForWeek,
  addShift,
  deleteShift,
  submitForApproval,
  ownerApprove,
  ownerReject,
  employeeAck,
  publishAnyway,
} from "./actions";
import { checkIn, checkOut, markVisit } from "./attendance-actions";
import { DayCheckboxes } from "@/components/day-checkboxes";

const STATUS_LABEL: Record<string, string> = {
  draft: "Черновик",
  pending_owner: "На утверждении у владельца",
  pending_employee: "На подтверждении у сотрудников",
  published: "Опубликован",
};

const STATUS_BADGE: Record<string, string> = {
  draft: "badge-neutral",
  pending_owner: "badge-warning",
  pending_employee: "badge-brand",
  published: "badge-success",
};

function AckBadge({ shift }: { shift: ShiftRow["shift"] }) {
  if (shift.employeeAck === "confirmed")
    return <span className="badge-success">✓ подтвердил(а)</span>;
  if (shift.employeeAck === "question")
    return (
      <span className="badge-warning">
        ? вопрос{shift.employeeComment ? `: ${shift.employeeComment}` : ""}
      </span>
    );
  return <span className="badge-neutral">ожидает подтверждения</span>;
}

function AttendanceBadge({ row }: { row: ShiftRow }) {
  const { shift, attendance } = row;
  if (shift.type === "SHIFT") {
    if (!attendance?.checkinAt) return null;
    const late =
      attendance.checkinStatus === "late"
        ? ` (опоздание ${attendance.checkinLateMinutes} мин)`
        : "";
    return (
      <div className="text-slate-600">
        приход {formatTimeHHMM(attendance.checkinAt)}
        {late}
        {attendance.checkoutAt && (
          <>, уход {formatTimeHHMM(attendance.checkoutAt)}</>
        )}
      </div>
    );
  }
  if (!attendance?.checkinAt) return null;
  return (
    <div className="text-slate-600">
      визит отмечен {formatTimeHHMM(attendance.checkinAt)}
    </div>
  );
}

function ShiftActions({
  row,
  scheduleStatus,
}: {
  row: ShiftRow;
  scheduleStatus: string;
}) {
  const { shift, attendance } = row;
  if (scheduleStatus !== "published") return null;

  if (shift.type === "VISIT") {
    if (attendance?.checkinAt) return null;
    return (
      <form action={markVisit.bind(null, shift.id)}>
        <button className="btn-primary btn-sm w-full">Посетила точку</button>
      </form>
    );
  }

  if (!attendance?.checkinAt) {
    return (
      <form action={checkIn.bind(null, shift.id)}>
        <button className="btn-primary btn-sm w-full">Я на месте</button>
      </form>
    );
  }
  if (!attendance.checkoutAt) {
    return (
      <form action={checkOut.bind(null, shift.id)}>
        <button className="btn-secondary btn-sm w-full">Я ухожу</button>
      </form>
    );
  }
  return null;
}

export default async function SchedulePage({
  searchParams,
}: {
  searchParams: Promise<{ week?: string }>;
}) {
  const me = await requireUser();
  const { week } = await searchParams;
  const weekStart = mondayOf(week || todayISO());
  const dates = weekDates(weekStart);

  const schedule = await getScheduleByWeek(weekStart);
  const shiftRows = schedule ? await getShiftsWithDetails(schedule.id) : [];
  const canManage = me.role === "owner" || me.role === "manager";

  const activePoints = canManage ? await getAllActivePoints() : [];
  const activeUsers = canManage ? await getAssignableUsers() : [];

  const prevWeek = addDays(weekStart, -7);
  const nextWeek = addDays(weekStart, 7);

  const byDate: Record<string, ShiftRow[]> = {};
  for (const d of dates) byDate[d] = [];
  for (const row of shiftRows) {
    if (byDate[row.shift.date]) byDate[row.shift.date].push(row);
  }

  const myPending =
    schedule?.status === "pending_employee"
      ? shiftRows.filter(
          (r) => r.shift.userId === me.id && r.shift.employeeAck === "pending"
        )
      : [];

  const totalCount = shiftRows.length;
  const confirmedCount = shiftRows.filter(
    (r) => r.shift.employeeAck === "confirmed"
  ).length;

  const dayOptions = dates.map((d, i) => ({
    value: d,
    label: `${weekdayShort(d)} ${formatDateHuman(d)}`,
    isWeekend: i === 5 || i === 6,
  }));

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between flex-wrap gap-3">
        <div>
          <h1 className="page-title">График на неделю</h1>
          <p className="page-subtitle flex flex-wrap items-center gap-2">
            <span>
              {formatDateHuman(dates[0])}–{formatDateHuman(dates[6])}
            </span>
            {schedule && (
              <>
                <span className={STATUS_BADGE[schedule.status]}>
                  {STATUS_LABEL[schedule.status]}
                </span>
                {schedule.status === "pending_employee" && (
                  <span className="text-slate-400">
                    {confirmedCount}/{totalCount} подтвердили
                  </span>
                )}
              </>
            )}
          </p>
        </div>
        <div className="flex gap-2">
          <Link href={`/schedule?week=${prevWeek}`} className="btn-secondary btn-sm">
            ← Пред. неделя
          </Link>
          <Link href={`/schedule?week=${todayISO()}`} className="btn-secondary btn-sm">
            Сегодня
          </Link>
          <Link href={`/schedule?week=${nextWeek}`} className="btn-secondary btn-sm">
            След. неделя →
          </Link>
        </div>
      </div>

      {!schedule && canManage && (
        <form action={createDraftForWeek.bind(null, weekStart)}>
          <button className="btn-primary">Создать черновик графика на эту неделю</button>
        </form>
      )}
      {!schedule && !canManage && (
        <p className="text-sm text-slate-500">
          График на эту неделю ещё не составлен.
        </p>
      )}

      {schedule?.status === "draft" && schedule.ownerComment && (
        <div className="text-sm bg-amber-50 border border-amber-200 text-amber-800 rounded-lg px-3 py-2">
          Комментарий владельца: {schedule.ownerComment}
        </div>
      )}

      {myPending.length > 0 && (
        <div className="card-pad border-2 border-indigo-500 space-y-3">
          <h2 className="section-title">Подтвердите свои задачи на неделю</h2>
          {myPending.map((r) => (
            <div
              key={r.shift.id}
              className="flex flex-wrap items-center gap-3 text-sm border-t border-slate-100 pt-3 first:border-t-0 first:pt-0"
            >
              <span className="font-medium text-slate-900">
                {weekdayShort(r.shift.date)} {formatDateHuman(r.shift.date)}
              </span>
              <span className="text-slate-600">{r.point?.name}</span>
              <span className="text-slate-600">
                {r.shift.type === "SHIFT"
                  ? `${r.shift.plannedStart}–${r.shift.plannedEnd}`
                  : `визит${r.shift.note ? ": " + r.shift.note : ""}`}
              </span>
              <form action={employeeAck.bind(null, r.shift.id, schedule!.id, "confirmed")}>
                <button className="btn-primary btn-sm">Подтверждаю</button>
              </form>
              <details className="inline-block">
                <summary className="cursor-pointer text-sm text-amber-700 underline underline-offset-2">
                  Есть вопрос
                </summary>
                <form
                  action={employeeAck.bind(null, r.shift.id, schedule!.id, "question")}
                  className="flex gap-2 mt-2"
                >
                  <input name="comment" placeholder="В чём вопрос?" className="input" />
                  <button className="btn-warning btn-sm">Отправить</button>
                </form>
              </details>
            </div>
          ))}
        </div>
      )}

      {schedule && (
        <div className="grid grid-cols-1 sm:grid-cols-7 gap-2">
          {dates.map((d) => (
            <div key={d} className="card p-2.5 min-h-[130px]">
              <div className="text-xs font-semibold uppercase tracking-wide text-slate-500 mb-2">
                {weekdayShort(d)} {formatDateHuman(d)}
              </div>
              <div className="space-y-2">
                {byDate[d].map((r) => (
                  <div key={r.shift.id} className="rounded-lg border border-slate-200 bg-slate-50 p-2.5 text-xs space-y-1.5">
                    <div className="font-medium text-slate-900">{r.user?.name}</div>
                    <div className="text-slate-500">{r.point?.name}</div>
                    <div className="text-slate-700">
                      {r.shift.type === "SHIFT"
                        ? `${r.shift.plannedStart}–${r.shift.plannedEnd}`
                        : `Визит${r.shift.note ? ": " + r.shift.note : ""}`}
                    </div>
                    <AckBadge shift={r.shift} />
                    <AttendanceBadge row={r} />
                    <ShiftActions row={r} scheduleStatus={schedule.status} />
                    {canManage &&
                      (schedule.status === "draft" ||
                        schedule.status === "published") && (
                        <form action={deleteShift.bind(null, r.shift.id, schedule.id)}>
                          <button className="btn-link-danger !text-xs">удалить</button>
                        </form>
                      )}
                  </div>
                ))}
                {byDate[d].length === 0 && (
                  <div className="text-xs text-slate-300">—</div>
                )}
              </div>
            </div>
          ))}
        </div>
      )}

      {schedule && canManage && (schedule.status === "draft" || schedule.status === "published") && (
        <div className="card-pad space-y-4">
          <h2 className="section-title">Добавить смену / визит-задачу</h2>
          <form action={addShift.bind(null, schedule.id)} className="space-y-4">
            <div className="grid sm:grid-cols-2 gap-3">
              <div>
                <label className="field-label">Сотрудник</label>
                <select name="userId" required className="input">
                  {activeUsers.map((u) => (
                    <option key={u.id} value={u.id}>
                      {u.name}
                    </option>
                  ))}
                </select>
              </div>
              <div>
                <label className="field-label">Точка</label>
                <select name="pointId" required className="input">
                  {activePoints.map((p) => (
                    <option key={p.id} value={p.id}>
                      {p.name}
                    </option>
                  ))}
                </select>
              </div>
            </div>

            <div>
              <label className="field-label">Дни недели (можно выбрать несколько)</label>
              <DayCheckboxes days={dayOptions} />
            </div>

            <div className="grid sm:grid-cols-3 gap-3">
              <div>
                <label className="field-label">Тип</label>
                <select name="type" className="input">
                  <option value="SHIFT">Смена</option>
                  <option value="VISIT">Визит-задача</option>
                </select>
              </div>
              <div>
                <label className="field-label">Начало</label>
                <input type="time" name="plannedStart" className="input" />
              </div>
              <div>
                <label className="field-label">Конец / примечание</label>
                <input name="detail" placeholder="18:00 или текст для визита" className="input" />
              </div>
            </div>

            <button type="submit" className="btn-primary">
              Добавить на выбранные дни
            </button>
          </form>
          <p className="text-xs text-slate-400">
            Для визит-задачи укажите тип «Визит-задача» — поля времени можно оставить пустыми, а в поле
            «Конец / примечание» написать, что за задача (например, «съёмка контента»). Отметьте галочками
            все дни, на которые нужна эта смена — сотрудник и точка одинаковые, задачи создадутся сразу на все выбранные дни.
          </p>
        </div>
      )}

      {schedule?.status === "draft" && canManage && (
        <form action={submitForApproval.bind(null, schedule.id)}>
          <button className="btn-primary">
            {me.role === "owner"
              ? "Отправить сотрудникам на подтверждение"
              : "Отправить на утверждение владельцу"}
          </button>
        </form>
      )}

      {schedule?.status === "pending_owner" && me.role === "owner" && (
        <div className="card-pad space-y-3">
          <h2 className="section-title">График ожидает вашего утверждения</h2>
          <form action={ownerApprove.bind(null, schedule.id)}>
            <button className="btn-primary">Утвердить график</button>
          </form>
          <form action={ownerReject.bind(null, schedule.id)} className="flex gap-2">
            <input name="comment" placeholder="Комментарий, что нужно поправить" className="input flex-1" />
            <button className="btn-warning">Вернуть на доработку</button>
          </form>
        </div>
      )}

      {schedule?.status === "pending_employee" && canManage && myPending.length === 0 && (
        <form action={publishAnyway.bind(null, schedule.id)}>
          <button className="btn-secondary">
            Опубликовать сейчас (не дожидаясь всех подтверждений)
          </button>
        </form>
      )}
    </div>
  );
}
