import { randomInt, randomUUID } from "crypto";
import { and, eq, sql } from "drizzle-orm";
import { db } from "@/db";
import { certificates } from "@/db/schema";
import { type ParsedCertificate, formatAmount } from "@/lib/certificate-parse";

// Таблица создаётся сама при первом обращении (как в chats.ts) — вручную в Neon
// ничего выполнять не нужно. Запросы идемпотентны; зеркало — training-content/neon-migration-certificates.sql.
const DDL = [
  `CREATE TABLE IF NOT EXISTS "certificates" (
    "id" text PRIMARY KEY NOT NULL,
    "code" text NOT NULL,
    "recipient" text NOT NULL,
    "sender" text NOT NULL,
    "amount" integer NOT NULL,
    "message" text NOT NULL,
    "status" text DEFAULT 'issued' NOT NULL,
    "source_message_id" text,
    "issued_by_user_id" text,
    "issued_by_name" text,
    "redeemed_at" text,
    "redeemed_by_name" text,
    "created_at" text DEFAULT now()::text NOT NULL,
    CONSTRAINT "certificates_code_unique" UNIQUE("code"),
    CONSTRAINT "certificates_source_message_id_unique" UNIQUE("source_message_id")
  )`,
  `DO $$ BEGIN
    ALTER TABLE "certificates" ADD CONSTRAINT "certificates_issued_by_user_id_users_id_fk" FOREIGN KEY ("issued_by_user_id") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;
  EXCEPTION WHEN duplicate_object THEN NULL;
  END $$`,
];

let tableReady: Promise<void> | null = null;

function ensureTable(): Promise<void> {
  tableReady ??= (async () => {
    const r = await db.execute(sql`select count(*)::int as n from information_schema.tables where table_name = 'certificates'`);
    if (Number((r.rows[0] as { n: number } | undefined)?.n ?? 0) > 0) return;
    for (const stmt of DDL) await db.execute(sql.raw(stmt));
  })().catch((err) => {
    tableReady = null; // следующая попытка — заново
    throw err;
  });
  return tableReady;
}

// Номер из 4 цифр (1000–9999), чтобы его было легко писать в чате; если свободные
// закончились — 5 цифр. Уникальность гарантирует база, при коллизии берём другой.
function newCode(digits: number): string {
  const min = 10 ** (digits - 1);
  return String(randomInt(min, min * 10));
}

// «AK-4827», «№ 4827», «4827» → «4827»
export function normalizeCode(raw: string): string | null {
  const m = /^\s*(?:AK-?|№)?\s*(\d{4,5})\s*$/i.exec(raw);
  return m ? m[1] : null;
}

export type CertificateRow = typeof certificates.$inferSelect;

export async function findCertificateByCode(raw: string): Promise<CertificateRow | null> {
  const code = normalizeCode(raw);
  if (!code) return null;
  await ensureTable();
  const rows = await db.select().from(certificates).where(eq(certificates.code, code));
  return rows[0] ?? null;
}

// Погашение целиком. Условие status='issued' в самом UPDATE защищает от гонки:
// два продавца одновременно не смогут принять один сертификат.
export async function redeemCertificate(
  raw: string,
  by: { name: string | null }
): Promise<{ result: "ok" | "already" | "not_found"; row: CertificateRow | null }> {
  const code = normalizeCode(raw);
  if (!code) return { result: "not_found", row: null };
  await ensureTable();
  const updated = await db
    .update(certificates)
    .set({ status: "redeemed", redeemedAt: new Date().toISOString(), redeemedByName: by.name })
    .where(and(eq(certificates.code, code), eq(certificates.status, "issued")))
    .returning();
  if (updated[0]) return { result: "ok", row: updated[0] };
  const row = await findCertificateByCode(code);
  return { result: row ? "already" : "not_found", row };
}

// Дата/время по Бишкеку: «10.11 в 13:34». Поддерживает ISO и формат Postgres now()::text.
export function bishkekStamp(ts: string | null): string {
  if (!ts) return "—";
  const d = new Date(ts.includes("T") ? ts : ts.replace(" ", "T").replace(/\+00$/, "Z"));
  if (isNaN(d.getTime())) return "—";
  const parts = new Intl.DateTimeFormat("ru-RU", {
    timeZone: "Asia/Bishkek", day: "2-digit", month: "2-digit", hour: "2-digit", minute: "2-digit", hour12: false,
  }).formatToParts(d);
  const g = (t: string) => parts.find((x) => x.type === t)?.value ?? "";
  return `${g("day")}.${g("month")} в ${g("hour")}:${g("minute")}`;
}

// Идемпотентно по sourceMessageId: если бот повторил запрос (таймаут, ретрай),
// второй сертификат не создаётся — возвращается уже выданный.
export async function issueCertificate(
  c: ParsedCertificate,
  by: { sourceMessageId: string | null; userId: string | null; name: string | null }
): Promise<{ status: "created" | "existing"; row: CertificateRow }> {
  await ensureTable();
  if (by.sourceMessageId) {
    const prev = await db.select().from(certificates).where(eq(certificates.sourceMessageId, by.sourceMessageId));
    if (prev[0]) return { status: "existing", row: prev[0] };
  }
  for (let attempt = 0; attempt < 30; attempt++) {
    try {
      const [row] = await db
        .insert(certificates)
        .values({
          id: randomUUID(),
          code: newCode(attempt < 20 ? 4 : 5),
          recipient: c.recipient,
          sender: c.sender,
          amount: c.amount,
          message: c.message,
          sourceMessageId: by.sourceMessageId,
          issuedByUserId: by.userId,
          issuedByName: by.name,
        })
        .returning();
      return { status: "created", row };
    } catch (err) {
      // Редкая коллизия кода — пробуем другой. Гонка по sourceMessageId — отдаём уже созданный.
      if (by.sourceMessageId) {
        const prev = await db.select().from(certificates).where(eq(certificates.sourceMessageId, by.sourceMessageId));
        if (prev[0]) return { status: "existing", row: prev[0] };
      }
      if (attempt === 29) throw err;
    }
  }
  throw new Error("unreachable");
}

export function certificateSummary(r: { recipient: string; sender: string; amount: number; code: string }): string {
  return `№ ${r.code} — ${formatAmount(r.amount)} сом\nКому: ${r.recipient}\nОт: ${r.sender}`;
}
