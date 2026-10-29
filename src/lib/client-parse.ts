// Разбор сообщения «/клиент ФИО телефон дата рождения» из общего чата WhatsApp.
// Чистые функции без базы — их же использует форма ручного добавления.
//
// Сотрудники пишут как удобно, поэтому разбор терпимый:
//   /клиент Иванова Айгуль 0555 123 456 12.03.1995
//   \клиент Иванова Айгуль, +996 (555) 12-34-56, 12.03.95
//   /Клиент: ФИО: Иванова Айгуль / Тел: 555123456 / ДР: 12 марта
// Порядок частей не важен, год рождения можно не писать.

export type ParsedClient = {
  name: string;
  phone: string; // +996555123456
  day: number;
  month: number;
  year: number | null;
};

export type ParseResult = { ok: true; client: ParsedClient } | { ok: false; errors: string[] };

const COMMAND_RE = /^\s*[\/\\]\s*клиент(?![а-яё])\s*[:\-–—]?\s*/i;

export function isClientCommand(text: string): boolean {
  return COMMAND_RE.test(text);
}

const MONTHS: Record<string, number> = {
  январ: 1, феврал: 2, март: 3, апрел: 4, ма: 5, июн: 6,
  июл: 7, август: 8, сентябр: 9, октябр: 10, ноябр: 11, декабр: 12,
};
const MONTH_ALT = "январ[ья]|феврал[ья]|марта?|апрел[ья]|ма[йя]|июн[ья]|июл[ья]|августа?|сентябр[ья]|октябр[ья]|ноябр[ья]|декабр[ья]";

function monthFromWord(w: string): number | null {
  const lw = w.toLowerCase();
  // «ма» — общий корень у «мая/май»; проверяем его последним, чтобы «марта» не попал сюда.
  for (const [stem, m] of Object.entries(MONTHS)) {
    if (stem !== "ма" && lw.startsWith(stem)) return m;
  }
  return lw === "мая" || lw === "май" ? 5 : null;
}

// Номер в любом виде → +996XXXXXXXXX (или другой код страны, если начинается с +).
export function normalizePhone(raw: string): string | null {
  const plus = raw.trim().startsWith("+");
  const d = raw.replace(/\D/g, "");
  if (!plus) {
    if (d.length === 9) return "+996" + d; // 555123456
    if (d.length === 10 && d.startsWith("0")) return "+996" + d.slice(1); // 0555123456
    if (d.length === 12 && d.startsWith("996")) return "+" + d; // 996555123456
    return null;
  }
  if (d.startsWith("996")) return d.length === 12 ? "+" + d : null;
  return d.length >= 10 && d.length <= 15 ? "+" + d : null;
}

export function formatPhone(p: string): string {
  const m = /^\+996(\d{3})(\d{3})(\d{3})$/.exec(p);
  return m ? `+996 ${m[1]} ${m[2]} ${m[3]}` : p;
}

export function formatBirthday(day: number, month: number, year: number | null): string {
  const dd = String(day).padStart(2, "0");
  const mm = String(month).padStart(2, "0");
  return year ? `${dd}.${mm}.${year}` : `${dd}.${mm}`;
}

function validDate(day: number, month: number, year: number | null, currentYear: number): boolean {
  if (month < 1 || month > 12 || day < 1) return false;
  const maxDay = new Date(Date.UTC(year ?? 2000, month, 0)).getUTCDate(); // 2000 — високосный, 29.02 допустимо
  if (day > maxDay) return false;
  if (year !== null && (year < 1900 || year > currentYear)) return false;
  return true;
}

function cleanName(s: string): string {
  return s
    // \b в JS не работает с кириллицей — границы слова задаём явно.
    .replace(/(?<![а-яёөүңa-z])(ф\.и\.о\.?|фио|имя|телефон|тел|номер|дата рождения|день рождения|дата|д\.р\.?|др)(?![а-яёөүңa-z])\s*[:.\-]?/giu, " ")
    .replace(/[,;:/|•\-–—]+/g, " ")
    .replace(/\s+/g, " ")
    .trim()
    .split(" ")
    .map((w) => (w ? w[0].toLocaleUpperCase("ru") + w.slice(1).toLocaleLowerCase("ru") : w))
    .join(" ");
}

