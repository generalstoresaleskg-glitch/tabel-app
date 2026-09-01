"use server";

import { randomUUID } from "crypto";
import { eq } from "drizzle-orm";
import { revalidatePath } from "next/cache";
import { db } from "@/db";
import { schedules, shifts, scheduleChangeLog, users, points } from "@/db/schema";
import { requireRole } from "@/lib/session";
import { weekDates, addDays } from "@/lib/dates";

async function logChange(
  scheduleId: string,
  shiftId: string | null,
  changedBy: string,
  description: string
) {
  await db.insert(scheduleChangeLog).values({
    id: randomUUID(),
    scheduleId,
    shiftId,
    changedBy,
    description,
  });
}

export async function createDraftForWeek(weekStart: string) {
  const me = await requireRole(["owner", "manager"]);

  const existingRows = await db
    .select()
    .from(schedules)
    .where(eq(schedules.weekStart, weekStart));
  if (existingRows[0]) return;

  await db.insert(schedules).values({
    id: randomUUID(),
    weekStart,
    status: "draft",
    createdBy: me.id,
  });

  revalidatePath("/schedule");
}

// Создаёт черновик на неделю и копирует в него все задачи из графика
// предыдущей недели (даты сдвигаются на +7 дней). Черновик проходит
// обычный цикл согласования заново.
export async function copyPreviousWeek(weekStart: string) {
  const me = await requireRole(["owner", "manager"]);

  const existingRows = await db
    .select()
    .from(schedules)
    .where(eq(schedules.weekStart, weekStart));
  if (existingRows[0]) return;

  const prevWeekStart = addDays(weekStart, -7);
  const prevScheduleRows = await db
    .select()
    .from(schedules)
    .where(eq(schedules.weekStart, prevWeekStart));
  const prevSchedule = prevScheduleRows[0];

  const newScheduleId = randomUUID();
  await db.insert(schedules).values({
    id: newScheduleId,
    weekStart,
    status: "draft",
    createdBy: me.id,
  });

  if (prevSchedule) {
    const prevShifts = await db
      .select()
      .from(shifts)
      .where(eq(shifts.scheduleId, prevSchedule.id));

    for (const s of prevShifts) {
      await db.insert(shifts).values({
        id: randomUUID(),
        scheduleId: newScheduleId,
        pointId: s.pointId,
        userId: s.userId,
        type: s.type,
        date: addDays(s.date, 7),
        plannedStart: s.plannedStart,
        plannedEnd: s.plannedEnd,
        note: s.note,
      });
    }
  }

  revalidatePath("/schedule");
}

export async function addShift(scheduleId: string, formData: FormData) {
  const me = await requireRole(["owner", "manager"]);

  const scheduleRows = await db
    .select()
    .from(schedules)
    .where(eq(schedules.id, scheduleId));
  const schedule = scheduleRows[0];
  if (!schedule) return;
  if (!["draft", "published"].includes(schedule.status)) return;

  const pointId = String(formData.get("pointId") ?? "");
  const userId = String(formData.get("userId") ?? "");
  const type = String(formData.get("type") ?? "SHIFT") as "SHIFT" | "VISIT";
  const selectedDates = formData.getAll("dates").map(String).filter(Boolean);
  const rawStart = String(formData.get("plannedStart") ?? "").trim();
  const rawEnd = String(formData.get("plannedEnd") ?? "").trim();
  const note = String(formData.get("note") ?? "").trim() || null;

  if (!pointId || !userId || selectedDates.length === 0) return;

  const validDates = new Set(weekDates(schedule.weekStart));
  const dates = selectedDates.filter((d) => validDates.has(d));
  if (dates.length === 0) return;

  // Владелец и управляющий тоже могут выйти как подмена — проверяем только,
  // что пользователь вообще существует и активен.
  const targetUserRows = await db.select().from(users).where(eq(users.id, userId));
  const targetUser = targetUserRows[0];
  if (!targetUser || !targetUser.active) return;

  const pointRows = await db.select().from(points).where(eq(points.id, pointId));
  const point = pointRows[0];
  if (!point) return;

  // Если время не указали вручную — берём стандартные часы работы точки,
  // чтобы не заполнять их каждый раз заново.
  const plannedStart = type === "SHIFT" ? rawStart || point.defaultOpenTime : null;
  const plannedEnd = type === "SHIFT" ? rawEnd || point.defaultCloseTime : null;

  for (const date of dates) {
    const shiftId = randomUUID();
    await db.insert(shifts).values({
      id: shiftId,
      scheduleId,
      pointId,
      userId,
      type,
      date,
      plannedStart: type === "SHIFT" ? plannedStart : null,
      plannedEnd: type === "SHIFT" ? plannedEnd : null,
      note: type === "VISIT" ? note : null,
    });

    if (schedule.status === "published") {
      await logChange(
        scheduleId,
        shiftId,
        me.id,
        `Добавлена ${type === "SHIFT" ? "смена" : "визит-задача"} на ${date}`
      );
    }
  }

  revalidatePath("/schedule");
}

