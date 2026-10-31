import Link from "next/link";
import { desc, eq } from "drizzle-orm";
import { db } from "@/db";
import { clients, users } from "@/db/schema";
import { requireRole } from "@/lib/session";
import { currentMonthStr, monthLabel, todayISO } from "@/lib/dates";
import { formatBirthday, formatPhone } from "@/lib/client-parse";
import {
  CLIENT_SEGMENTS,
  SEGMENT_HINT,
  SEGMENT_LABEL,
  analysesByPhone,
  effectiveSegment,
  ensureChatSchema,
  type Segment,
} from "@/lib/chats";
import { AddClientForm, DeleteClientButton } from "./client-forms";

type Filter = "all" | "today" | "month" | Segment;

const SEGMENT_STYLE: Record<Segment, string> = {
  loyal: "bg-emerald-100 text-emerald-800",
  buyer: "bg-sky-100 text-sky-800",
  warm: "bg-amber-100 text-amber-800",
  problem: "bg-rose-100 text-rose-800",
};

function strList(v: unknown): string[] {
  return Array.isArray(v) ? v.map((x) => String(x)).filter(Boolean) : [];
}

export default async function ClientsPage({
  searchParams,
}: {
  searchParams: Promise<{ q?: string; f?: string }>;
}) {
  await requireRole(["owner"]);
  await ensureChatSchema();
  const { q: rawQ, f: rawF } = await searchParams;
  const q = (rawQ ?? "").trim();
  const filter: Filter =
    rawF === "today" || rawF === "month" || CLIENT_SEGMENTS.includes(rawF as Segment) ? (rawF as Filter) : "all";

  const rows = await db
    .select({ c: clients, userName: users.name })
    .from(clients)
    .leftJoin(users, eq(clients.addedByUserId, users.id))
    .orderBy(desc(clients.createdAt));

  const today = todayISO();
  const [, tm, td] = today.split("-").map(Number);
  const thisMonth = currentMonthStr(); // "2026-10"

  const all = rows.map(({ c, userName }) => ({ ...c, segment: effectiveSegment(c), who: userName ?? c.addedByName ?? "—" }));
  const byStaff = all.filter((c) => c.source !== "ai").length;
  const qDigits = q.replace(/\D/g, "");
  const list = all.filter((c) => {
    if (filter === "today" && !(c.birthMonth === tm && c.birthDay === td)) return false;
    if (filter === "month" && c.birthMonth !== tm) return false;
    if (CLIENT_SEGMENTS.includes(filter as Segment) && c.segment !== filter) return false;
    if (!q) return true;
    return (
      (c.name ?? "").toLowerCase().includes(q.toLowerCase()) ||
      (qDigits.length >= 3 && c.phone.replace(/\D/g, "").includes(qDigits))
    );
  });
  if (filter === "month") list.sort((a, b) => (a.birthDay ?? 0) - (b.birthDay ?? 0));
  const segmentCounts = Object.fromEntries(CLIENT_SEGMENTS.map((s) => [s, all.filter((c) => c.segment === s).length]));
  // Подробный разбор переписки — только для показанных клиентов, не больше 300.
  const analyses = await analysesByPhone(list.filter((c) => c.segment).slice(0, 300).map((c) => c.phone));

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
        key={f}
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
            Всего в базе: <b>{all.length}</b> — завели продавцы: {byStaff}, найдено в переписках WhatsApp:{" "}
            {all.length - byStaff}. Продавцы добавляют клиентов в общем чате командой{" "}
            <code className="rounded bg-slate-100 px-1">/клиент ФИО телефон дата рождения</code>.
          </p>
        </div>
        <div className="flex gap-2">
          <Link href="/clients/report" className="btn-ghost btn-sm">
            Анализ продаж
          </Link>
          <a href="/clients/export" className="btn-primary btn-sm">
            Скачать Excel
          </a>
        </div>
      </div>

      <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
        {CLIENT_SEGMENTS.map((s) => (
          <Link key={s} href={`/clients?f=${s}`} className="card-pad block hover:bg-slate-50">
            <div className="text-sm font-medium text-slate-700">{SEGMENT_LABEL[s]}</div>
            <div className="mt-1 text-2xl font-semibold">{segmentCounts[s]}</div>
            <div className="mt-1 text-xs leading-snug text-slate-500">{SEGMENT_HINT[s]}</div>
          </Link>
        ))}
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
          {CLIENT_SEGMENTS.map((s) => tab(s, SEGMENT_LABEL[s]))}
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
                <ClientRow key={c.id} c={c} a={analyses.get(c.phone)} tm={tm} td={td} />
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

type Row = {
  id: string;
  name: string | null;
  phone: string;
  birthDay: number | null;
  birthMonth: number | null;
  birthYear: number | null;
  source: "whatsapp" | "manual" | "ai";
  segment: Segment | null;
  aiSummary: string | null;
  who: string;
  createdAt: string;
};

function ClientRow({ c, a, tm, td }: { c: Row; a: Record<string, unknown> | undefined; tm: number; td: number }) {
  const details = a
    ? ([
        ["Что предложить сейчас", strList(a.next_action ? [a.next_action] : [])],
        ["Интересы", strList(a.interests)],
        ["Ошибки в обслуживании", strList(a.service_issues)],
        ["Почему не купила", strList(a.lost_sale ? [a.lost_sale] : [])],
        ["Рекомендации", strList(a.recommendations)],
      ] as [string, string[]][]).filter(([, v]) => v.length)
    : [];
  return (
    <li className="px-4 py-3">
      <div className="flex flex-wrap items-center gap-x-6 gap-y-1">
        <div className="min-w-0 flex-1 basis-48">
          <div className="flex flex-wrap items-center gap-2 font-medium text-slate-900">
            {c.name ?? <span className="text-slate-400">Без имени</span>}
            {c.segment && (
              <span className={`rounded-full px-2 py-0.5 text-xs font-medium ${SEGMENT_STYLE[c.segment]}`}>
                {SEGMENT_LABEL[c.segment]}
              </span>
            )}
          </div>
          <a href={`tel:${c.phone}`} className="text-sm text-slate-600">
            {formatPhone(c.phone)}
          </a>
        </div>
        <div className="text-sm text-slate-700">
          {c.birthDay && c.birthMonth ? (
            <>
              ДР {formatBirthday(c.birthDay, c.birthMonth, c.birthYear)}
              {c.birthMonth === tm && c.birthDay === td && " 🎂"}
            </>
          ) : (
            <span className="text-slate-400">ДР не указан</span>
          )}
        </div>
        <div className="text-xs text-slate-500 sm:w-48">
          {c.source === "manual" ? "вручную" : c.source === "ai" ? "из переписки" : "из чата"} · {c.who} ·{" "}
          {c.createdAt.slice(0, 10).split("-").reverse().join(".")}
        </div>
        <DeleteClientButton id={c.id} name={c.name ?? formatPhone(c.phone)} />
      </div>
      {c.aiSummary && <p className="mt-1 text-sm text-slate-600">{c.aiSummary}</p>}
      {details.length > 0 && (
        <details className="mt-1 text-sm">
          <summary className="cursor-pointer text-brand-700">Разбор переписки</summary>
          <dl className="mt-2 space-y-2 rounded-lg bg-slate-50 p-3">
            {details.map(([label, items]) => (
              <div key={label}>
                <dt className="text-xs font-medium uppercase tracking-wide text-slate-500">{label}</dt>
                <dd className="text-slate-700">
                  {items.length === 1 ? (
                    items[0]
                  ) : (
                    <ul className="list-disc pl-5">
                      {items.map((x, i) => (
                        <li key={i}>{x}</li>
                      ))}
                    </ul>
                  )}
                </dd>
              </div>
            ))}
          </dl>
        </details>
      )}
    </li>
  );
}
