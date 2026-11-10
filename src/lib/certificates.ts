import { randomInt, randomUUID } from "crypto";
import { eq } from "drizzle-orm";
import { db } from "@/db";
import { certificates } from "@/db/schema";
import { type ParsedCertificate, formatAmount } from "@/lib/certificate-parse";

// Без похожих символов (0/O, 1/I/L), чтобы код легко читался и диктовался.
const ALPHABET = "23456789ABCDEFGHJKMNPQRSTUVWXYZ";

function newCode(): string {
  let s = "";
  for (let i = 0; i < 6; i++) s += ALPHABET[randomInt(ALPHABET.length)];
  return `AK-${s}`;
}

export type CertificateRow = typeof certificates.$inferSelect;

export async function findCertificateByCode(code: string): Promise<CertificateRow | null> {
  const rows = await db.select().from(certificates).where(eq(certificates.code, code.trim().toUpperCase()));
  return rows[0] ?? null;
}

// Идемпотентно по sourceMessageId: если бот повторил запрос (таймаут, ретрай),
// второй сертификат не создаётся — возвращается уже выданный.
export async function issueCertificate(
  c: ParsedCertificate,
  by: { sourceMessageId: string | null; userId: string | null; name: string | null }
): Promise<{ status: "created" | "existing"; row: CertificateRow }> {
  if (by.sourceMessageId) {
    const prev = await db.select().from(certificates).where(eq(certificates.sourceMessageId, by.sourceMessageId));
    if (prev[0]) return { status: "existing", row: prev[0] };
  }
  for (let attempt = 0; attempt < 5; attempt++) {
    try {
      const [row] = await db
        .insert(certificates)
        .values({
          id: randomUUID(),
          code: newCode(),
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
      if (attempt === 4) throw err;
    }
  }
  throw new Error("unreachable");
}

export function certificateSummary(r: { recipient: string; sender: string; amount: number; code: string }): string {
  return `${r.code} — ${formatAmount(r.amount)} сом\nКому: ${r.recipient}\nОт: ${r.sender}`;
}
