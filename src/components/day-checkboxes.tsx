"use client";

import { useRef } from "react";

export function DayCheckboxes({
  days,
}: {
  days: { value: string; label: string; isWeekend: boolean }[];
}) {
  const containerRef = useRef<HTMLDivElement>(null);

  function setAll(predicate: (isWeekend: boolean) => boolean) {
    const box = containerRef.current;
    if (!box) return;
    box
      .querySelectorAll<HTMLInputElement>("input[type=checkbox]")
      .forEach((el) => {
        el.checked = predicate(el.dataset.weekend === "1");
      });
  }

  return (
    <div ref={containerRef} className="space-y-2">
      <div className="flex flex-wrap gap-1.5">
        {days.map((d) => (
          <label
            key={d.value}
            className="flex cursor-pointer select-none items-center gap-1.5 rounded-lg border border-slate-300
              bg-white px-2.5 py-1.5 text-sm text-slate-700 has-[:checked]:border-indigo-500
              has-[:checked]:bg-indigo-50 has-[:checked]:text-indigo-700"
          >
            <input
              type="checkbox"
              name="dates"
              value={d.value}
              data-weekend={d.isWeekend ? "1" : "0"}
              className="checkbox"
            />
            {d.label}
          </label>
        ))}
      </div>
      <div className="flex flex-wrap gap-3 text-xs">
        <button type="button" className="btn-link !text-xs" onClick={() => setAll(() => true)}>
          выбрать все дни
        </button>
        <button
          type="button"
          className="btn-link !text-xs"
          onClick={() => setAll((isWeekend) => !isWeekend)}
        >
          только будни
        </button>
        <button type="button" className="btn-link !text-xs" onClick={() => setAll(() => false)}>
          сбросить
        </button>
      </div>
    </div>
  );
}
