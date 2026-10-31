// Переписки WhatsApp магазина: хранение, очередь на анализ, сохранение
// результатов ИИ в базу клиентов и общий отчёт по продажам и сервису.
//
// Сам анализ (вызовы DeepSeek) делает бот на Render — у него нет лимита
// времени на запрос, а ключ DeepSeek лежит только там. Приложение хранит
// данные и отдаёт боту очередь чатов.
import { randomUUID } from "crypto";
import { and, desc, eq, gte, inArray, isNull, lt, or, sql } from "drizzle-orm";
import { db } from "@/db";
import { chatReports, clients, users, waChats, waMessages } from "@/db/schema";
import { normalizePhone } from "@/lib/client-parse";

export type Segment = "loyal" | "buyer" | "warm" | "problem";
export const CLIENT_SEGMENTS: Segment[] = ["loyal", "buyer", "warm", "problem"];
export const SEGMENT_LABEL: Record<Segment, string> = {
  loyal: "Лояльный",
  buyer: "Покупатель",
  warm: "Тёплый",
  problem: "Проблемный",
};

// --- Схема ------------------------------------------------------------------
//
// Новые таблицы и колонки создаются сами при первом обращении, без ручного
// запуска SQL в Neon. Все команды идемпотентны; проверка в начале делает так,
// что на уже обновлённой базе выполняется один лёгкий запрос на экземпляр.
// Тот же SQL лежит в training-content/neon-migration-chats.sql.

const DDL = [
  `ALTER TABLE "clients" ALTER COLUMN "name" DROP NOT NULL`,
  `ALTER TABLE "clients" ALTER COLUMN "birth_day" DROP NOT NULL`,
  `ALTER TABLE "clients" ALTER COLUMN "birth_month" DROP NOT NULL`,
  `ALTER TABLE "clients" ADD COLUMN IF NOT EXISTS "segment" text`,
  `ALTER TABLE "clients" ADD COLUMN IF NOT EXISTS "ai_summary" text`,
  `CREATE TABLE IF NOT EXISTS "wa_messages" (
    "chat" text NOT NULL,
    "msg_id" text NOT NULL,
    "from_me" boolean NOT NULL,
    "ts" integer NOT NULL,
    "text" text NOT NULL,
    CONSTRAINT "wa_messages_chat_msg_id_pk" PRIMARY KEY("chat","msg_id")
  )`,
  `CREATE TABLE IF NOT EXISTS "wa_chats" (
    "chat" text PRIMARY KEY NOT NULL,
    "jid" text,
    "phone" text,
    "name" text,
    "msg_count" integer DEFAULT 0 NOT NULL,
    "in_count" integer DEFAULT 0 NOT NULL,
    "last_msg_at" integer DEFAULT 0 NOT NULL,
    "analyzed_at" integer,
    "attempts" integer DEFAULT 0 NOT NULL,
    "history_done" boolean DEFAULT false NOT NULL,
    "segment" text,
    "analysis" text
  )`,
  `CREATE TABLE IF NOT EXISTS "chat_reports" (
    "id" text PRIMARY KEY NOT NULL,
    "chats_count" integer NOT NULL,
    "body" text NOT NULL,
    "created_at" text DEFAULT now()::text NOT NULL
  )`,
  // Последней — по ней проверка ниже понимает, что всё уже применено.
  `ALTER TABLE "clients" ADD COLUMN IF NOT EXISTS "last_chat_at" integer`,
];

let schemaReady: Promise<void> | null = null;

export function ensureChatSchema(): Promise<void> {
  schemaReady ??= (async () => {
    const r = await db.execute(
      sql`select count(*)::int as n from information_schema.columns where table_name = 'clients' and column_name = 'last_chat_at'`
    );
    if (Number((r.rows[0] as { n: number } | undefined)?.n ?? 0) > 0) return;
    for (const stmt of DDL) await db.execute(sql.raw(stmt));
  })().catch((err) => {
    schemaReady = null; // следующая попытка — заново
    throw err;
  });
  return schemaReady;
}

// --- Приём сообщений от бота --------------------------------------------------

export type IncomingMessage = {
  chat: string;
  jid?: string | null;
  phone: string | null; // «996555123456» или «+996…»
  msgId: string;
  fromMe: boolean;
  ts: number;
  text: string;
};
export type IncomingContact = {
  chat: string;
  jid?: string | null;
  phone: string | null;
  name: string;
  weak?: boolean; // имя из профиля WhatsApp — не перетирает имя из контактов телефона
};

