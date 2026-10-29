// Бот пересылает сюда сообщения «/клиент …» из общего чата WhatsApp.
// Ответ (reply) бот публикует в чат ответом на исходное сообщение.
import { CLIENT_FORMAT_HINT, isClientCommand, parseClientMessage } from "@/lib/client-parse";
import {
  birthdayMessage,
  clientSummary,
  findUserByPhone,
  isBirthdayToday,
  isBotRequest,
  saveClient,
} from "@/lib/clients";
import { todayISO } from "@/lib/dates";

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

  // Если у только что добавленного клиента день рождения сегодня, бот сразу
  // публикует поздравительное напоминание — утренняя рассылка уже могла пройти.
  const c = parsed.client;
  const turns = c.year ? Number(todayISO().slice(0, 4)) - c.year : null;
  const birthday = isBirthdayToday(c)
    ? { id: r.id, message: birthdayMessage([{ name: c.name, phone: c.phone, turns }]) }
    : null;

  return Response.json({
    ok: true,
    status: r.status,
    birthday,
    reply:
      r.status === "created"
        ? `✅ Клиент добавлен: ${clientSummary(parsed.client)}`
        : `✅ Данные клиента обновлены (номер уже был в базе): ${clientSummary(parsed.client)}`,
  });
}
