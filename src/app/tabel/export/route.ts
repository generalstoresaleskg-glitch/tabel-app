import { NextRequest } from "next/server";
import { requireRole } from "@/lib/session";
import { getShiftsInRange } from "@/lib/schedule-queries";
import { currentMonthStr, monthRange, formatTimeHHMM } from "@/lib/dates";

// Экспорт табеля в CSV — временная замена автоматической ежедневной выгрузки в
// Google-таблицу (запланирована на Этап 3). Формат столбцов подобран так, чтобы
// его можно было напрямую вставить в Google Sheets.
export async function GET(request: NextRequest) {
  await requireRole(["owner", "manager"]);

  const month = request.nextUrl.searchParams.get("month") || currentMonthStr();
  const { start, end } = monthRange(month);
  const rows = await getShiftsInRange(start, end);
  const sorted = [...rows].sort((a, b) => a.shift.date.localeCompare(b.shift.date));

  const header = [
    "Дата",
    "Сотрудник",
    "Точка",
    "Тип",
    "План. начало",
    "План. конец",
    "Факт. приход/визит",
    "Факт. уход",
    "Статус прихода",
    "Статус ухода",
  ];

  const csvRows = sorted.map((r) => [
    r.shift.date,
    r.user?.name ?? "",
    r.point?.name ?? "",
    r.shift.type === "SHIFT" ? "Смена" : "Визит",
    r.shift.plannedStart ?? "",
    r.shift.plannedEnd ?? "",
    r.attendance?.checkinAt ? formatTimeHHMM(r.attendance.checkinAt) : "",
    r.attendance?.checkoutAt ? formatTimeHHMM(r.attendance.checkoutAt) : "",
    r.attendance?.checkinStatus ?? "",
    r.attendance?.checkoutStatus ?? "",
  ]);

  const csv = [header, ...csvRows]
    .map((row) => row.map((cell) => `"${String(cell).replace(/"/g, '""')}"`).join(";"))
    .join("\r\n");

  return new Response("﻿" + csv, {
    headers: {
      "Content-Type": "text/csv; charset=utf-8",
      "Content-Disposition": `attachment; filename="tabel-${month}.csv"`,
    },
  });
}
