// Утилиты для работы с неделями/датами в формате YYYY-MM-DD

// Все точки работают по времени Бишкека (UTC+6, без перехода на летнее) —
// сервер (Vercel) по умолчанию считает время в UTC, поэтому часовой пояс
// нигде нельзя оставлять "по умолчанию": иначе "сегодня", время в
// уведомлениях и расчёт опозданий/переработок съезжают на 6 часов.
const BISHKEK_TZ = "Asia/Bishkek";
const BISHKEK_OFFSET_MINUTES = 6 * 60;

export function toISODate(d: Date): string {
  return d.toISOString().slice(0, 10);
}

// Понедельник недели, которой принадлежит дата
export function mondayOf(dateStr: string): string {
  const d = new Date(dateStr + "T00:00:00");
  const day = d.getDay(); // 0=вс,1=пн,...
  const diff = day === 0 ? -6 : 1 - day;
  d.setDate(d.getDate() + diff);
  return toISODate(d);
}

export function addDays(dateStr: string, days: number): string {
  const d = new Date(dateStr + "T00:00:00");
  d.setDate(d.getDate() + days);
  return toISODate(d);
}

export function weekDates(weekStart: string): string[] {
  return Array.from({ length: 7 }, (_, i) => addDays(weekStart, i));
}

const WEEKDAY_NAMES = ["Пн", "Вт", "Ср", "Чт", "Пт", "Сб", "Вс"];
const WEEKDAY_FULL = [
  "Понедельник",
  "Вторник",
  "Среда",
  "Четверг",
  "Пятница",
  "Суббота",
  "Воскресенье",
];

export function weekdayShort(dateStr: string): string {
  const d = new Date(dateStr + "T00:00:00");
  const day = d.getDay();
  return WEEKDAY_NAMES[day === 0 ? 6 : day - 1];
}

export function weekdayFull(dateStr: string): string {
  const d = new Date(dateStr + "T00:00:00");
  const day = d.getDay();
  return WEEKDAY_FULL[day === 0 ? 6 : day - 1];
}

export function formatDateHuman(dateStr: string): string {
  const d = new Date(dateStr + "T00:00:00");
  return d.toLocaleDateString("ru-RU", { day: "2-digit", month: "2-digit" });
}

// "Сегодня" — по календарной дате в Бишкеке, а не по UTC-дате сервера
// (иначе первые 6 часов каждых суток по Бишкеку "сегодня" показывало бы
// вчерашний день).
export function todayISO(): string {
  return new Date(Date.now() + BISHKEK_OFFSET_MINUTES * 60000).toISOString().slice(0, 10);
}

export function nowISO(): string {
  return new Date().toISOString();
}

// Сравнение факт. времени HH:MM (из ISO datetime) с плановым HH:MM — оба в
// часовом поясе Бишкека, независимо от того, в каком часовом поясе сейчас
// исполняется сам код сервера.
export function minutesDiff(plannedHHMM: string, actualISO: string): number {
  const actual = new Date(actualISO);
  const actualBishkekMs = actual.getTime() + BISHKEK_OFFSET_MINUTES * 60000;
  const [h, m] = plannedHHMM.split(":").map(Number);
  const plannedBishkek = new Date(actualBishkekMs);
  plannedBishkek.setUTCHours(h, m, 0, 0);
  return Math.round((actualBishkekMs - plannedBishkek.getTime()) / 60000);
}

export function currentMonthStr(): string {
  const d = new Date(Date.now() + BISHKEK_OFFSET_MINUTES * 60000);
  return `${d.getUTCFullYear()}-${String(d.getUTCMonth() + 1).padStart(2, "0")}`;
}

export function shiftMonth(monthStr: string, delta: number): string {
  const [y, m] = monthStr.split("-").map(Number);
  const d = new Date(y, m - 1 + delta, 1);
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}`;
}

export function monthRange(monthStr: string): { start: string; end: string } {
  const [y, m] = monthStr.split("-").map(Number);
  const start = `${monthStr}-01`;
  const lastDay = new Date(y, m, 0).getDate();
  const end = `${monthStr}-${String(lastDay).padStart(2, "0")}`;
  return { start, end };
}

export function monthLabel(monthStr: string): string {
  const [y, m] = monthStr.split("-").map(Number);
  const d = new Date(y, m - 1, 1);
  return d.toLocaleDateString("ru-RU", { month: "long", year: "numeric" });
}

export function formatTimeHHMM(iso: string): string {
  const d = new Date(iso);
  return d.toLocaleTimeString("ru-RU", {
    hour: "2-digit",
    minute: "2-digit",
    timeZone: BISHKEK_TZ,
  });
}
