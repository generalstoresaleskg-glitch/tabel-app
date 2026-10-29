// Бот пересылает сюда сообщения «/клиент …» из общего чата WhatsApp.
// Ответ (reply) бот публикует в чат ответом на исходное сообщение.
import { CLIENT_FORMAT_HINT, isClientCommand, parseClientMessage } from "@/lib/client-parse";
import { clientSummary, findUserByPhone, isBotRequest, saveClient } from "@/lib/clients";

export const dynamic = "force-dynamic";

export async function POST(request: Request) {
  if (!isBotRequest(request)) return Response.json({ error: "unauthorized" }, { status: 401 });

  const body = await request.json().catch(() => ({}));
  const text = String(body?.text ?? "");
  const senderPhone = body?.senderPhone ? String(body.senderPhone) : null;
  const senderName = body?.senderName ? String(body.senderName) : null;

  if (!isClientCommand(text)) return Response.json({ ignored: true });

  const parsed = parseClientMessage(text);
  if (!parsed.ok) {
    return Response.json({
      ok: false,
      reply: `❌ Клиент не сохранён: ${parsed.errors.join("; ")}.\n\n${CLIENT_FORMAT_HINT}`,
    });
  }

  const user = senderPhone ? await findUserByPhone(senderPhone) : null;
  const r = await saveClient(parsed.client, {
    source: "whatsapp",
    addedByUserId: user?.id ?? null,
    addedByName: user?.name ?? senderName ?? (senderPhone ? "+" + senderPhone : null),
  });

  return Response.json({
    ok: true,
    status: r.status,
    reply:
      r.status === "created"
        ? `✅ Клиент добавлен: ${clientSummary(parsed.client)}`
        : `✅ Данные клиента обновлены (номер уже был в базе): ${clientSummary(parsed.client)}`,
  });
}
