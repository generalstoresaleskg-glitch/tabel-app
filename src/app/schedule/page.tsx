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

const STATUS_LABEL: Record<string, string> = {
  draft: "Черновик",
  pending_owner: "На утверждении у владельца",
  pending_employee: "На подтверждении у сотрудников",
  published: "Опубликован",
};

function AckBadge({ shift }: { shift: ShiftRow["shift"] }) {
  if (shift.employeeAck === "confirmed")
    return <div className="text-green-700">✓ подтвердил(а)</div>;
  if (shift.employeeAck === "question")
    return (
      <div className="text-amber-700">
        ? вопрос{shift.employeeComment ? `: ${shift.employeeComment}` : ""}
      </div>
    );
  return <div className="text-neutral-400">ожидает подтверждения</div>;
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
      <div className="text-neutral-600">
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
    <div className="text-neutral-600">
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
        <button className="text-sm bg-neutral-900 text-white rounded px-2 py-1 hover:bg-neutral-800">
          Посетила точку
        </button>
      </form>
    );
  }

  if (!attendance?.checkinAt) {
    return (
      <form action={checkIn.bind(null, shift.id)}>
        <button className="text-sm bg-neutral-900 text-white rounded px-2 py-1 hover:bg-neutral-800">
          Я на месте
        </button>
      </form>
    );
  }
  if (!attendance.checkoutAt) {
    return (
      <form action={checkOut.bind(null, shift.id)}>
        <button className="text-sm bg-neutral-700 text-white rounded px-2 py-1 hover:bg-neutral-600">
          Я ухожу
        </button>
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

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between flex-wrap gap-3">
        <div>
          <h1 className="text-xl font-semibold">График на неделю</h1>
          <p className="text-sm text-neutral-500">
            {formatDateHuman(dates[0])}–{formatDateHuman(dates[6])}
            {schedule && (
              <>
                {" · "}
                <span className="font-medium">
                  {STATUS_LABEL[schedule.status]}
                </span>
                {schedule.status === "pending_employee" && (
                  <span className="text-neutral-400">
                    {" "}
                    ({confirmedCount}/{totalCount} подтвердили)
                  </span>
                )}
              </>
            )}
          </p>
        </div>
        <div className="flex gap-2 text-sm">
          <Link
            href={`/schedule?week=${prevWeek}`}
            className="px-3 py-1.5 border rounded hover:bg-neutral-100"
          >
            ← Пред. неделя
          </Link>
          <Link
            href={`/schedule?week=${todayISO()}`}
            className="px-3 py-1.5 border rounded hover:bg-neutral-100"
          >
            Сегодня
          </Link>
          <Link
            href={`/schedule?week=${nextWeek}`}
            className="px-3 py-1.5 border rounded hover:bg-neutral-100"
          >
            След. неделя →
          </Link>
        </div>
      </div>

      {!schedule && canManage && (
        <form action={createDraftForWeek.bind(null, weekStart)}>
          <button className="bg-neutral-900 text-white rounded px-4 py-2 text-sm hover:bg-neutral-800">
            Создать черновик графика на эту неделю
          </button>
        </form>
      )}
      {!schedule && !canManage && (
        <p className="text-sm text-neutral-500">
          График на эту неделю ещё не составлен.
        </p>
      )}

      {schedule?.status === "draft" && schedule.ownerComment && (
        <div className="text-sm bg-amber-50 border border-amber-200 text-amber-800 rounded px-3 py-2">
          Комментарий владельца: {schedule.ownerComment}
        </div>
      )}

      {myPending.length > 0 && (
        <div className="border-2 border-neutral-900 rounded-lg p-4 bg-white space-y-3">
          <h2 className="font-medium">Подтвердите свои задачи на неделю</h2>
          {myPending.map((r) => (
            <div
              key={r.shift.id}
              className="flex flex-wrap items-center gap-3 text-sm border-t pt-3 first:border-t-0 first:pt-0"
            >
              <span className="font-medium">
                {weekdayShort(r.shift.date)} {formatDateHuman(r.shift.date)}
              </span>
              <span>{r.point?.name}</span>
              <span>
                {r.shift.type === "SHIFT"
                  ? `${r.shift.plannedStart}–${r.shift.plannedEnd}`
                  : `визит${r.shift.note ? ": " + r.shift.note : ""}`}
              </span>
              <form action={employeeAck.bind(null, r.shift.id, schedule!.id, "confirmed")}>
                <button className="bg-neutral-900 text-white rounded px-3 py-1 hover:bg-neutral-800">
                  Подтверждаю
                </button>
              </form>
              <details className="inline-block">
                <summary className="cursor-pointer text-amber-700 underline underline-offset-2">
                  Есть вопрос
                </summary>
                <form
                  action={employeeAck.bind(null, r.shift.id, schedule!.id, "question")}
                  className="flex gap-2 mt-2"
                >
                  <input
                    name="comment"
                    placeholder="В чём вопрос?"
                    className="border rounded px-2 py-1 text-sm"
                  />
                  <button className="bg-amber-600 text-white rounded px-3 py-1">
                    Отправить
                  </button>
                </form>
              </details>
            </div>
          ))}
        </div>
      )}

      {schedule && (
        <div className="grid grid-cols-1 sm:grid-cols-7 gap-2">
          {dates.map((d) => (
            <div key={d} className="border rounded-lg bg-white p-2 min-h-[120px]">
              <div className="text-xs font-medium text-neutral-500 mb-2">
                {weekdayShort(d)} {formatDateHuman(d)}
              </div>
              <div className="space-y-2">
                {byDate[d].map((r) => (
                  <div
                    key={r.shift.id}
                    className="border rounded p-2 text-xs space-y-1 bg-neutral-50"
                  >
                    <div className="font-medium">{r.user?.name}</div>
                    <div className="text-neutral-500">{r.point?.name}</div>
                    <div>
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
                        <form
                          action={deleteShift.bind(null, r.shift.id, schedule.id)}
                        >
                          <button className="text-red-600 underline underline-offset-2">
                            удалить
                          </button>
                        </form>
                      )}
                  </div>
                ))}
              </div>
            </div>
          ))}
        </div>
      )}

      {schedule && canManage && (schedule.status === "draft" || schedule.status === "published") && (
        <div className="border rounded-lg p-4 bg-white">
          <h2 className="font-medium mb-3">Добавить смену / визит-задачу</h2>
          <form
            action={addShift.bind(null, schedule.id)}
            className="grid sm:grid-cols-[1.3fr_1.3fr_1fr_1fr_1fr_1fr_auto] gap-3 items-end"
          >
            <div className="space-y-1">
              <label className="text-xs text-neutral-500">Сотрудник</label>
              <select name="userId" required className="w-full border rounded px-2 py-1.5 text-sm">
                {activeUsers.map((u) => (
                  <option key={u.id} value={u.id}>
                    {u.name}
                  </option>
                ))}
              </select>
            </div>
            <div className="space-y-1">
              <label className="text-xs text-neutral-500">Точка</label>
              <select name="pointId" required className="w-full border rounded px-2 py-1.5 text-sm">
                {activePoints.map((p) => (
                  <option key={p.id} value={p.id}>
                    {p.name}
                  </option>
                ))}
              </select>
            </div>
            <div className="space-y-1">
              <label className="text-xs text-neutral-500">Дата</label>
              <select name="date" required className="w-full border rounded px-2 py-1.5 text-sm">
                {dates.map((d) => (
                  <option key={d} value={d}>
                    {weekdayShort(d)} {formatDateHuman(d)}
                  </option>
                ))}
              </select>
            </div>
            <div className="space-y-1">
              <label className="text-xs text-neutral-500">Тип</label>
              <select name="type" className="w-full border rounded px-2 py-1.5 text-sm">
                <option value="SHIFT">Смена</option>
                <option value="VISIT">Визит-задача</option>
              </select>
            </div>
            <div className="space-y-1">
              <label className="text-xs text-neutral-500">Начало</label>
              <input type="time" name="plannedStart" className="w-full border rounded px-2 py-1.5 text-sm" />
            </div>
            <div className="space-y-1">
              <label className="text-xs text-neutral-500">Конец / примечание</label>
              <input
                name="detail"
                placeholder="18:00 или текст для визита"
                className="w-full border rounded px-2 py-1.5 text-sm"
              />
            </div>
            <button
              type="submit"
              className="text-sm bg-neutral-900 text-white rounded px-3 py-1.5 hover:bg-neutral-800"
            >
              Добавить
            </button>
          </form>
          <p className="text-xs text-neutral-400 mt-2">
            Для визит-задачи укажите тип «Визит-задача» — поля времени можно оставить пустыми, а в поле
            «Конец / примечание» написать, что за задача (например, «съёмка контента»).
          </p>
        </div>
      )}

      {schedule?.status === "draft" && canManage && (
        <form action={submitForApproval.bind(null, schedule.id)}>
          <button className="bg-neutral-900 text-white rounded px-4 py-2 text-sm hover:bg-neutral-800">
            {me.role === "owner"
              ? "Отправить сотрудникам на подтверждение"
              : "Отправить на утверждение владельцу"}
          </button>
        </form>
      )}

      {schedule?.status === "pending_owner" && me.role === "owner" && (
        <div className="border rounded-lg p-4 bg-white space-y-3">
          <h2 className="font-medium">График ожидает вашего утверждения</h2>
          <form action={ownerApprove.bind(null, schedule.id)}>
            <button className="bg-neutral-900 text-white rounded px-4 py-2 text-sm hover:bg-neutral-800">
              Утвердить график
            </button>
          </form>
          <form action={ownerReject.bind(null, schedule.id)} className="flex gap-2">
            <input
              name="comment"
              placeholder="Комментарий, что нужно поправить"
              className="border rounded px-2 py-1.5 text-sm flex-1"
            />
            <button className="bg-amber-600 text-white rounded px-3 py-1.5 text-sm hover:bg-amber-700">
              Вернуть на доработку
            </button>
          </form>
        </div>
      )}

      {schedule?.status === "pending_employee" && canManage && myPending.length === 0 && (
        <form action={publishAnyway.bind(null, schedule.id)}>
          <button className="bg-neutral-700 text-white rounded px-4 py-2 text-sm hover:bg-neutral-600">
            Опубликовать сейчас (не дожидаясь всех подтверждений)
          </button>
        </form>
      )}
    </div>
  );
}
