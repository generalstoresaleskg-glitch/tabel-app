import Link from "next/link";
import { desc, eq } from "drizzle-orm";
import { db } from "@/db";
import { clients, users } from "@/db/schema";
import { requireRole } from "@/lib/session";
import { currentMonthStr, monthLabel, todayISO } from "@/lib/dates";
import { formatBirthday, formatPhone } from "@/lib/client-parse";
import { AddClientForm, DeleteClientButton } from "./client-forms";

type Filter = "all" | "today" | "month";

export default async function ClientsPage({
  searchParams,
}: {
  searchParams: Promise<{ q?: string; f?: string }>;
}) {
  await requireRole(["owner"]);
  const { q: rawQ, f: rawF } = await searchParams;
  const q = (rawQ ?? "").trim();
  const filter: Filter = rawF === "today" || rawF === "month" ? rawF : "all";

  const rows = await db
    .select({ c: clients, userName: users.name })
    .from(clients)
    .leftJoin(users, eq(clients.addedByUserId, users.id))
    .orderBy(desc(clients.createdAt));

  const today = todayISO();
  const [, tm, td] = today.split("-").map(Number);
  const thisMonth = currentMonthStr(); // "2026-10"

  const all = rows.map(({ c, userName }) => ({ ...c, who: userName ?? c.addedByName ?? "—" }));
  const qDigits = q.replace(/\D/g, "");
  const list = all.filter((c) => {
    if (filter === "today" && !(c.birthMonth === tm && c.birthDay === td)) return false;
    if (filter === "month" && c.birthMonth !== tm) return false;
    if (!q) return true;
    return (
      c.name.toLowerCase().includes(q.toLowerCase()) ||
      (qDigits.length >= 3 && c.phone.replace(/\D/g, "").includes(qDigits))
    );
  });
  if (filter === "month") list.sort((a, b) => a.birthDay - b.birthDay);

  const todayCount = all.filter((c) => c.birthMonth === tm && c.birthDay === td).length;
  const perEmployee = new Map<string, number>();
  for (const c of all) {
    if (c.createdAt.slice(0, 7) === thisMonth) perEmployee.set(c.who, (perEmployee.get(c.who) ?? 0) + 1);
  }
  const perEmployeeList = [...perEmployee.entries()].sort((a, b) => b[1] - a[1]);

  const tab = (f: Filter, label: string) => {
    const params = new URLSearchParams();
    if (f !== "all") params.set("f", f);
    if (q) params.set("q", q);
    const href = `/clients${params.size ? `?${params}` : ""}`;
    return (
      <Link
        href={href}
        className={`rounded-full px-3 py-1.5 text-sm ${
          filter === f ? "bg-brand-600 text-white" : "bg-slate-100 text-slate-700 hover:bg-slate-200"
        }`}
      >
        {label}
      </Link>
    );
  };

  return (
    <div className="space-y-8">
      <div className="flex flex-wrap items-end justify-between gap-3">
        <div>
          <h1 className="page-title">Клиенты</h1>
          <p className="page-subtitle">
            Всего в базе: {all.length}. Сотрудники добавляют клиентов в общем чате командой{" "}
            <code className="rounded bg-slate-100 px-1">/клиент ФИО телефон дата рождения</code>.
          </p>
        </div>
        <a href="/clients/export" className="btn-primary btn-sm">
          Скачать Excel
        </a>
      </div>

      <div className="grid gap-4 sm:grid-cols-2">
        <div className="card-pad">
          <div className="text-sm text-slate-500">Дни рождения сегодня</div>
          <div className="mt-1 text-2xl font-semibold">{todayCount}</div>
        </div>
        <div className="card-pad">
          <div className="text-sm text-slate-500">Добавили клиентов — {monthLabel(thisMonth)}</div>
          {perEmployeeList.length ? (
            <ul className="mt-2 space-y-1 text-sm">
              {perEmployeeList.map(([who, n]) => (
                <li key={who} className="flex justify-between gap-4">
                  <span>{who}</span>
                  <span className="font-medium">{n}</span>
                </li>
              ))}
            </ul>
          ) : (
            <div className="mt-1 text-sm text-slate-500">Пока никого</div>
          )}
        </div>
      </div>

      <div className="space-y-4">
        <div className="flex flex-wrap items-center gap-2">
          {tab("all", "Все")}
          {tab("today", "ДР сегодня")}
          {tab("month", "ДР в этом месяце")}
          <form className="ml-auto flex w-full gap-2 sm:w-auto" action="/clients">
            {filter !== "all" && <input type="hidden" name="f" value={filter} />}
            <input name="q" defaultValue={q} placeholder="Поиск по имени или номеру" className="input sm:!w-64" />
            <button className="btn-link">Найти</button>
          </form>
        </div>

        {list.length === 0 ? (
          <div className="card-pad text-sm text-slate-500">
            {all.length === 0 ? "Клиентов пока нет." : "Никого не нашлось."}
          </div>
        ) : (
          <div className="card overflow-hidden">
            <ul className="divide-y divide-slate-100">
              {list.map((c) => (
                <li key={c.id} className="flex flex-wrap items-center gap-x-6 gap-y-1 px-4 py-3">
                  <div className="min-w-0 flex-1 basis-48">
                    <div className="font-medium text-slate-900">{c.name}</div>
                    <a href={`tel:${c.phone}`} className="text-sm text-slate-600">
                      {formatPhone(c.phone)}
                    </a>
                  </div>
                  <div className="text-sm text-slate-700">
                    ДР {formatBirthday(c.birthDay, c.birthMonth, c.birthYear)}
                    {c.birthMonth === tm && c.birthDay === td && " 🎂"}
                  </div>
                  <div className="text-xs text-slate-500 sm:w-48">
                    {c.source === "manual" ? "вручную" : "из чата"} · {c.who} · {c.createdAt.slice(0, 10).split("-").reverse().join(".")}
                  </div>
                  <DeleteClientButton id={c.id} name={c.name} />
                </li>
              ))}
            </ul>
          </div>
        )}
      </div>

      <div className="card-pad">
        <h2 className="section-title mb-4">Добавить клиента вручную</h2>
        <AddClientForm />
      </div>
    </div>
  );
}