function toPhone(raw: string | null | undefined): string | null {
  if (!raw) return null;
  const d = raw.replace(/\D/g, "");
  return d ? normalizePhone("+" + d) : null;
}

function chunk<T>(arr: T[], size: number): T[][] {
  const out: T[][] = [];
  for (let i = 0; i < arr.length; i += size) out.push(arr.slice(i, i + size));
  return out;
}

export async function ingestChats(messages: IncomingMessage[], contacts: IncomingContact[]) {
  await ensureChatSchema();

  const chatRows = new Map<string, { chat: string; phone: string | null; jid: string | null }>();
  for (const x of [...messages, ...contacts]) {
    if (!x.chat) continue;
    const prev = chatRows.get(x.chat);
    chatRows.set(x.chat, {
      chat: x.chat,
      phone: toPhone(x.phone) ?? prev?.phone ?? null,
      jid: x.jid ?? prev?.jid ?? null,
    });
  }
  for (const part of chunk([...chatRows.values()], 500)) {
    await db
      .insert(waChats)
      .values(part)
      .onConflictDoUpdate({
        target: waChats.chat,
        set: {
          phone: sql`coalesce(excluded.phone, ${waChats.phone})`,
          jid: sql`coalesce(${waChats.jid}, excluded.jid)`,
        },
      });
  }

  // Имена одним запросом на пачку: из контактов телефона — всегда, из профиля
  // WhatsApp (weak) — только если имени ещё нет.
  const names = new Map<string, { name: string; weak: boolean }>();
  for (const c of contacts) {
    const name = String(c.name ?? "").trim().slice(0, 120);
    if (!c.chat || !name) continue;
    const prev = names.get(c.chat);
    if (!prev || (prev.weak && !c.weak)) names.set(c.chat, { name, weak: !!c.weak });
  }
  for (const part of chunk([...names.entries()], 500)) {
    const values = sql.join(
      part.map(([chat, n]) => sql`(${chat}::text, ${n.name}::text, ${n.weak}::boolean)`),
      sql`, `
    );
    await db.execute(sql`
      update wa_chats c set name = v.name
      from (values ${values}) as v(chat, name, weak)
      where c.chat = v.chat and (not v.weak or c.name is null)`);
  }

  let inserted = 0;
  for (const part of chunk(messages, 400)) {
    const rows = part
      .filter((m) => m.chat && m.msgId && m.text?.trim())
      .map((m) => ({ chat: m.chat, msgId: m.msgId, fromMe: !!m.fromMe, ts: Math.floor(m.ts) || 0, text: m.text.slice(0, 4000) }));
    if (!rows.length) continue;
    const res = await db.insert(waMessages).values(rows).onConflictDoNothing().returning();
    inserted += res.length;
  }

  const touched = [...new Set(messages.map((m) => m.chat))];
  for (const part of chunk(touched, 300)) {
    await db.execute(sql`
      update wa_chats c set msg_count = s.n, in_count = s.inn, last_msg_at = s.last
      from (
        select chat, count(*)::int as n, (count(*) filter (where not from_me))::int as inn, max(ts)::int as last
        from wa_messages where chat in ${sql`(${sql.join(part.map((p) => sql`${p}`), sql`, `)})`}
        group by chat
      ) s
      where c.chat = s.chat`);
  }
  return { inserted, chats: chatRows.size };
}

// --- Очередь на анализ ------------------------------------------------------------

const MAX_ATTEMPTS = 3;
const pendingWhere = and(
  gte(waChats.inCount, 1),
  gte(waChats.msgCount, 1), // и неотвеченные одиночные сообщения — это тоже потерянные клиенты
  lt(waChats.attempts, MAX_ATTEMPTS),
  or(isNull(waChats.analyzedAt), lt(waChats.analyzedAt, waChats.lastMsgAt))
);

// Номера сотрудников из «Сотрудников» — их переписки с магазином не анализируем.
async function staffPhones(): Promise<Set<string>> {
  const rows = await db.select({ phone: users.phone }).from(users);
  return new Set(rows.map((r) => (r.phone ? normalizePhone(r.phone) : null)).filter((p): p is string => !!p));
}

