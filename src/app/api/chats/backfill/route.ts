// Докачка истории: GET — какие переписки ещё не докачаны до начала и их
// самое старое сообщение; POST {chat} — переписка докачана полностью.
import { isBotRequest } from "@/lib/clients";
import { backfillQueue, markHistoryDone } from "@/lib/chats";

export const dynamic = "force-dynamic";
export const maxDuration = 60;

export async function GET(request: Request) {
  if (!isBotRequest(request)) return Response.json({ error: "unauthorized" }, { status: 401 });
  const limit = Math.min(50, Math.max(1, Number(new URL(request.url).searchParams.get("limit")) || 20));
  return Response.json(await backfillQueue(limit));
}

export async function POST(request: Request) {
  if (!isBotRequest(request)) return Response.json({ error: "unauthorized" }, { status: 401 });
  const body = await request.json().catch(() => ({}));
  if (!body?.chat) return Response.json({ error: "chat обязателен" }, { status: 400 });
  await markHistoryDone(String(body.chat));
  return Response.json({ ok: true });
}
