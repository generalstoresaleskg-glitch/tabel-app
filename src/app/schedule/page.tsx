import Link from "next/link";
import { requireUser } from "@/lib/session";
import { mondayOf, addDays, weekDates, formatDateHuman, todayISO } from "@/lib/dates";
import {
  getScheduleByWeek,
  getShiftsWithDetails,
  getAllActivePoints,
  getAssignableUsers,
  getWeeksAwaitingOwnerApproval,
  getMissingShiftSlots,
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
import { WeekGrid, CellEntry } from "@/components/week-grid";

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
type AssignableUser = { id: string; name: string; role: string };

// Собираем плоский список смен в структуру "точка -> дата -> список людей",
// сразу упорядочивая обязательные смены (SHIFT) перед визитами (VISIT) —
// именно в таком порядке они должны идти внутри ячейки.
function buildCells(rows: ShiftRow[], viewerId: string): Record<string, Record<string, CellEntry[]>> {
  const result: Record<string, Record<string, CellEntry[]>> = {};
  for (const row of rows) {
    if (!row.user) continue;
    const pointId = row.shift.pointId;
    const date = row.shift.date;
    result[pointId] ??= {};
    result[pointId][date] ??= [];
    result[pointId][date].push({
      shiftId: row.shift.id,
      userId: row.user.id,
      userName: row.user.name,
      userRole: row.user.role,
      type: row.shift.type,
      note: row.shift.note,
      isMe: row.user.id === viewerId,
      attendance: row.attendance
        ? { checkinAt: row.attendance.checkinAt, checkoutAt: row.attendance.checkoutAt }
        : null,
    });
  }
  for (const byDate of Object.values(result)) {
    for (const list of Object.values(byDate)) {
      list.sort((a, b) => (a.type === b.type ? 0 : a.type === "SHIFT" ? -1 : 1));
    }
  }
  return result;
}

async function WeekSection({
  weekStart,
  label,
  readOnly,
  me,
  canManage,
  allPoints,
  assignableUsers,
  today,
}: {
  weekStart: string;
  label: string;
  readOnly: boolean;
  me: { id: string; role: string };
  canManage: boolean;
  allPoints: PointLite[];
  assignableUsers: AssignableUser[];
  today: string;
}) {
  const dates = weekDates(weekStart);
  const schedule = await getScheduleByWeek(weekStart);
  const shiftRows = schedule ? await getShiftsWithDetails(schedule.id) : [];
  const cells = buildCells(shiftRows, me.id);
  const missing = schedule ? [...(await getMissingShiftSlots(schedule.id, weekStart))] : [];

  const prevWeekStart = addDays(weekStart, -7);
  const canCopyPrev = canManage && !schedule && !!(await getScheduleByWeek(prevWeekStart));

  return (
    <section className="space-y-3">
      <div className="flex items-center justify-between flex-wrap gap-2">
        <div>
          <span className="badge-brand">{label}</span>
          <h2 className="mt-1 text-lg font-semibold text-slate-900">
            {formatDateHuman(dates[0])}–{formatDateHuman(dates[6])}
          </h2>
        </div>
        {schedule && <span className={STATUS_BADGE[schedule.status]}>{STATUS_LABEL[schedule.status]}</span>}
      </div>

      {!readOnly && canManage && !schedule && (
        <div className="card-pad flex flex-wrap items-center gap-3">
          <span className="text-sm text-slate-500">Графика на эту неделю ещё нет.</span>
          <form action={createDraftForWeek.bind(null, weekStart)}>
            <button className="btn-primary btn-sm">Создать черновик</button>
          </form>
          {canCopyPrev && (
            <form action={copyPreviousWeek.bind(null, weekStart)}>
              <button className="btn-secondary btn-sm">Скопировать с прошлой недели</button>
            </form>
          )}
        </div>
      )}

      {!readOnly && !schedule && !canManage && (
        <p className="text-sm text-slate-500">График на эту неделю ещё не составлен.</p>
      )}

      {!readOnly && schedule?.status === "draft" && schedule.ownerComment && (
        <div className="rounded-lg border border-amber-200 bg-amber-50 px-3 py-2 text-sm text-amber-800">
          Комментарий владельца: {schedule.ownerComment}
        </div>
      )}

      {!readOnly && canManage && schedule?.status === "draft" && (
        <div className="card-pad flex flex-wrap items-center gap-3">
          {missing.length > 0 ? (
            <span className="text-sm text-amber-700">
              ⚠ Нельзя отправить: не хватает обязательного сотрудника на {missing.length}{" "}
              {missing.length === 1 ? "точке/дне" : "точках/днях"} — отмечены жёлтым в таблице ниже.
            </span>
          ) : (
            <form action={submitForApproval.bind(null, schedule.id)}>
              <button className="btn-primary btn-sm">
                {me.role === "owner" ? "Опубликовать график" : "Отправить на утверждение владельцу"}
              </button>
            </form>
          )}
        </div>
      )}

      {!readOnly && schedule?.status === "pending_owner" && me.role === "owner" && (
        <div className="card-pad flex flex-wrap items-center gap-3">
          <form action={ownerApprove.bind(null, schedule.id)}>
            <button className="btn-primary btn-sm">Утвердить и опубликовать</button>
          </form>
          <form action={ownerReject.bind(null, schedule.id)} className="flex flex-1 min-w-[240px] gap-2">
            <input name="comment" placeholder="Комментарий, что нужно поправить" className="input !py-1.5 !text-sm flex-1" />
            <button className="btn-warning btn-sm">Вернуть на доработку</button>
          </form>
        </div>
      )}

      {!readOnly && schedule?.status === "pending_owner" && me.role !== "owner" && (
        <p className="text-sm text-slate-500">Ждём утверждения владельцем.</p>
      )}

      {!readOnly && canManage && schedule?.status === "published" && (
        <p className="text-sm text-slate-500">
          График опубликован, сотрудники уже его видят. Если что-то поменялось —
          просто нажмите на нужную ячейку в таблице ниже: можно добавить или убрать
          человека, изменения применятся сразу, без повторного утверждения.
        </p>
      )}

      {schedule && (
        <WeekGrid
          points={allPoints}
          dates={dates}
          today={today}
          cells={cells}
          missing={readOnly ? [] : missing}
          scheduleId={schedule.id}
          scheduleStatus={schedule.status}
          canManage={!readOnly && canManage && (schedule.status === "draft" || schedule.status === "published")}
          allowCheckIn={!readOnly}
          assignableUsers={assignableUsers}
          addShiftAction={!readOnly ? addShift.bind(null, schedule.id) : undefined}
          deleteShiftAction={!readOnly ? deleteShift : undefined}
          checkInAction={!readOnly ? checkIn : undefined}
          checkOutAction={!readOnly ? checkOut : undefined}
          markVisitAction={!readOnly ? markVisit : undefined}
        />
      )}
    </section>
  );
}

export default async function SchedulePage({
  searchParams,
}: {
  searchParams: Promise<{ week?: string }>;
}) {
  const me = await requireUser();
  const { week } = await searchParams;
  const canManage = me.role === "owner" || me.role === "manager";
  const today = todayISO();
  const currentWeekStart = mondayOf(today);
  const nextWeekStart = addDays(currentWeekStart, 7);

  const allPoints = await getAllActivePoints();
  const assignableUsers = await getAssignableUsers();

  const requestedWeek = week ? mondayOf(week) : null;
  const isHistory = requestedWeek !== null && requestedWeek !== currentWeekStart && requestedWeek !== nextWeekStart;

  const weeksAwaitingOwnerApproval =
    me.role === "owner" ? await getWeeksAwaitingOwnerApproval() : [];

  if (isHistory) {
    const weekStart = requestedWeek!;
    const weekLabel =
      weekStart < currentWeekStart ? "Прошедшая неделя" : "Будущая неделя";
    return (
      <div className="space-y-6">
        <div className="flex items-center justify-between flex-wrap gap-3">
          <Link href="/schedule" className="btn-secondary btn-sm">
            ← Вернуться к текущей неделе
          </Link>
          <div className="flex gap-2">
            <Link href={`/schedule?week=${addDays(weekStart, -7)}`} className="btn-secondary btn-sm">
              ← Пред. неделя
            </Link>
            <Link href={`/schedule?week=${addDays(weekStart, 7)}`} className="btn-secondary btn-sm">
              След. неделя →
            </Link>
          </div>
        </div>
        <p className="text-sm text-slate-500">
          Просмотр архива — только чтение, без редактирования и отметок.
        </p>
        <WeekSection
          weekStart={weekStart}
          label={weekLabel}
          readOnly
          me={me}
          canManage={canManage}
          allPoints={allPoints}
          assignableUsers={assignableUsers}
          today={today}
        />
      </div>
    );
  }

  return (
    <div className="space-y-8">
      {weeksAwaitingOwnerApproval
        .filter((w) => w !== currentWeekStart && w !== nextWeekStart)
        .map((w) => (
          <div
            key={w}
            className="flex flex-wrap items-center justify-between gap-2 rounded-xl border border-amber-300 bg-amber-50 px-4 py-3 text-sm text-amber-900"
          >
            <span>
              Черновик на неделе {formatDateHuman(w)}–{formatDateHuman(addDays(w, 6))} ждёт вашего утверждения.
            </span>
            <Link href={`/schedule?week=${w}`} className="btn-primary btn-sm">
              Перейти и утвердить
            </Link>
          </div>
        ))}

      <WeekSection
        weekStart={currentWeekStart}
        label="Текущая неделя"
        readOnly={false}
        me={me}
        canManage={canManage}
        allPoints={allPoints}
        assignableUsers={assignableUsers}
        today={today}
      />

      <WeekSection
        weekStart={nextWeekStart}
        label="Следующая неделя"
        readOnly={false}
        me={me}
        canManage={canManage}
        allPoints={allPoints}
        assignableUsers={assignableUsers}
        today={today}
      />

      <Link href={`/schedule?week=${addDays(currentWeekStart, -7)}`} className="btn-link block text-center">
        Показать прошлые недели →
      </Link>
    </div>
  );
}
