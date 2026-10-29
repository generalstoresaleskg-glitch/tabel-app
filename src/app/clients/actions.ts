"use server";

import { eq } from "drizzle-orm";
import { revalidatePath } from "next/cache";
import { db } from "@/db";
import { clients } from "@/db/schema";
import { requireRole } from "@/lib/session";
import { parseClientMessage } from "@/lib/client-parse";
import { saveClient } from "@/lib/clients";

export type AddClientState = { ok: boolean; message: string } | null;

export async function addClient(_prev: AddClientState, formData: FormData): Promise<AddClientState> {
  const me = await requireRole(["owner", "manager"]);
  const name = String(formData.get("name") ?? "").trim();
  const phone = String(formData.get("phone") ?? "").trim();
  const birthday = String(formData.get("birthday") ?? "").trim();

  // Тот же разбор, что и для сообщений из чата — одни правила для всех.
  const parsed = parseClientMessage(`/клиент ${name} ${phone} ${birthday}`);
  if (!parsed.ok) return { ok: false, message: "Не сохранено: " + parsed.errors.join("; ") };

  const r = await saveClient(parsed.client, { source: "manual", addedByUserId: me.id, addedByName: me.name ?? null });
  revalidatePath("/clients");
  return {
    ok: true,
    message: r.status === "created" ? `Добавлен: ${parsed.client.name}` : `Обновлён: ${parsed.client.name} (номер уже был в базе)`,
  };
}

export async function deleteClient(id: string) {
  await requireRole(["owner", "manager"]);
  await db.delete(clients).where(eq(clients.id, id));
  revalidatePath("/clients");
}
