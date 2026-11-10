// Бот пересылает сюда сообщения «/сертификат …» из общего чата WhatsApp.
// Здесь сертификат разбирается и записывается в базу; картинку бот забирает
// отдельным запросом /api/certificates/image?code=… и отправляет в чат.
import { CERTIFICATE_FORMAT_HINT, isCertificateCommand, parseCertificateMessage } from "@/lib/certificate-parse";
import { certificateSummary, findCertificateByCode, issueCertificate } from "@/lib/certificates";
import { findUserByPhone, isBotRequest } from "@/lib/clients";

export const dynamic = "force-dynamic";

export async function POST(request: Request) {
  if (!isBotRequest(request)) return Response.json({ error: "unauthorized" }, { status: 401 });

  const body = await request.json().catch(() => ({}));
  const text = String(body?.text ?? "");
  const senderPhone = body?.senderPhone ? String(body.senderPhone) : null;
  const senderName = body?.senderName ? String(body.senderName) : null;
  const messageId = body?.messageId ? String(body.messageId) : null;

  if (!isCertificateCommand(text)) return Response.json({ ignored: true });

  // «/сертификат 4827» — прислать картинку уже выданного сертификата ещё раз.
  const codeOnly = /^\s*[\/\\]\s*сертификат\s*[:\-–—]?\s*((?:AK-?|№)?\s*\d{4,5})\s*$/i.exec(text);
  if (codeOnly) {
    const row = await findCertificateByCode(codeOnly[1]);
    if (!row) return Response.json({ ok: false, reply: `❌ Сертификат ${codeOnly[1].trim()} не найден.` });
    return Response.json({
      ok: true,
      status: "existing",
      code: row.code,
      imagePath: `/api/certificates/image?code=${encodeURIComponent(row.code)}`,
      reply: `Отправляю ещё раз: ${certificateSummary(row)}`,
    });
  }

  const parsed = parseCertificateMessage(text);
  if (!parsed.ok) {
    // Пустая команда «/сертификат» — просто показываем шаблон, без «ошибки».
    const bare = text.replace(/^\s*[\/\\]\s*сертификат\s*[:\-–—]?\s*/i, "").trim() === "";
    return Response.json({
      ok: false,
      reply: bare
        ? CERTIFICATE_FORMAT_HINT
        : `❌ Сертификат не создан: ${parsed.errors.join("; ")}.\n\n${CERTIFICATE_FORMAT_HINT}`,
    });
  }

  const user = senderPhone ? await findUserByPhone(senderPhone) : null;
  const { status, row } = await issueCertificate(parsed.certificate, {
    sourceMessageId: messageId,
    userId: user?.id ?? null,
    name: user?.name ?? senderName ?? (senderPhone ? "+" + senderPhone : null),
  });

  return Response.json({
    ok: true,
    status,
    code: row.code,
    imagePath: `/api/certificates/image?code=${encodeURIComponent(row.code)}`,
    reply: `✅ Сертификат создан: ${certificateSummary(row)}\n\nСейчас пришлю картинку 👇`,
  });
}
