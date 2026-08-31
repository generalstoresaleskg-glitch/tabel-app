"use server";

import { randomUUID } from "crypto";
import bcrypt from "bcryptjs";
import { eq } from "drizzle-orm";
import { revalidatePath } from "next/cache";
import { db } from "@/db";
import { users } from "@/db/schema";
import { requireRole } from "@/lib/session";

type Role = "owner" | "manager" | "employee";

function hash(pw: string) {
  return bcrypt.hashSync(pw, 10);
}

export async function createEmployee(formData: FormData) {
  const me = await requireRole(["owner", "manager"]);

  const name = String(formData.get("name") ?? "").trim();
  const phone = String(formData.get("phone") ?? "").trim();
  const login = String(formData.get("login") ?? "").trim();
  const password = String(formData.get("password") ?? "");
  let role = String(formData.get("role") ?? "employee") as Role;

  if (!name || !login || !password) return;

  // Управляющая может создавать только рядовых сотрудников
  if (me.role === "manager") role = "employee";

  const existingRows = await db.select().from(users).where(eq(users.login, login));
  if (existingRows[0]) return; // логин уже занят

  await db.insert(users).values({
    id: randomUUID(),
    name,
    phone: phone || null,
    login,
    passwordHash: hash(password),
    role,
    active: true,
  });

  revalidatePath("/employees");
}

async function assertCanEditTarget(me: { role: Role }, targetId: string) {
  const targetRows = await db.select().from(users).where(eq(users.id, targetId));
  const target = targetRows[0];
  if (!target) return null;
  if (me.role === "owner") return target;
  // Управляющая не может редактировать владельца или других управляющих
  if (me.role === "manager" && target.role === "employee") return target;
  return null;
}

export async function updateEmployee(id: string, formData: FormData) {
  const me = await requireRole(["owner", "manager"]);
  const target = await assertCanEditTarget(me, id);
  if (!target) return;

  const name = String(formData.get("name") ?? "").trim();
  const phone = String(formData.get("phone") ?? "").trim();
  const login = String(formData.get("login") ?? "").trim();
  let role = String(formData.get("role") ?? target.role) as Role;
  if (!name || !login) return;

  // Только владелец может менять роль
  if (me.role !== "owner") role = target.role as Role;

  await db
    .update(users)
    .set({ name, phone: phone || null, login, role })
    .where(eq(users.id, id));

  revalidatePath("/employees");
}

export async function resetPassword(id: string, formData: FormData) {
  const me = await requireRole(["owner", "manager"]);
  const target = await assertCanEditTarget(me, id);
  if (!target) return;

  const password = String(formData.get("password") ?? "");
  if (!password || password.length < 4) return;

  await db.update(users).set({ passwordHash: hash(password) }).where(eq(users.id, id));
  revalidatePath("/employees");
}

export async function toggleEmployeeActive(id: string, nextActive: boolean) {
  const me = await requireRole(["owner", "manager"]);
  const target = await assertCanEditTarget(me, id);
  if (!target) return;

  await db.update(users).set({ active: nextActive }).where(eq(users.id, id));
  revalidatePath("/employees");
}
