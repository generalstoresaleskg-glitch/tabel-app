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
  getWeeksAwaitingOwnerApproval,
  ShiftRow,
} from "@/lib/schedule-queries";
import {
  createDraftForWeek,
  copyPreviousWeek,
  addShift,
  deleteShift,
  submitForApproval,
  ownerApprove,
  ownerReject,
} from "./actions";
import { checkIn, checkOut, markVisit } from "./attendance-actions";
import { DayCheckboxes } from "@/components/day-checkboxes";
import { pointColor } from "@/lib/point-color";
import { userColor, initials } from "@/lib/user-color";

const STATUS_LABEL: Record<string, string> = {
  draft: "Черновик",
  pending_owner: "На утверждении у владельца",
  published: "Опубликован",
};

const STATUS_BADGE: Record<string, string> = {
  draft: "badge-neutral",
  pending_owner: "badge-warning",
  published: "badge-success",
};

type PointLite = { id: string; name: string };

function PointBadge({ point }: { point: PointLite | null }) {
  if (!point) return null;
  const color = pointColor(point.id);
  return (
    <span className={`inline-flex items-center gap-1.5 rounded-full px-2.5 py-1 text-xs font-medium ${color.badge}`}>
      <span className={`h-1.5 w-1.5 rounded-full ${color.dot}`} />
      {point.name}
    </span>
  );
}

type UserLite = { id: string; name: string };