export async function pendingChats(limit: number) {
  await ensureChatSchema();
  const staff = await staffPhones();
  const rows = await db.select().from(waChats).where(pendingWhere).orderBy(desc(waChats.lastMsgAt)).limit(limit + 20);

  const out = [];
  for (const c of rows) {
    if (c.phone && staff.has(c.phone)) {
      await db.update(waChats).set({ segment: "staff", analyzedAt: c.lastMsgAt }).where(eq(waChats.chat, c.chat));
      continue;
    }
    if (out.length >= limit) break;
    const msgs = await db
      .select({ fromMe: waMessages.fromMe, ts: waMessages.ts, text: waMessages.text })
      .from(waMessages)
      .where(eq(waMessages.chat, c.chat))
      .orderBy(desc(waMessages.ts))
      .limit(300);
    out.push({ chat: c.chat, phone: c.phone, name: c.name, total: c.msgCount, messages: msgs.reverse() });
  }
  const [{ n }] = await db.select({ n: sql<number>`count(*)::int` }).from(waChats).where(pendingWhere);
  return { chats: out, remaining: Number(n) };
}

// --- Результат анализа одной переписки ----------------------------------------------

export type ChatAnalysis = {
  is_customer?: boolean;
  segment?: string;
  name?: string | null;
  birthday?: string | null;
  summary?: string;
  [key: string]: unknown;
};

function parseBirthday(raw: unknown): { day: number; month: number; year: number | null } | null {
  const m = /^(\d{1,2})\.(\d{1,2})(?:\.(\d{4}))?$/.exec(String(raw ?? "").trim());
  if (!m) return null;
  const day = Number(m[1]);
  const month = Number(m[2]);
  const year = m[3] ? Number(m[3]) : null;
  if (month < 1 || month > 12 || day < 1 || day > 31) return null;
  if (year && (year < 1930 || year > new Date().getFullYear() - 5)) return { day, month, year: null };
  return { day, month, year };
}

function cleanName(raw: unknown): string | null {
  const s = String(raw ?? "").replace(/\s+/g, " ").trim();
  if (s.length < 2 || s.length > 80 || /\d{4,}/.test(s)) return null;
  return s;
}

export async function saveAnalysis(input: { chat: string; phone?: string | null; ok: boolean; result?: ChatAnalysis }) {
  await ensureChatSchema();
  const [chat] = await db.select().from(waChats).where(eq(waChats.chat, input.chat));
  if (!chat) return { status: "unknown_chat" as const };

  if (!input.ok || !input.result) {
    await db.update(waChats).set({ attempts: chat.attempts + 1 }).where(eq(waChats.chat, chat.chat));
    return { status: "failed" as const };
  }

  const r = input.result;
  const seg = CLIENT_SEGMENTS.includes(r.segment as Segment) && r.is_customer !== false ? (r.segment as Segment) : null;
  const phone = toPhone(input.phone) ?? chat.phone;
  await db
    .update(waChats)
    .set({ analysis: JSON.stringify(r), segment: seg ?? "other", analyzedAt: chat.lastMsgAt, attempts: 0, phone })
    .where(eq(waChats.chat, chat.chat));

  if (!seg || !phone) return { status: seg ? ("no_phone" as const) : ("not_client" as const), segment: seg };

  const name = cleanName(r.name) ?? cleanName(chat.name);
  const bd = parseBirthday(r.birthday);
  const summary = String(r.summary ?? "").slice(0, 500) || null;
  const now = new Date().toISOString();

  const [existing] = await db.select().from(clients).where(eq(clients.phone, phone));
  if (existing) {
    await db
      .update(clients)
      .set({
        segment: seg,
        aiSummary: summary,
        lastChatAt: chat.lastMsgAt,
        // Что сотрудники уже вписали вручную, не перетираем — только заполняем пустое.
        name: existing.name ?? name,
        ...(existing.birthDay == null && bd ? { birthDay: bd.day, birthMonth: bd.month, birthYear: bd.year } : {}),
        updatedAt: now,
      })
      .where(eq(clients.id, existing.id));
    return { status: "updated" as const, segment: seg };
  }
  await db.insert(clients).values({
    id: randomUUID(),
    name,
    phone,
    birthDay: bd?.day ?? null,
    birthMonth: bd?.month ?? null,
    birthYear: bd?.year ?? null,
    source: "ai",
    addedByName: "Анализ переписки",
    segment: seg,
    aiSummary: summary,
    lastChatAt: chat.lastMsgAt,
  });
  return { status: "created" as const, segment: seg };
}

// --- Общий отчёт ------------------------------------------------------------------

const REPORT_FIELDS = ["purchased", "sentiment", "service_issues", "lost_sale", "objections", "questions", "recommendations"];