export function parseClientMessage(text: string, currentYear = new Date().getFullYear()): ParseResult {
  const errors: string[] = [];
  let rest = text.replace(COMMAND_RE, " ").replace(/\s+/g, " ");

  // 1. Дата: 12.03.1995 / 12-03-95 / 1/2/2001 / 12.03 / «12 марта 1995».
  // Номер вида «0700 12-34-56» тоже похож на дату, поэтому собираем всех
  // кандидатов и берём самый правдоподобный: настоящая дата, лучше с точкой
  // или «/» и с четырёхзначным годом.
  type Cand = { index: number; raw: string; day: number; month: number; year: number | null; valid: boolean; score: number };
  const cands: Cand[] = [];
  const toYear = (y?: string) => {
    if (!y) return null;
    const n = Number(y);
    return y.length === 2 ? n + (n > currentYear % 100 ? 1900 : 2000) : n;
  };
  for (const x of rest.matchAll(/(?<!\d)(\d{1,2})([.\-/])(\d{1,2})(?:[.\-/](\d{4}|\d{2}))?(?![\d.\-/]*\d)/g)) {
    const [d, mo, y] = [Number(x[1]), Number(x[3]), toYear(x[4])];
    const valid = validDate(d, mo, y, currentYear);
    cands.push({ index: x.index!, raw: x[0], day: d, month: mo, year: y, valid,
      score: (valid ? 10 : 0) + (x[2] !== "-" ? 2 : 0) + (x[4]?.length === 4 ? 1 : 0) });
  }
  for (const x of rest.matchAll(new RegExp(`(?<!\\d)(\\d{1,2})\\s+(${MONTH_ALT})(?:\\s+(\\d{4}))?(?:\\s*г\\.?)?`, "gi"))) {
    const [d, mo, y] = [Number(x[1]), monthFromWord(x[2])!, toYear(x[3])];
    const valid = validDate(d, mo, y, currentYear);
    cands.push({ index: x.index!, raw: x[0], day: d, month: mo, year: y, valid, score: (valid ? 10 : 0) + 3 });
  }
  cands.sort((a, b) => b.score - a.score || a.index - b.index);
  const best = cands[0];
  let day = 0, month = 0, year: number | null = null;
  const dateFound = !!best;
  if (best) {
    ({ day, month, year } = best);
    rest = rest.slice(0, best.index) + " " + rest.slice(best.index + best.raw.length);
    if (!best.valid) errors.push(`дата рождения указана неверно («${best.raw.trim()}»)`);
  } else {
    errors.push("не нашёл дату рождения (например 12.03.1995)");
  }

  // 2. Телефон.
  let phone: string | null = null;
  const phoneRe = /\+?\d[\d\s\-()]{6,}\d/g;
  let pm: RegExpExecArray | null;
  while ((pm = phoneRe.exec(rest))) {
    const candidate = normalizePhone(pm[0]);
    if (candidate) {
      phone = candidate;
      rest = rest.slice(0, pm.index) + " " + rest.slice(pm.index + pm[0].length);
      break;
    }
  }
  if (!phone) {
    errors.push(
      /\d{5,}/.test(rest.replace(/[\s\-()]/g, ""))
        ? "номер телефона указан неверно (например 0555 123 456 или +996 555 123 456)"
        : "не нашёл номер телефона"
    );
  }

  // 3. Всё остальное — ФИО.
  const name = cleanName(rest);
  if (!/[a-zа-яёөүң]/i.test(name)) errors.push("не нашёл ФИО");
  else if (/\d/.test(name)) errors.push(`в ФИО остались цифры («${name}») — проверьте номер и дату`);

  if (errors.length || !dateFound) return { ok: false, errors };
  return { ok: true, client: { name, phone: phone!, day, month, year } };
}

export const CLIENT_FORMAT_HINT =
  "Формат: /клиент ФИО телефон дата рождения\nНапример: /клиент Иванова Айгуль 0555 123 456 12.03.1995";
