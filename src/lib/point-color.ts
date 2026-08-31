// Стабильный цвет для точки (филиала) — чтобы в графике сразу было видно,
// какая смена к какой точке относится, без чтения мелкого текста.

const PALETTE = [
  { badge: "bg-indigo-50 text-indigo-700 ring-1 ring-inset ring-indigo-200", dot: "bg-indigo-500" },
  { badge: "bg-emerald-50 text-emerald-700 ring-1 ring-inset ring-emerald-200", dot: "bg-emerald-500" },
  { badge: "bg-amber-50 text-amber-800 ring-1 ring-inset ring-amber-200", dot: "bg-amber-500" },
  { badge: "bg-rose-50 text-rose-700 ring-1 ring-inset ring-rose-200", dot: "bg-rose-500" },
  { badge: "bg-sky-50 text-sky-700 ring-1 ring-inset ring-sky-200", dot: "bg-sky-500" },
  { badge: "bg-violet-50 text-violet-700 ring-1 ring-inset ring-violet-200", dot: "bg-violet-500" },
  { badge: "bg-teal-50 text-teal-700 ring-1 ring-inset ring-teal-200", dot: "bg-teal-500" },
];

function hashStr(s: string): number {
  let h = 0;
  for (let i = 0; i < s.length; i++) {
    h = (h * 31 + s.charCodeAt(i)) >>> 0;
  }
  return h;
}

export function pointColor(pointId: string) {
  return PALETTE[hashStr(pointId) % PALETTE.length];
}
