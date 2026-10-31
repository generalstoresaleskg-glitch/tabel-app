import Link from "next/link";
import { requireRole } from "@/lib/session";
import { SEGMENT_LABEL, latestReport, type Segment } from "@/lib/chats";

// Последний общий отчёт ИИ по перепискам магазина: что хорошо, что теряем,
// частые вопросы и возражения, готовые фразы для продавцов.

type Item = Record<string, unknown>;

function items(v: unknown): Item[] {
  return Array.isArray(v) ? v.map((x) => (typeof x === "object" && x ? (x as Item) : { title: String(x) })) : [];
}
const str = (v: unknown) => (v == null ? "" : String(v));

function Section({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <section className="card-pad space-y-3">
      <h2 className="section-title">{title}</h2>
      {children}
    </section>
  );
}

function Cards({ list, a, b, badge }: { list: Item[]; a: string; b: string; badge?: string }) {
  if (!list.length) return <p className="text-sm text-slate-500">Нет данных.</p>;
  return (
    <ul className="space-y-3">
      {list.map((x, i) => (
        <li key={i} className="rounded-lg bg-slate-50 p-3">
          <div className="flex flex-wrap items-center gap-2 font-medium text-slate-900">
            {str(x[a]) || str(x.title)}
            {badge && x[badge] ? (
              <span className="rounded-full bg-brand-600/10 px-2 py-0.5 text-xs text-brand-700">{str(x[badge])}</span>
            ) : null}
          </div>
          {str(x[b]) && <p className="mt-1 text-sm text-slate-700 whitespace-pre-line">{str(x[b])}</p>}
        </li>
      ))}
    </ul>
  );
}

export default async function ReportPage() {
  await requireRole(["owner"]);
  const report = await latestReport();

  return (
    <div className="space-y-6">
      <div>
        <Link href="/clients" className="btn-link text-sm">
          ← Клиенты
        </Link>
        <h1 className="page-title mt-2">Анализ продаж и сервиса</h1>
        <p className="page-subtitle">
          {report
            ? `По ${report.chatsCount} клиентским перепискам WhatsApp · ${report.createdAt.slice(0, 16).replace("T", " ")}`
            : "Отчёта пока нет."}
        </p>
      </div>

      {!report ? (
        <div className="card-pad text-sm text-slate-600">
          Напишите <code className="rounded bg-slate-100 px-1">/анализ</code> в чате «табель и база клиентов» — бот
          разберёт переписки магазина, добавит клиентов в базу и сохранит сюда общий отчёт.
        </div>
      ) : (
        <>
          {report.data.counts && typeof report.data.counts === "object" ? (
            <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
              {(Object.entries(report.data.counts as Record<string, number>) as [Segment, number][]).map(([k, n]) => (
                <div key={k} className="card-pad">
                  <div className="text-sm text-slate-500">{SEGMENT_LABEL[k] ?? k}</div>
                  <div className="mt-1 text-2xl font-semibold">{n}</div>
                </div>
              ))}
            </div>
          ) : null}

          {str(report.data.summary) && (
            <Section title="Главное">
              <p className="text-slate-700 whitespace-pre-line">{str(report.data.summary)}</p>
            </Section>
          )}
          <Section title="Что работает хорошо">
            <Cards list={items(report.data.strengths)} a="title" b="detail" />
          </Section>
          <Section title="Слабые места">
            <Cards list={items(report.data.weaknesses)} a="title" b="detail" />
          </Section>
          <Section title="Почему теряем продажи">
            <Cards list={items(report.data.lost_sales)} a="reason" b="detail" />
          </Section>
          <Section title="Рекомендации">
            <Cards list={items(report.data.recommendations)} a="title" b="detail" badge="priority" />
          </Section>
          <Section title="Возражения клиентов и как отвечать">
            <Cards list={items(report.data.objections)} a="objection" b="how_to_handle" />
          </Section>
          <Section title="Частые вопросы">
            <Cards list={items(report.data.faq)} a="question" b="answer" />
          </Section>
          <Section title="Готовые фразы для продавцов">
            <Cards list={items(report.data.scripts)} a="situation" b="text" />
          </Section>
        </>
      )}
    </div>
  );
}
