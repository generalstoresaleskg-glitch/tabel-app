"use server";

import { randomUUID } from "crypto";
import { eq } from "drizzle-orm";
import { revalidatePath } from "next/cache";
import { db } from "@/db";
import { points, shifts } from "@/db/schema";
import { requireRole } from "@/lib/session";

export async function createPoint(formData: FormData) {
  await requireRole(["owner"]);

  const name = String(formData.get("name") ?? "").trim();
  const address = String(formData.get("address") ?? "").trim();
  const defaultOpenTime = String(formData.get("defaultOpenTime") ?? "09:00");
  const defaultCloseTime = String(formData.get("defaultCloseTime") ?? "19:00");
  if (!name) return;

  await db.insert(points).values({
    id: randomUUID(),
    name,
    address: address || null,
    defaultOpenTime,
    defaultCloseTime,
    active: true,
  });

  revalidatePath("/points");
}

export async function updatePoint(id: string, formData: FormData) {
  await requireRole(["owner"]);

  const name = String(formData.get("name") ?? "").trim();
  const address = String(formData.get("address") ?? "").trim();
  const defaultOpenTime = String(formData.get("defaultOpenTime") ?? "");
  const defaultCloseTime = String(formData.get("defaultCloseTime") ?? "");
  if (!name || !defaultOpenTime || !defaultCloseTime) return;

  await db
    .update(points)
    .set({ name, address: address || null, defaultOpenTime, defaultCloseTime })
    .where(eq(points.id, id));

  revalidatePath("/points");
}

export async function togglePointActive(id: string, nextActive: boolean) {
  await requireRole(["owner"]);
  await db.update(points).set({ active: nextActive }).where(eq(points.id, id));
  revalidatePath("/points");
}

export async function deletePoint(id: string) {
  await requireRole(["owner"]);

  const usedInShiftsRows = await db
    .select({ id: shifts.id })
    .from(shifts)
    .where(eq(shifts.pointId, id));

  if (usedInShiftsRows[0]) {
    // По этой точке уже есть смены в графике — удалять нельзя, чтобы не сломать
    // историю, поэтому просто деактивируем.
    await db.update(points).set({ active: false }).where(eq(points.id, id));
  } else {
    await db.delete(points).where(eq(points.id, id));
  }

  revalidatePath("/points");
}
