import { randomUUID, timingSafeEqual } from "crypto";
import { and, eq, sql } from "drizzle-orm";
import { db } from "@/db";
import { clients, users } from "@/db/schema";
import { todayISO } from "@/lib/dates";
import { type ParsedClient, formatBirthday, formatPhone, normalizePhone } from "@/lib/client-parse";

// Запросы от WhatsApp-бота подписаны тем же секретом, которым приложение само
// ходит в бота (WHATSAPP_BOT_TOKEN на Vercel = BOT_TOKEN на Render).
export function isBotRequest(request: Request): boolean {
  const expected = process.env.WHATSAPP_BOT_TOKEN;
  if (!expected) return false;
  const header = request.headers.get("authorization") ?? "";
  const got = header.startsWith("Bearer ") ? header.slice(7) : "";
  const a = Buffer.from(got);
  const b = Buffer.from(expected);
  return a.length === b.length && timingSafeEqual(a, b);
}

// Сотрудник по номеру WhatsApp (в «Сотрудниках» номер может быть записан как угодно).
export async function findUserByPhone(rawPhone: string) {
  const target = normalizePhone(rawPhone) ?? normalizePhone("+" + rawPhone.replace(/\D/g, ""));
  if (!target) return null;
  const all = await db.select({ id: users.id, name: users.name, phone: users.phone }).from(users);
  return all.find((u) => u.phone && normalizePhone(u.phone) === target) ?? null;
}

export async function saveClient(
  c: ParsedClient,
  by: { source: "whatsapp" | "manual"; addedByUserId: string | null; addedByName: string | null }
): Promise<{ status: "created" | "updated"; id: string }> {
  const existing = await db.select({ id: clients.id }).from(clients).where(eq(clients.phone, c.phone));
  if (existing[0]) {
    await db
      .update(clients)
      .set({ name: c.name, birthDay: c.day, birthMonth: c.month, birthYear: c.year, updatedAt: new Date().toISOString() })
      .where(eq(clients.id, existing[0].id));
    return { status: "updated", id: existing[0].id };
  }
  const id = randomUUID();
  await db.insert(clients).values({
    id,
    name: c.name,
    phone: c.phone,
    birthDay: c.day,
    birthMonth: c.month,
    birthYear: c.year,
    source: by.source,
    addedByUserId: by.addedByUserId,
    addedByName: by.addedByName,
  });
  return { status: "created", id };
}

// Сегодня ли (по Бишкеку) день рождения — с той же поправкой на 29.02.
export function isBirthdayToday(c: { day: number; month: number }, dateISO = todayISO()): boolean {
  const [y, m, d] = dateISO.split("-").map(Number);
  if (c.month === m && c.day === d) return true;
  const isLeap = (y % 4 === 0 && y % 100 !== 0) || y % 400 === 0;
  return !isLeap && m === 2 && d === 28 && c.month === 2 && c.day === 29;
}

export function clientSummary(c: ParsedClient): string {
  return `${c.name}, ${formatPhone(c.phone)}, ДР ${formatBirthday(c.day, c.month, c.year)}`;
}

// Именинники на дату (по Бишкеку). Родившиеся 29.02 в невисокосный год
// поздравляются 28.02.
export async function birthdaysOn(dateISO = todayISO()) {
  const [y, m, d] = dateISO.split("-").map(Number);
  const isLeap = (y % 4 === 0 && y % 100 !== 0) || y % 400 === 0;
  const feb28NonLeap = !isLeap && m === 2 && d === 28;
  const rows = await db
    .select()
    .from(clients)
    .where(
      feb28NonLeap
        ? and(eq(clients.birthMonth, 2), sql`${clients.birthDay} in (28, 29)`)
        : and(eq(clients.birthMonth, m), eq(clients.birthDay, d))
    )
    .orderBy(clients.name);
  return rows.map((r) => ({ ...r, turns: r.birthYear ? y - r.birthYear : null }));
}

// Текст поздравительного напоминания в общий чат:
//   🎂 Сегодня день рождения!
//   ФИО: Иванова Айгуль
//   Телефон: +996 700 123 456
//   Исполняется: 31
export function birthdayMessage(list: { name: string; phone: string; turns: number | null }[]): string | null {
  if (!list.length) return null;
  const blocks = list.map(
    (c) => `ФИО: ${c.name}\nТелефон: ${formatPhone(c.phone)}${c.turns ? `\nИсполняется: ${c.turns}` : ""}`
  );
  return `🎂 Сегодня день рождения!\n\n${blocks.join("\n\n")}\n\nНе забудьте поздравить!`;
}
