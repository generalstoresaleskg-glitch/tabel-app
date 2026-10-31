// Выгрузка базы клиентов в Excel (.xlsx) — только для владельца.
import ExcelJS from "exceljs";
import { desc, eq } from "drizzle-orm";
import { auth } from "@/auth";
import { db } from "@/db";
import { clients, users } from "@/db/schema";
import { todayISO } from "@/lib/dates";
import { formatBirthday, formatPhone } from "@/lib/client-parse";
import { SEGMENT_LABEL, effectiveSegment, ensureChatSchema } from "@/lib/chats";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

export async function GET() {
  const session = await auth();
  if (session?.user?.role !== "owner") return new Response("Нет доступа", { status: 403 });
  await ensureChatSchema();

  const rows = await db
    .select({ c: clients, userName: users.name })
    .from(clients)
    .leftJoin(users, eq(clients.addedByUserId, users.id))
    .orderBy(desc(clients.createdAt));

  const wb = new ExcelJS.Workbook();
  wb.creator = "Табель AYAY KYZ";
  const ws = wb.addWorksheet("Клиенты", { views: [{ state: "frozen", ySplit: 1 }] });
  ws.columns = [
    { header: "ФИО", key: "name", width: 34 },
    { header: "Телефон", key: "phone", width: 20 },
    { header: "Дата рождения", key: "birthday", width: 15 },
    { header: "День", key: "day", width: 7 },
    { header: "Месяц", key: "month", width: 8 },
    { header: "Год", key: "year", width: 8 },
    { header: "Сегмент", key: "segment", width: 14 },
    { header: "Выжимка по переписке", key: "summary", width: 60 },
    { header: "Кто добавил", key: "who", width: 24 },
    { header: "Откуда", key: "source", width: 15 },
    { header: "Добавлен", key: "created", width: 12 },
  ];
  for (const { c, userName } of rows) {
    ws.addRow({
      name: c.name ?? "",
      phone: formatPhone(c.phone), // текстом, чтобы Excel не съел «+» и не превратил номер в число
      birthday: c.birthDay && c.birthMonth ? formatBirthday(c.birthDay, c.birthMonth, c.birthYear) : "",
      day: c.birthDay ?? "",
      month: c.birthMonth ?? "",
      year: c.birthYear ?? "",
      segment: effectiveSegment(c) ? SEGMENT_LABEL[effectiveSegment(c)!] : "",
      summary: c.aiSummary ?? "",
      who: userName ?? c.addedByName ?? "",
      source: c.source === "manual" ? "вручную" : c.source === "ai" ? "анализ переписки" : "чат WhatsApp",
      created: c.createdAt.slice(0, 10).split("-").reverse().join("."),
    });
  }
  const header = ws.getRow(1);
  header.font = { bold: true, color: { argb: "FFFFFFFF" } };
  header.fill = { type: "pattern", pattern: "solid", fgColor: { argb: "FFC8400E" } };
  ws.autoFilter = { from: { row: 1, column: 1 }, to: { row: 1, column: ws.columns.length } };

  const buf = await wb.xlsx.writeBuffer();
  return new Response(buf as ArrayBuffer, {
    headers: {
      "Content-Type": "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
      "Content-Disposition": `attachment; filename="clients-${todayISO()}.xlsx"`,
    },
  });
}
