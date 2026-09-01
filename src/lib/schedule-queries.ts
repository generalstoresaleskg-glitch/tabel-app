import { eq, and, gte, lte } from "drizzle-orm";
import { db } from "@/db";
import { schedules, shifts, points, users, attendance } from "@/db/schema";
import { weekDates } from "@/lib/dates";

export async function getScheduleByWeek(weekStart: string) {
  const rows = await db
    .select()
    .from(schedules)
    .where(eq(schedules.weekStart, weekStart));
  return rows[0];
}

export async function getScheduleById(id: string) {
  const rows = await db.select().from(schedules).where(eq(schedules.id, id));
  return rows[0];
}

export type ShiftRow = {
  shift: typeof shifts.$inferSelect;
  point: typeof points.$inferSelect | null;
  user: typeof users.$inferSelect | null;
  attendance: typeof attendance.$inferSelect | null;
};

export async function getShiftsWithDetails(
  scheduleId: string
): Promise<ShiftRow[]> {
  return db
    .select({
      shift: shifts,
      point: points,
      user: users,
      attendance: attendance,
    })
    .from(shifts)
    .leftJoin(points, eq(shifts.pointId, points.id))
    .leftJoin(users, eq(shifts.userId, users.id))
    .leftJoin(attendance, eq(attendance.shiftId, shifts.id))
    .where(eq(shifts.scheduleId, scheduleId));
}

export async function getShiftsInRange(
  startDate: string,
  endDate: string
): Promise<ShiftRow[]> {
  return db
    .select({
      shift: shifts,
      point: points,
      user: users,
      attendance: attendance,
    })
    .from(shifts)
    .innerJoin(schedules, eq(shifts.scheduleId, schedules.id))
    .leftJoin(points, eq(shifts.pointId, points.id))
    .leftJoin(users, eq(shifts.userId, users.id))
    .leftJoin(attendance, eq(attendance.shiftId, shifts.id))
    .where(
      and(
        eq(schedules.status, "published"),
        gte(shifts.date, startDate),
        lte(shifts.date, endDate)
      )
    );
}

export async function getAllActivePoints() {
  return db.select().from(points).where(eq(points.active, true));
}

export async function getAllActiveUsers() {
  return db.select().from(users).where(eq(users.active, true));
}

// Все активные пользователи, которых можно назначить на смену/визит —
// владелец и управляющий тоже могут выйти как подмена, поэтому больше не
// исключаем их из списка.
export async function getAssignableUsers() {
  return db.select().from(users).where(eq(users.active, true));
}

// Для каждой активной точки и каждого дня недели графика проверяем, есть ли
// хотя бы одна обязательная смена (SHIFT). VISIT в счёт не идёт. Возвращает
// набор ключей "pointId_date", которых не хватает — по нему в сетке рисуется
// предупреждение, а submitForApproval/ownerApprove блокируют отправку.
export async function getMissingShiftSlots(scheduleId: string, weekStart: string) {
  const activePoints = await getAllActivePoints();
  const dates = weekDates(weekStart);

  const shiftRows = await db
    .select({ pointId: shifts.pointId, date: shifts.date, type: shifts.type })
    .from(shifts)
    .where(eq(shifts.scheduleId, scheduleId));

  const covered = new Set(
    shiftRows.filter((s) => s.type === "SHIFT").map((s) => `${s.pointId}_${s.date}`)
  );

  const missing = new Set<string>();
  for (const p of activePoints) {
    for (const d of dates) {
      const key = `${p.id}_${d}`;
      if (!covered.has(key)) missing.add(key);
    }
  }
  return missing;
}

// Недели, черновик которых ждёт утверждения владельца — чтобы показать
// напоминание владельцу независимо от того, на какую неделю сейчас открыт график.
export async function getWeeksAwaitingOwnerApproval() {
  const rows = await db
    .select({ weekStart: schedules.weekStart })
    .from(schedules)
    .where(eq(schedules.status, "pending_owner"));
  return [...new Set(rows.map((r) => r.weekStart))].sort();
}
