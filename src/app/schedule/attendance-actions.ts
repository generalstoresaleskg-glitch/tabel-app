"use server";

import { randomUUID } from "crypto";
import { eq } from "drizzle-orm";
import { revalidatePath } from "next/cache";
import { db } from "@/db";
import { shifts, attendance, points, users, schedules } from "@/db/schema";
import { requireUser } from "@/lib/session";
import { nowISO, minutesDiff, formatTimeHHMM } from "@/lib/dates";
import { notifyWhatsApp } from "@/lib/notify";

async function getShiftContext(shiftId: string) {
  const shiftRows = await db.select().from(shifts).where(eq(shifts.id, shiftId));
  const shift = shiftRows[0];
  if (!shift) return null;
  const scheduleRows = await db
    .select()
    .from(schedules)
    .where(eq(schedules.id, shift.scheduleId));
  const schedule = scheduleRows[0];
  if (!schedule || schedule.status !== "published") return null;
  const pointRows = await db.select().from(points).where(eq(points.id, shift.pointId));
  const userRows = await db.select().from(users).where(eq(users.id, shift.userId));
  const attRows = await db
    .select()
    .from(attendance)
    .where(eq(attendance.shiftId, shiftId));
  return { shift, point: pointRows[0], user: userRows[0], att: attRows[0] };
}

export async function checkIn(shiftId: string) {
  const me = await requireUser();
  const ctx = await getShiftContext(shiftId);
  if (!ctx || ctx.shift.userId !== me.id || ctx.shift.type !== "SHIFT") return;
  if (ctx.att?.checkinAt) return;

  const now = nowISO();
  let status: "on_time" | "late" = "on_time";
  let lateMinutes = 0;
  if (ctx.shift.plannedStart) {
    const diff = minutesDiff(ctx.shift.plannedStart, now);
    if (diff > 5) {
      status = "late";
      lateMinutes = diff;
    }
  }

  if (ctx.att) {
    await db
      .update(attendance)
      .set({ checkinAt: now, checkinStatus: status, checkinLateMinutes: lateMinutes })
      .where(eq(attendance.shiftId, shiftId));
  } else {
    await db.insert(attendance).values({
      id: randomUUID(),
      shiftId,
      checkinAt: now,
      checkinStatus: status,
      checkinLateMinutes: lateMinutes,
    });
  }

  const lateNote = status === "late" ? ` (опоздание ${lateMinutes} мин.)` : "";
  await notifyWhatsApp(
    `${ctx.user?.name} вышел(ла) на работу — ${ctx.point?.name}, ${formatTimeHHMM(now)}${lateNote}`
  );

  revalidatePath("/schedule");
  revalidatePath("/tabel");
}

export async function checkOut(shiftId: string) {
  const me = await requireUser();
  const ctx = await getShiftContext(shiftId);
  if (!ctx || ctx.shift.userId !== me.id || ctx.shift.type !== "SHIFT") return;
  if (!ctx.att?.checkinAt || ctx.att.checkoutAt) return;

  const now = nowISO();
  let status: "on_time" | "early" | "overtime" = "on_time";
  if (ctx.shift.plannedEnd) {
    const diff = minutesDiff(ctx.shift.plannedEnd, now);
    if (diff < -5) status = "early";
    else if (diff > 5) status = "overtime";
  }

  await db
    .update(attendance)
    .set({ checkoutAt: now, checkoutStatus: status })
    .where(eq(attendance.shiftId, shiftId));

  await notifyWhatsApp(
    `${ctx.user?.name} ушёл(ла) с работы — ${ctx.point?.name}, ${formatTimeHHMM(now)}`
  );

  revalidatePath("/schedule");
  revalidatePath("/tabel");
}

export async function markVisit(shiftId: string) {
  const me = await requireUser();
  const ctx = await getShiftContext(shiftId);
  if (!ctx || ctx.shift.userId !== me.id || ctx.shift.type !== "VISIT") return;
  if (ctx.att?.checkinAt) return;

  const now = nowISO();
  if (ctx.att) {
    await db.update(attendance).set({ checkinAt: now }).where(eq(attendance.shiftId, shiftId));
  } else {
    await db.insert(attendance).values({ id: randomUUID(), shiftId, checkinAt: now });
  }

  await notifyWhatsApp(
    `${ctx.user?.name} посетил(а) ${ctx.point?.name}${
      ctx.shift.note ? " — " + ctx.shift.note : ""
    }, ${formatTimeHHMM(now)}`
  );

  revalidatePath("/schedule");
  revalidatePath("/tabel");
}
