"use client";

import { useState } from "react";
import { weekdayShort, formatDateHuman } from "@/lib/dates";
import { pointColor } from "@/lib/point-color";
import { userColor, initials } from "@/lib/user-color";

export type TeamEntry = {
  shiftId: string;
  userId: string;
  userName: string;
  pointId: string;
  pointName: string;
  date: string;
  timeLabel: string;
  doubleBooked: boolean;
};

// Горизонтальные "таблетки" дней недели + список того, кто работает в выбранный
// день — вместо широкой таблицы, которая не помещается на экран телефона.
export function TeamDayView({
  dates,
  today,
  entries,
}: {
  dates: string[];
  today: string;
  entries: TeamEntry[];
}) {
  const [selected, setSelected] = useState(dates.includes(today) ? today : dates[0]);
  const dayEntries = entries.filter((e) => e.date === selected);

  return (
    <div className="space-y-3">
      <div className="flex gap-1.5 overflow-x-auto pb-1 -mx-1 px-1">
        {dates.map((d) => {
          const isToday = d === today;
          const active = d === selected;
          return (
            <button
              key={d}
              type="button"
              onClick={() => setSelected(d)}
              className={
                "flex min-w-[52px] flex-col items-center gap-0.5 rounded-xl px-2.5 py-2 transition-colors " +
                (active
                  ? "bg-indigo-600 text-white"
                  : isToday
                  ? "bg-indigo-50 text-indigo-700"
                  : "bg-slate-100 text-slate-500 hover:bg-slate-200")
              }
            >
              <span className="text-[10px] font-medium uppercase tracking-wide opacity-80">
                {weekdayShort(d)}
              </span>
              <span className="text-sm font-semibold">{formatDateHuman(d)}</span>
            </button>
          );
        })}
      </div>

      <div className="space-y-2">
        {dayEntries.length === 0 && (
          <p className="px-1 text-sm text-slate-400">В этот день никто не назначен.</p>
        )}
        {dayEntries.map((e) => {
          const pc = pointColor(e.pointId);
          return (
            <div key={e.shiftId} className="card-pad flex items-center gap-3">
              <span
                className={`flex h-8 w-8 shrink-0 items-center justify-center rounded-full text-xs font-semibold text-white ${userColor(
                  e.userId
                )}`}
              >
                {initials(e.userName)}
              </span>
              <div className="min-w-0 flex-1">
                <p className="truncate text-sm font-medium text-slate-900">{e.userName}</p>
                <span
                  className={`mt-0.5 inline-flex items-center gap-1.5 rounded-full px-2 py-0.5 text-[11px] font-medium ${pc.badge}`}
                >
                  <span className={`h-1.5 w-1.5 rounded-full ${pc.dot}`} />
                  {e.pointName}
                </span>
              </div>
              <div className="text-right text-sm text-slate-600">
                {e.timeLabel}
                {e.doubleBooked && <div className="badge-warning mt-1">⚠ ещё задача</div>}
              </div>
            </div>
          );
        })}
      </div>
    </div>
  );
}