export async function deleteShift(shiftId: string, scheduleId: string) {
  const me = await requireRole(["owner", "manager"]);

  const scheduleRows = await db
    .select()
    .from(schedules)
    .where(eq(schedules.id, scheduleId));
  const schedule = scheduleRows[0];
  if (!schedule) return;

  const shiftRows = await db.select().from(shifts).where(eq(shifts.id, shiftId));
  const shift = shiftRows[0];
  if (!shift) return;

  await db.delete(shifts).where(eq(shifts.id, shiftId));

  if (schedule.status === "published") {
    await logChange(
      scheduleId,
      null,
      me.id,
      `Удалена задача на ${shift.date} (точка/сотрудник изменены или отменены)`
    );
  }

  revalidatePath("/schedule");
}

// Владелец публикует свой черновик сразу; черновик управляющей сначала уходит
// владельцу на утверждение. Подтверждение сотрудниками не требуется —
// опубликованный график сразу виден всем. Раньше здесь была жёсткая проверка
// "обязательный сотрудник есть на каждой точке/дне" — теперь она не блокирует
// отправку: пустые точки просто остаются видны жёлтым предупреждением в
// сетке, отправлять/публиковать можно и с пробелами (график часто нужно
// собирать постепенно, и жёсткий запрет только мешал).
export async function submitForApproval(scheduleId: string) {
  const me = await requireRole(["owner", "manager"]);

  const scheduleRows = await db
    .select()
    .from(schedules)
    .where(eq(schedules.id, scheduleId));
  const schedule = scheduleRows[0];
  if (!schedule || schedule.status !== "draft") return;

  const nextStatus = me.role === "owner" ? "published" : "pending_owner";

  await db
    .update(schedules)
    .set({ status: nextStatus, updatedAt: new Date().toISOString() })
    .where(eq(schedules.id, scheduleId));

  revalidatePath("/schedule");
}

export async function ownerApprove(scheduleId: string) {
  await requireRole(["owner"]);

  const scheduleRows = await db
    .select()
    .from(schedules)
    .where(eq(schedules.id, scheduleId));
  const schedule = scheduleRows[0];
  if (!schedule || schedule.status !== "pending_owner") return;

  await db
    .update(schedules)
    .set({ status: "published", updatedAt: new Date().toISOString() })
    .where(eq(schedules.id, scheduleId));

  revalidatePath("/schedule");
}

export async function ownerReject(scheduleId: string, formData: FormData) {
  await requireRole(["owner"]);

  const scheduleRows = await db
    .select()
    .from(schedules)
    .where(eq(schedules.id, scheduleId));
  const schedule = scheduleRows[0];
  if (!schedule || schedule.status !== "pending_owner") return;

  const comment = String(formData.get("comment") ?? "");

  await db
    .update(schedules)
    .set({
      status: "draft",
      ownerComment: comment || null,
      updatedAt: new Date().toISOString(),
    })
    .where(eq(schedules.id, scheduleId));

  revalidatePath("/schedule");
}

