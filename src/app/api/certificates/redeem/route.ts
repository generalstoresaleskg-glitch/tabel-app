// Бот пересылает сюда «/погасить НОМЕР» из общего чата: сертификат принимается
// целиком и помечается использованным; повторное погашение отклоняется.
import { REDEEM_FORMAT_HINT, isRedeemCommand, redeemCodeFromMessage } from "@/lib/certificate-parse";
import { bishkekStamp, certificateSummary, normalizeCode, redeemCertificate } from "@/lib/certificates";
import { findUserByPhone, isBotRequest } from "@/lib/clients";

export const dynamic = "force-dynamic";

export async function POST(request: Request) {
  if (!isBotRequest(request)) return Response.json({ error: "unauthorized" }, { status: 401 });

  const body = await request.json().catch(() => ({}));
  const text = String(body?.text ?? "");
  const senderPhone = body?.senderPhone ? String(body.senderPhone) : null;
  const senderName = body?.senderName ? String(body.senderName) : null;

  if (!isRedeemCommand(text)) return Response.json({ ignored: true });

  const raw = redeemCodeFromMessage(text);
  if (!raw || !normalizeCode(raw)) {
    return Response.json({ ok: false, reply: `❌ Не понял номер сертификата.\n\n${REDEEM_FORMAT_HINT}` });
  }

  const user = senderPhone ? await findUserByPhone(senderPhone) : null;
  const who = user?.name ?? senderName ?? (senderPhone ? "+" + senderPhone : null);
  const { result, row } = await redeemCertificate(raw, { name: who });

  if (result === "not_found" || !row) {
    return Response.json({ ok: false, reply: `❌ Сертификат ${raw} не найден. Проверьте номер на картинке.` });
  }
  if (result === "already") {
    return Response.json({
      ok: false,
      reply: `❌ Сертификат № ${row.code} уже использован ${bishkekStamp(row.redeemedAt)}${row.redeemedByName ? ` (принял: ${row.redeemedByName})` : ""}.\n\n${certificateSummary(row)}`,
    });
  }
  return Response.json({
    ok: true,
    reply: `✅ Принят сертификат ${certificateSummary(row)}\nВыдан: ${bishkekStamp(row.createdAt)}`,
  });
}