// Сжатая выжимка по всем проанализированным клиентским перепискам — вход для
// итогового отчёта ИИ. Свежие переписки первыми; общий объём ограничен.
export async function reportInput(maxChars = 180_000) {
  await ensureChatSchema();
  const rows = await db
    .select({ segment: waChats.segment, analysis: waChats.analysis })
    .from(waChats)
    .where(inArray(waChats.segment, CLIENT_SEGMENTS))
    .orderBy(desc(waChats.lastMsgAt));

  const counts: Record<string, number> = {};
  const items: string[] = [];
  let size = 0;
  for (const row of rows) {
    counts[row.segment!] = (counts[row.segment!] ?? 0) + 1;
    if (!row.analysis || size > maxChars) continue;
    try {
      const a = JSON.parse(row.analysis) as Record<string, unknown>;
      const compact: Record<string, unknown> = { segment: row.segment };
      for (const f of REPORT_FIELDS) if (a[f] != null && a[f] !== "" && !(Array.isArray(a[f]) && !(a[f] as unknown[]).length)) compact[f] = a[f];
      const line = JSON.stringify(compact);
      size += line.length;
      items.push(line);
    } catch {
      // битый JSON пропускаем
    }
  }
  return { total: rows.length, counts, items };
}

export async function saveReport(body: unknown, chatsCount: number) {
  await ensureChatSchema();
  const id = randomUUID();
  await db.insert(chatReports).values({ id, chatsCount, body: JSON.stringify(body) });
  return id;
}

export async function latestReport() {
  await ensureChatSchema();
  const [r] = await db.select().from(chatReports).orderBy(desc(chatReports.createdAt)).limit(1);
  if (!r) return null;
  try {
    return { ...r, data: JSON.parse(r.body) as Record<string, unknown> };
  } catch {
    return null;
  }
}

export async function clientsCount(): Promise<number> {
  await ensureChatSchema();
  const [{ n }] = await db.select({ n: sql<number>`count(*)::int` }).from(clients);
  return Number(n);
}

// Анализ переписки конкретного клиента — для карточки на странице «Клиенты».
export async function analysesByPhone(phones: string[]) {
  if (!phones.length) return new Map<string, Record<string, unknown>>();
  const rows = await db
    .select({ phone: waChats.phone, analysis: waChats.analysis })
    .from(waChats)
    .where(and(inArray(waChats.phone, phones), sql`${waChats.analysis} is not null`));
  const map = new Map<string, Record<string, unknown>>();
  for (const r of rows) {
    try {
      if (r.phone) map.set(r.phone, JSON.parse(r.analysis!));
    } catch {
      // пропускаем
    }
  }
  return map;
}

// --- Докачка старых сообщений ---------------------------------------------------
//
// Бот по очереди просит у телефона магазина сообщения старше самого старого,
// что уже есть в базе, пока телефон не ответит, что старше ничего нет.

export async function backfillQueue(limit: number) {
  await ensureChatSchema();
  const rows = await db
    .select({ chat: waChats.chat, jid: waChats.jid })
    .from(waChats)
    .where(and(eq(waChats.historyDone, false), sql`${waChats.jid} is not null`, gte(waChats.msgCount, 1)))
    .orderBy(desc(waChats.lastMsgAt))
    .limit(limit);
  const out = [];
  for (const r of rows) {
    const [oldest] = await db
      .select({ msgId: waMessages.msgId, fromMe: waMessages.fromMe, ts: waMessages.ts })
      .from(waMessages)
      .where(eq(waMessages.chat, r.chat))
      .orderBy(waMessages.ts)
      .limit(1);
    if (oldest) out.push({ ...r, oldest });
  }
  const [{ n }] = await db
    .select({ n: sql<number>`count(*)::int` })
    .from(waChats)
    .where(and(eq(waChats.historyDone, false), sql`${waChats.jid} is not null`, gte(waChats.msgCount, 1)));
  return { chats: out, remaining: Number(n) };
}

export async function markHistoryDone(chat: string) {
  await ensureChatSchema();
  await db.update(waChats).set({ historyDone: true }).where(eq(waChats.chat, chat));
}

export async function chatStats() {
  await ensureChatSchema();
  const r = await db.execute(sql`
    select
      (select count(*)::int from wa_chats) as chats,
      (select count(*)::int from wa_messages) as messages,
      (select min(ts)::int from wa_messages) as oldest_ts,
      (select count(*)::int from wa_chats where not history_done and jid is not null and msg_count > 0) as backfill_left,
      (select count(*)::int from clients) as clients`);
  return r.rows[0] as Record<string, number | null>;
}
