import { eq, and, gte, lte } from "drizzle-orm";
import { db } from "@/db";
import { schedules, shifts, points, users, attendance } from "@/db/schema";

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

// Владелец не работает по графику и не может быть назначен на смену/визит-задачу
export async function getAssignableUsers() {
  const all = await db.select().from(users).where(eq(users.active, true));
  return all.filter((u) => u.role !== "owner");
}

// Недели, где у сотрудника есть неподтверждённые задачи — чтобы показать
// напоминание независимо от того, на какую неделю сейчас открыт график
// (иначе легко пропустить, если по умолчанию открывается текущая неделя).
export async function getWeeksNeedingMyConfirmation(userId: string) {
  const rows = await db
    .select({ weekStart: schedules.weekStart })
    .from(shifts)
    .innerJoin(schedules, eq(shifts.scheduleId, schedules.id))
    .where(
      and(
        eq(schedules.status, "pending_employee"),
        eq(shifts.userId, userId),
        eq(shifts.employeeAck, "pending")
      )
    );
  return [...new Set(rows.map((r) => r.weekStart))].sort();
}

// Недели, черновик которых ждёт утверждения владельца.
export async function getWeeksAwaitingOwnerApproval() {
  const rows = await db
    .select({ weekStart: schedules.weekStart })
    .from(schedules)
    .where(eq(schedules.status, "pending_owner"));
  return [...new Set(rows.map((r) => r.weekStart))].sort();
}
