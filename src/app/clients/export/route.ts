// Выгрузка клиентов в CSV для рассылок (открывается в Excel / Google Таблицах).
import { desc, eq } from "drizzle-orm";
import { auth } from "@/auth";
import { db } from "@/db";
import { clients, users } from "@/db/schema";
import { todayISO } from "@/lib/dates";
import { formatBirthday, formatPhone } from "@/lib/client-parse";

export const dynamic = "force-dynamic";

export async function GET() {
  const session = await auth();
  const role = session?.user?.role;
  if (role !== "owner" && role !== "manager") return new Response("Нет доступа", { status: 403 });

  const rows = await db
    .select({ c: clients, userName: users.name })
    .from(clients)
    .leftJoin(users, eq(clients.addedByUserId, users.id))
    .orderBy(desc(clients.createdAt));

  const header = ["ФИО", "Телефон", "Дата рождения", "Кто добавил", "Откуда", "Добавлен"];
  const body = rows.map(({ c, userName }) => [
    c.name,
    formatPhone(c.phone),
    formatBirthday(c.birthDay, c.birthMonth, c.birthYear),
    userName ?? c.addedByName ?? "",
    c.source === "manual" ? "вручную" : "чат WhatsApp",
    c.createdAt.slice(0, 10),
  ]);

  // «;» и BOM — чтобы Excel на Windows сразу открыл кириллицу по колонкам.
  const csv = [header, ...body]
    .map((row) => row.map((cell) => `"${String(cell).replace(/"/g, '""')}"`).join(";"))
    .join("\r\n");

  return new Response("﻿" + csv, {
    headers: {
      "Content-Type": "text/csv; charset=utf-8",
      "Content-Disposition": `attachment; filename="clients-${todayISO()}.csv"`,
    },
  });
}
