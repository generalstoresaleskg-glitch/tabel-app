// Бот присылает сюда сообщения личных чатов номера магазина: историю (после
// привязки) и новые сообщения по мере поступления. Повторы игнорируются.
import { isBotRequest } from "@/lib/clients";
import { ingestChats, type IncomingContact, type IncomingMessage } from "@/lib/chats";

export const dynamic = "force-dynamic";
export const maxDuration = 60;

export async function POST(request: Request) {
  if (!isBotRequest(request)) return Response.json({ error: "unauthorized" }, { status: 401 });
  const body = await request.json().catch(() => ({}));
  const messages: IncomingMessage[] = Array.isArray(body?.messages) ? body.messages.slice(0, 2000) : [];
  const contacts: IncomingContact[] = Array.isArray(body?.contacts) ? body.contacts.slice(0, 5000) : [];
  const r = await ingestChats(messages, contacts);
  return Response.json({ ok: true, ...r });
}
