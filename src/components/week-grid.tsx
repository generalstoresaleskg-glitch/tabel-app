"use client";

import { useState, useMemo } from "react";
import { weekdayShort, weekdayFull, formatDateHuman } from "@/lib/dates";
import { userColor, initials } from "@/lib/user-color";
import { roleLabel } from "@/lib/role-label";

export type CellEntry = {
  shiftId: string;
  userId: string;
  userName: string;
  userRole: string;
  type: "SHIFT" | "VISIT";
  note: string | null;
  isMe: boolean;
  attendance: { checkinAt: string | null; checkoutAt: string | null } | null;
};

type PointLite = { id: string; name: string };
type AssignableUser = { id: string; name: string; role: string };

// Аватар в ячейке: сплошной цветной кружок — обязательная смена (SHIFT),
// белый с пунктирной обводкой — визит (VISIT). Своя смена — с индиго-кольцом.
// Крупнее, чем в первой версии — на реальном экране 24px было мелко и трудно
// попасть пальцем, особенно в Safari на iPhone.
function Avatar({ entry }: { entry: CellEntry }) {
  const isShift = entry.type === "SHIFT";
  return (
    <span
      title={entry.userName}
      className={
        "flex h-8 w-8 shrink-0 items-center justify-center rounded-full text-[11px] font-bold leading-none " +
        (isShift
          ? `${userColor(entry.userId)} text-white`
          : "bg-white text-slate-500 border-2 border-dashed border-slate-400") +
        (entry.isMe ? " ring-2 ring-indigo-600 ring-offset-1" : "")
      }
    >
      {initials(entry.userName)}
    </span>
  );
}

function WarnBadge() {
  return (
    <span
      className="flex h-7 w-7 shrink-0 items-center justify-center rounded-full border-2 border-amber-500 bg-white text-sm font-black text-amber-500"
      title="Нет обязательного сотрудника"
    >
      !
    </span>
  );
}

