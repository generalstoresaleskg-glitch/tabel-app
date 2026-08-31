"use server";

import { randomUUID } from "crypto";
import { and, eq, ne } from "drizzle-orm";
import { revalidatePath } from "next/cache";
import { db } from "@/db";
import { schedules, shifts, scheduleChangeLog, users } from "@/db/schema";
import { requireRole, requireUser } from "@/lib/session";
import { weekDates } from "@/lib/dates";

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
  const plannedStart = String(formData.get("plannedStart") ?? "") || null;
  const detail = String(formData.get("detail") ?? "").trim() || null;
  const plannedEnd = type === "SHIFT" ? detail : null;
  const note = type === "VISIT" ? detail : null;

  if (!pointId || !userId || selectedDates.length === 0) return;

  const validDates = new Set(weekDates(schedule.weekStart));
  const dates = selectedDates.filter((d) => validDates.has(d));
  if (dates.length === 0) return;

  // Владелец не работает по графику — на всякий случай проверяем и на сервере,
  // а не только скрываем в выпадающем списке.
  const targetUserRows = await db.select().from(users).where(eq(users.id, userId));
  const targetUser = targetUserRows[0];
  if (!targetUser || targetUser.role === "owner") return;

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
      employeeAck: "pending",
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

export async function submitForApproval(scheduleId: string) {
  const me = await requireRole(["owner", "manager"]);

  const scheduleRows = await db
    .select()
    .from(schedules)
    .where(eq(schedules.id, scheduleId));
  const schedule = scheduleRows[0];
  if (!schedule || schedule.status !== "draft") return;

  const nextStatus = me.role === "owner" ? "pending_employee" : "pending_owner";

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
    .set({ status: "pending_employee", updatedAt: new Date().toISOString() })
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

async function maybeAutoPublish(scheduleId: string) {
  const remaining = await db
    .select()
    .from(shifts)
    .where(and(eq(shifts.scheduleId, scheduleId), ne(shifts.employeeAck, "confirmed")));

  if (remaining.length === 0) {
    await db
      .update(schedules)
      .set({ status: "published", updatedAt: new Date().toISOString() })
      .where(eq(schedules.id, scheduleId));
  }
}

export async function employeeAck(
  shiftId: string,
  scheduleId: string,
  decision: "confirmed" | "question",
  formData: FormData
) {
  const me = await requireUser();

  const shiftRows = await db.select().from(shifts).where(eq(shifts.id, shiftId));
  const shift = shiftRows[0];
  if (!shift || shift.userId !== me.id) return;

  const scheduleRows = await db
    .select()
    .from(schedules)
    .where(eq(schedules.id, scheduleId));
  const schedule = scheduleRows[0];
  if (!schedule || schedule.status !== "pending_employee") return;

  const comment = String(formData.get("comment") ?? "");

  await db
    .update(shifts)
    .set({
      employeeAck: decision,
      employeeComment: decision === "question" ? comment || null : null,
    })
    .where(eq(shifts.id, shiftId));

  if (decision === "confirmed") {
    await maybeAutoPublish(scheduleId);
  }

  revalidatePath("/schedule");
}

export async function publishAnyway(scheduleId: string) {
  await requireRole(["owner", "manager"]);

  const scheduleRows = await db
    .select()
    .from(schedules)
    .where(eq(schedules.id, scheduleId));
  const schedule = scheduleRows[0];
  if (!schedule || schedule.status !== "pending_employee") return;

  await db
    .update(schedules)
    .set({ status: "published", updatedAt: new Date().toISOString() })
    .where(eq(schedules.id, scheduleId));

  revalidatePath("/schedule");
}