function UserAvatar({ user }: { user: UserLite | null }) {
  if (!user) return null;
  return (
    <span
      className={`inline-flex h-6 w-6 shrink-0 items-center justify-center rounded-full text-[10px] font-semibold text-white ${userColor(
        user.id
      )}`}
      title={user.name}
    >
      {initials(user.name)}
    </span>
  );
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

// Кнопки прихода/ухода — только для собственных смен и только пока график
// опубликован (viewerId защищает от "мёртвых" кнопок на чужих карточках).
function ShiftActions({
  row,
  scheduleStatus,
  viewerId,
}: {
  row: ShiftRow;
  scheduleStatus: string;
  viewerId: string;
}) {
  const { shift, attendance } = row;
  if (scheduleStatus !== "published") return null;
  if (shift.userId !== viewerId) return null;

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

// Переключатель "Смена / Визит-задача" — чистый CSS (.type-toggle в globals.css),
// работает без единой строчки JS и одинаково для любого числа форм на странице.
function ShiftTypeFields({ idPrefix, small }: { idPrefix: string; small?: boolean }) {
  const size = small ? "!py-1 !text-[11px]" : "";
  return (
    <div className="type-toggle space-y-2">
      <div className="flex gap-1.5">
        <label htmlFor={`${idPrefix}-shift`} className={`type-option ${small ? "!px-2 !py-1 !text-[11px]" : ""}`}>
          <input id={`${idPrefix}-shift`} type="radio" name="type" value="SHIFT" defaultChecked className="sr-only" />
          Смена
        </label>
        <label htmlFor={`${idPrefix}-visit`} className={`type-option ${small ? "!px-2 !py-1 !text-[11px]" : ""}`}>
          <input id={`${idPrefix}-visit`} type="radio" name="type" value="VISIT" className="sr-only" />
          Визит
        </label>
      </div>

      <div className={`shift-only grid ${small ? "grid-cols-2 gap-1.5" : "sm:grid-cols-2 gap-3"}`}>
        <input type="time" name="plannedStart" placeholder="начало" className={`input ${size}`} />
        <input type="time" name="plannedEnd" placeholder="конец" className={`input ${size}`} />
        {!small && (
          <p className="text-xs text-slate-400 sm:col-span-2">
            Оставьте пустым — подставятся стандартные часы работы точки.
          </p>
        )}
      </div>

      <div className="visit-only">
        <input name="note" placeholder="Что за задача" className={`input ${size}`} />
      </div>
    </div>
  );
}

// Таблица-сетка: сотрудники строками, дни недели столбцами (как в 7shifts/Homebase).
// Точка показывается тегом внутри карточки смены. editable=false — только чтение
// (используется в свёрнутом "графике всей команды" на мобильном виде сотрудника).
function ScheduleGrid({
  rows,
  dates,
  today,
  byUserDate,
  scheduleId,
  scheduleStatus,
  editable,
  allPoints,
  isDoubleBooked,
  viewerId,
}: {
  rows: UserLite[];
  dates: string[];
  today: string;
  byUserDate: Map<string, Map<string, ShiftRow[]>>;
  scheduleId: string;
  scheduleStatus: string;
  editable: boolean;
  allPoints: PointLite[];
  isDoubleBooked: (row: ShiftRow) => boolean;
  viewerId: string;
}) {
  return (
    <div className="card overflow-x-auto">
      <table className="w-full border-collapse text-xs">
        <thead>
          <tr>
            <th className="sticky left-0 z-10 min-w-[150px] border-b border-slate-200 bg-white p-2.5 text-left text-xs font-semibold uppercase tracking-wide text-slate-500">
              Сотрудник
            </th>
            {dates.map((d) => {
              const isToday = d === today;
              return (
                <th
                  key={d}
                  className={`min-w-[170px] border-b border-l border-slate-200 p-2.5 text-left ${
                    isToday ? "bg-indigo-50" : ""
                  }`}
                >
                  <div className={`text-sm font-semibold ${isToday ? "text-indigo-700" : "text-slate-700"}`}>
                    {weekdayShort(d)}
                  </div>
                  <div className="text-xs font-normal text-slate-400">{formatDateHuman(d)}</div>
                </th>
              );
            })}
          </tr>
        </thead>
        <tbody>
          {rows.map((u) => (
            <tr key={u.id} className="border-b border-slate-100 align-top">
              <td className="sticky left-0 z-10 bg-white p-2.5 align-top">
                <div className="flex items-center gap-2">
                  <UserAvatar user={u} />
                  <span className="text-sm font-medium text-slate-900">{u.name}</span>
                </div>
              </td>
              {dates.map((d) => {
                const cellRows = byUserDate.get(u.id)?.get(d) ?? [];
                const isToday = d === today;
                return (
                  <td
                    key={d}
                    className={`border-l border-slate-100 p-2 align-top ${isToday ? "bg-indigo-50/40" : ""}`}
                  >
                    <div className="space-y-1.5">
                      {cellRows.map((r) => (
                        <div
                          key={r.shift.id}
                          className={`rounded-lg border p-2 text-xs space-y-1 ${
                            isDoubleBooked(r)
                              ? "border-amber-300 bg-amber-50"
                              : "border-slate-200 bg-slate-50"
                          }`}
                        >
                          <PointBadge point={r.point} />
                          <div className="text-slate-700">
                            {r.shift.type === "SHIFT"
                              ? `${r.shift.plannedStart}–${r.shift.plannedEnd}`
                              : `Визит${r.shift.note ? ": " + r.shift.note : ""}`}
                          </div>
                          {isDoubleBooked(r) && (
                            <div className="badge-warning">⚠ ещё задача в этот день</div>
                          )}
                          <AttendanceBadge row={r} />
                          <ShiftActions row={r} scheduleStatus={scheduleStatus} viewerId={viewerId} />
                          {editable && (
                            <form action={deleteShift.bind(null, r.shift.id, scheduleId)}>
                              <button className="btn-link-danger !text-xs">удалить</button>
                            </form>
                          )}
                        </div>
                      ))}
                      {cellRows.length === 0 && !editable && (
                        <div className="text-xs text-slate-300">—</div>
                      )}

                      {editable && (
                        <details>
                          <summary className="cursor-pointer text-xs font-medium text-indigo-600 hover:text-indigo-800">
                            + добавить
                          </summary>
                          <form
                            action={addShift.bind(null, scheduleId)}
                            className="mt-1.5 space-y-1.5 rounded-lg border border-dashed border-slate-300 p-2"
                          >
                            <input type="hidden" name="dates" value={d} />
                            <input type="hidden" name="userId" value={u.id} />
                            <select name="pointId" required className="input !py-1 !text-[11px]">
                              {allPoints.map((p) => (
                                <option key={p.id} value={p.id}>
                                  {p.name}
                                </option>
                              ))}
                            </select>
                            <ShiftTypeFields idPrefix={`c-${u.id}-${d}`} small />
                            <button type="submit" className="btn-primary btn-sm w-full !py-1 !text-[11px]">
                              Добавить
                            </button>
                          </form>
                        </details>
                      )}
                    </div>
                  </td>
                );
              })}
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

// Личный вид сотрудника на телефоне: вертикальный список своих смен по дням,
// без горизонтальной прокрутки и без таблицы — читается как в мобильном приложении.
function MyScheduleList({
  dates,
  myByDate,
  scheduleStatus,
  today,
  viewerId,
}: {
  dates: string[];
  myByDate: Map<string, ShiftRow[]>;
  scheduleStatus: string;
  today: string;
  viewerId: string;
}) {
  return (
    <div className="space-y-3">
      {dates.map((d) => {
        const rows = myByDate.get(d) ?? [];
        const isToday = d === today;
        return (
          <div key={d} className={`card-pad ${isToday ? "border-indigo-300 ring-1 ring-indigo-100" : ""}`}>
            <div className="mb-2 flex items-center gap-2">
              <span className={`text-sm font-semibold ${isToday ? "text-indigo-700" : "text-slate-700"}`}>
                {weekdayShort(d)}, {formatDateHuman(d)}
              </span>
              {isToday && <span className="badge-brand">сегодня</span>}
            </div>
            {rows.length === 0 ? (
              <p className="text-sm text-slate-400">Выходной</p>
            ) : (
              <div className="space-y-2">
                {rows.map((r) => (
                  <div key={r.shift.id} className="space-y-1.5 rounded-xl border border-slate-200 bg-slate-50 p-3">
                    <PointBadge point={r.point} />
                    <div className="text-sm font-medium text-slate-900">
                      {r.shift.type === "SHIFT"
                        ? `${r.shift.plannedStart}–${r.shift.plannedEnd}`
                        : `Визит${r.shift.note ? ": " + r.shift.note : ""}`}
                    </div>
                    <AttendanceBadge row={r} />
                    <ShiftActions row={r} scheduleStatus={scheduleStatus} viewerId={viewerId} />
                  </div>
                ))}
              </div>
            )}
          </div>
        );
      })}
    </div>
  );
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
  const today = todayISO();

  const schedule = await getScheduleByWeek(weekStart);
  const shiftRows = schedule ? await getShiftsWithDetails(schedule.id) : [];
  const canManage = me.role === "owner" || me.role === "manager";

  const allPoints = await getAllActivePoints();
  // Нужны всем: и как строки таблицы менеджеру, и чтобы посчитать "мои смены" сотруднику.
  const assignableUsers = await getAssignableUsers();

  const prevWeek = addDays(weekStart, -7);
  const nextWeek = addDays(weekStart, 7);

  const byUserDate = new Map<string, Map<string, ShiftRow[]>>();
  for (const u of assignableUsers) {
    byUserDate.set(u.id, new Map(dates.map((d) => [d, [] as ShiftRow[]])));
  }
  for (const row of shiftRows) {
    const userMap = row.user && byUserDate.get(row.user.id);
    if (userMap && userMap.has(row.shift.date)) {
      userMap.get(row.shift.date)!.push(row);
    }
  }

  // Двойное назначение: один сотрудник в один день на двух и более задачах —
  // не запрещаем (иногда это осознанный выбор), но подсвечиваем предупреждением.
  const dateUserCounts = new Map<string, number>();
  for (const row of shiftRows) {
    const key = `${row.shift.date}_${row.shift.userId}`;
    dateUserCounts.set(key, (dateUserCounts.get(key) ?? 0) + 1);
  }
  function isDoubleBooked(row: ShiftRow) {
    return (dateUserCounts.get(`${row.shift.date}_${row.shift.userId}`) ?? 0) > 1;
  }

  const prevSchedule = canManage ? await getScheduleByWeek(prevWeek) : undefined;
  const canCopyPrevWeek = canManage && !schedule && !!prevSchedule;

  const dayOptions = dates.map((d, i) => ({
    value: d,
    label: `${weekdayShort(d)} ${formatDateHuman(d)}`,
    isWeekend: i === 5 || i === 6,
  }));

  const currentWeekStart = mondayOf(today);
  const weekLabel =
    weekStart === currentWeekStart
      ? "Текущая неделя"
      : weekStart === addDays(currentWeekStart, 7)
      ? "Следующая неделя"
      : weekStart === addDays(currentWeekStart, -7)
      ? "Прошлая неделя"
      : weekStart > currentWeekStart
      ? "Будущая неделя"
      : "Прошедшая неделя";

  // Напоминание владельцу про черновики других недель, ждущие его утверждения —
  // чтобы не потерялось, если по умолчанию открыта не та неделя.
  const weeksAwaitingOwnerApproval =
    me.role === "owner"
      ? (await getWeeksAwaitingOwnerApproval()).filter((w) => w !== weekStart)
      : [];

  // Личный список для сотрудника — только его смены на эту неделю.
  const myByDate = new Map<string, ShiftRow[]>();
  if (!canManage) {
    for (const d of dates) myByDate.set(d, []);
    for (const r of shiftRows) {
      if (r.shift.userId === me.id) myByDate.get(r.shift.date)?.push(r);
    }
  }

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between flex-wrap gap-3">
        <div>
          <span className="badge-brand">{weekLabel}</span>
          <h1 className="page-title mt-1">
            {formatDateHuman(dates[0])}–{formatDateHuman(dates[6])}
          </h1>
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

      {weeksAwaitingOwnerApproval.map((w) => (
        <div
          key={w}
          className="flex flex-wrap items-center justify-between gap-2 rounded-xl border border-amber-300 bg-amber-50 px-4 py-3 text-sm text-amber-900"
        >
          <span>
            Черновик на неделе {formatDateHuman(w)}–{formatDateHuman(addDays(w, 6))} ждёт вашего
            утверждения.
          </span>
          <Link href={`/schedule?week=${w}`} className="btn-primary btn-sm">
            Перейти и утвердить
          </Link>
        </div>
      ))}

      {/* Единая панель управления графиком этой недели — вся логика статуса здесь,
          а не отдельными кнопками в разных местах страницы. */}
      {canManage && (
        <div className="card-pad flex flex-wrap items-center gap-3">
          {!schedule && (
            <>
              <span className="text-sm text-slate-500">Графика на эту неделю ещё нет.</span>
              <form action={createDraftForWeek.bind(null, weekStart)}>
                <button className="btn-primary btn-sm">Создать черновик</button>
              </form>
              {canCopyPrevWeek && (
                <form action={copyPreviousWeek.bind(null, weekStart)}>
                  <button className="btn-secondary btn-sm">Скопировать с прошлой недели</button>
                </form>
              )}
            </>
          )}

          {schedule && (
            <span className={STATUS_BADGE[schedule.status]}>{STATUS_LABEL[schedule.status]}</span>
          )}

          {schedule?.status === "draft" && (
            <form action={submitForApproval.bind(null, schedule.id)}>
              <button className="btn-primary btn-sm">
                {me.role === "owner" ? "Опубликовать график" : "Отправить на утверждение владельцу"}
              </button>
            </form>
          )}

          {schedule?.status === "pending_owner" && me.role === "owner" && (
            <>
              <form action={ownerApprove.bind(null, schedule.id)}>
                <button className="btn-primary btn-sm">Утвердить и опубликовать</button>
              </form>
              <form action={ownerReject.bind(null, schedule.id)} className="flex gap-2 flex-1 min-w-[240px]">
                <input name="comment" placeholder="Комментарий, что нужно поправить" className="input !py-1.5 !text-sm flex-1" />
                <button className="btn-warning btn-sm">Вернуть на доработку</button>
              </form>
            </>
          )}

          {schedule?.status === "pending_owner" && me.role !== "owner" && (
            <span className="text-sm text-slate-500">Ждём утверждения владельцем.</span>
          )}

          {schedule?.status === "published" && (
            <span className="text-sm text-slate-500">
              График опубликован — сотрудники уже видят его, правки применяются сразу.
            </span>
          )}
        </div>
      )}

      {!schedule && !canManage && (
        <p className="text-sm text-slate-500">График на эту неделю ещё не составлен.</p>
      )}

      {schedule?.status === "draft" && schedule.ownerComment && (
        <div className="text-sm bg-amber-50 border border-amber-200 text-amber-800 rounded-lg px-3 py-2">
          Комментарий владельца: {schedule.ownerComment}
        </div>
      )}

      {schedule && !canManage && (
        <>
          <MyScheduleList
            dates={dates}
            myByDate={myByDate}
            scheduleStatus={schedule.status}
            today={today}
            viewerId={me.id}
          />

          <details className="card-pad">
            <summary className="cursor-pointer section-title">Показать график всей команды ▾</summary>
            <div className="mt-3">
              <ScheduleGrid
                rows={assignableUsers}
                dates={dates}
                today={today}
                byUserDate={byUserDate}
                scheduleId={schedule.id}
                scheduleStatus={schedule.status}
                editable={false}
                allPoints={allPoints}
                isDoubleBooked={isDoubleBooked}
                viewerId={me.id}
              />
            </div>
          </details>
        </>
      )}

      {schedule && canManage && (
        <ScheduleGrid
          rows={assignableUsers}
          dates={dates}
          today={today}
          byUserDate={byUserDate}
          scheduleId={schedule.id}
          scheduleStatus={schedule.status}
          editable={schedule.status === "draft" || schedule.status === "published"}
          allPoints={allPoints}
          isDoubleBooked={isDoubleBooked}
          viewerId={me.id}
        />
      )}

      {schedule && canManage && (schedule.status === "draft" || schedule.status === "published") && (
        <details className="card-pad">
          <summary className="cursor-pointer section-title">
            Добавить одну и ту же смену сразу на несколько дней ▾
          </summary>
          <form action={addShift.bind(null, schedule.id)} className="space-y-4 mt-4">
            <div className="grid sm:grid-cols-2 gap-3">
              <div>
                <label className="field-label">Сотрудник</label>
                <select name="userId" required className="input">
                  {assignableUsers.map((u) => (
                    <option key={u.id} value={u.id}>
                      {u.name}
                    </option>
                  ))}
                </select>
              </div>
              <div>
                <label className="field-label">Точка</label>
                <select name="pointId" required className="input">
                  {allPoints.map((p) => (
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

            <ShiftTypeFields idPrefix="bulk" />

            <button type="submit" className="btn-primary">
              Добавить на выбранные дни
            </button>
          </form>
          <p className="text-xs text-slate-400 mt-2">
            Для одного сотрудника и одного дня быстрее добавить прямо в таблице выше — ссылка
            «+ добавить» в нужной ячейке.
          </p>
        </details>
      )}
    </div>
  );
}