export function WeekGrid({
  points,
  dates,
  today,
  cells,
  missing,
  scheduleId,
  scheduleStatus,
  canManage,
  allowCheckIn,
  assignableUsers,
  addShiftAction,
  deleteShiftAction,
  checkInAction,
  checkOutAction,
  markVisitAction,
}: {
  points: PointLite[];
  dates: string[];
  today: string;
  cells: Record<string, Record<string, CellEntry[]>>;
  missing: string[];
  scheduleId: string | null;
  scheduleStatus: "draft" | "pending_owner" | "published" | null;
  canManage: boolean;
  allowCheckIn: boolean;
  assignableUsers: AssignableUser[];
  addShiftAction?: (formData: FormData) => void | Promise<void>;
  deleteShiftAction?: (shiftId: string, scheduleId: string) => void | Promise<void>;
  checkInAction?: (shiftId: string) => void | Promise<void>;
  checkOutAction?: (shiftId: string) => void | Promise<void>;
  markVisitAction?: (shiftId: string) => void | Promise<void>;
}) {
  const [selected, setSelected] = useState<{ pointId: string; date: string } | null>(null);
  const [adding, setAdding] = useState(false);
  const missingSet = useMemo(() => new Set(missing), [missing]);

  const sortedUsers = [...assignableUsers].sort((a, b) => {
    const order: Record<string, number> = { employee: 0, manager: 1, owner: 2 };
    return (order[a.role] ?? 9) - (order[b.role] ?? 9) || a.name.localeCompare(b.name, "ru");
  });

  function close() {
    setSelected(null);
    setAdding(false);
  }

  const activePoint = selected ? points.find((p) => p.id === selected.pointId) : null;
  const activeEntries =
    selected ? cells[selected.pointId]?.[selected.date] ?? [] : [];
  const canEditHere = canManage && !!scheduleId;

  return (
    <div className="card relative overflow-hidden p-2.5">
      {/* Общая шапка с датами — один раз сверху, не в каждой строке точки, чтобы
          не отъедать ширину под колонку с названием точки на каждой строке. */}
      <div className="grid grid-cols-7 gap-1 px-0.5 pb-1.5">
        {dates.map((d) => {
          const isToday = d === today;
          return (
            <div
              key={d}
              className={`rounded-lg py-1 text-center ${isToday ? "bg-emerald-50 text-emerald-700" : "text-slate-500"}`}
            >
              <div className="text-[11px] font-bold">{weekdayShort(d)}</div>
              <div className="text-sm font-bold">{formatDateHuman(d)}</div>
            </div>
          );
        })}
      </div>

      {/* Каждая точка — своя секция на всю ширину: имя точки сверху, а под ним
          7 ячеек-дней в CSS-сетке на всю ширину экрана (без узкой колонки слева,
          как было в таблице) — ячейка получает намного больше места под тап. */}
      <div className="space-y-2.5">
        {points.map((p) => (
          <div key={p.id} className="rounded-xl border border-slate-100 p-1.5">
            <div className="px-0.5 pb-1 text-xs font-bold text-slate-700">{p.name}</div>
            <div className="grid grid-cols-7 gap-1">
              {dates.map((d) => {
                const entries = cells[p.id]?.[d] ?? [];
                const isMissing = missingSet.has(`${p.id}_${d}`);
                const isToday = d === today;
                const shown = entries.slice(0, 2);
                const overflow = entries.length - shown.length;
                return (
                  <button
                    key={d}
                    type="button"
                    data-testid="grid-cell"
                    aria-label={`${p.name}, ${d}`}
                    onClick={() => setSelected({ pointId: p.id, date: d })}
                    className={`flex min-h-16 flex-col items-center justify-center gap-1 rounded-lg p-1 ${
                      isMissing ? "bg-amber-50" : isToday ? "bg-emerald-50/70" : "bg-slate-50"
                    }`}
                  >
                    <div className="flex flex-wrap items-center justify-center gap-1">
                      {shown.map((e) => (
                        <Avatar key={e.shiftId} entry={e} />
                      ))}
                      {overflow > 0 && (
                        <span className="flex h-8 w-8 shrink-0 items-center justify-center rounded-full bg-slate-200 text-[11px] font-bold text-slate-600">
                          +{overflow}
                        </span>
                      )}
                      {isMissing && <WarnBadge />}
                    </div>
                  </button>
                );
              })}
            </div>
          </div>
        ))}
      </div>

      {selected && activePoint && (
        <div
          className="fixed inset-0 z-30 flex items-end bg-slate-900/40"
          onClick={close}
        >
          <div
            className="mx-auto w-full max-w-lg rounded-t-2xl bg-white p-4 shadow-2xl"
            onClick={(e) => e.stopPropagation()}
          >
            <div className="mx-auto mb-3 h-1 w-9 rounded-full bg-slate-200" />
            <div className="flex items-start justify-between gap-3">
              <div>
                <h3 className="text-base font-bold text-slate-900">{activePoint.name}</h3>
                <p className="text-xs text-slate-500">
                  {weekdayFull(selected.date)}, {formatDateHuman(selected.date)}
                  {selected.date === today && <span className="badge-brand ml-2">сегодня</span>}
                </p>
              </div>
              <button type="button" onClick={close} className="btn-ghost btn-sm !px-2">
                ✕
              </button>
            </div>

            <div className="mt-3 max-h-[45vh] space-y-2 overflow-y-auto">
              {activeEntries.length === 0 && (
                <p className="py-2 text-sm text-slate-400">Никто не назначен.</p>
              )}
              {activeEntries.map((e) => {
                const showCheckIn =
                  allowCheckIn &&
                  e.isMe &&
                  selected.date === today &&
                  scheduleStatus === "published";
                return (
                  <div
                    key={e.shiftId}
                    className="flex items-center gap-2.5 rounded-xl border border-slate-200 bg-slate-50 p-2.5"
                  >
                    <Avatar entry={e} />
                    <div className="min-w-0 flex-1">
                      <p className="truncate text-sm font-semibold text-slate-900">
                        {e.userName}
                        {e.isMe && <span className="ml-1.5 text-xs font-normal text-indigo-600">это вы</span>}
                      </p>
                      <p className="text-xs text-slate-500">
                        {e.userRole !== "employee" && `${roleLabel(e.userRole)} · `}
                        {e.type === "SHIFT" ? "Смена" : `Визит${e.note ? ": " + e.note : ""}`}
                      </p>
                      {showCheckIn && e.type === "SHIFT" && !e.attendance?.checkinAt && checkInAction && (
                        <form action={checkInAction.bind(null, e.shiftId)} className="mt-2">
                          <button className="btn-primary btn-sm !bg-emerald-600 hover:!bg-emerald-700 w-full">
                            ✓ Я на месте
                          </button>
                        </form>
                      )}
                      {showCheckIn &&
                        e.type === "SHIFT" &&
                        e.attendance?.checkinAt &&
                        !e.attendance.checkoutAt &&
                        checkOutAction && (
                          <form action={checkOutAction.bind(null, e.shiftId)} className="mt-2">
                            <button className="btn-secondary btn-sm w-full">Я ухожу</button>
                          </form>
                        )}
                      {showCheckIn && e.type === "VISIT" && !e.attendance?.checkinAt && markVisitAction && (
                        <form action={markVisitAction.bind(null, e.shiftId)} className="mt-2">
                          <button className="btn-primary btn-sm !bg-emerald-600 hover:!bg-emerald-700 w-full">
                            ✓ Посетил(а) точку
                          </button>
                        </form>
                      )}
                    </div>
                    {canEditHere && deleteShiftAction && scheduleId && (
                      <form action={deleteShiftAction.bind(null, e.shiftId, scheduleId)}>
                        <button className="btn-link-danger !text-xs shrink-0">убрать</button>
                      </form>
                    )}
                  </div>
                );
              })}
            </div>

            {canEditHere && !adding && (
              <button
                type="button"
                onClick={() => setAdding(true)}
                className="mt-3 w-full rounded-xl border-[1.5px] border-dashed border-indigo-300 bg-white py-2.5 text-sm font-semibold text-indigo-600"
              >
                + Добавить сотрудника
              </button>
            )}

            {canEditHere && adding && addShiftAction && (
              <form action={addShiftAction} className="mt-3 space-y-2 rounded-xl border border-dashed border-slate-300 p-3">
                <input type="hidden" name="pointId" value={selected.pointId} />
                <input type="hidden" name="dates" value={selected.date} />
                <select name="userId" required className="input !py-1.5 !text-sm">
                  {sortedUsers.map((u) => (
                    <option key={u.id} value={u.id}>
                      {u.name}
                      {u.role !== "employee" ? ` (${roleLabel(u.role)})` : ""}
                    </option>
                  ))}
                </select>
                <div className="flex gap-1.5">
                  <label className="type-option flex-1 text-center">
                    <input type="radio" name="type" value="SHIFT" defaultChecked className="sr-only" />
                    Смена
                  </label>
                  <label className="type-option flex-1 text-center">
                    <input type="radio" name="type" value="VISIT" className="sr-only" />
                    Визит
                  </label>
                </div>
                <input name="note" placeholder="Комментарий к визиту (необязательно)" className="input !py-1.5 !text-sm" />
                <div className="flex gap-2">
                  <button type="submit" className="btn-primary btn-sm flex-1">
                    Добавить
                  </button>
                  <button type="button" onClick={() => setAdding(false)} className="btn-secondary btn-sm">
                    Отмена
                  </button>
                </div>
              </form>
            )}
          </div>
        </div>
      )}
    </div>
  );
}
