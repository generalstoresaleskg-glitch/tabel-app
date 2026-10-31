// Очередь переписок на анализ: новые или дополненные с прошлого анализа.
import { isBotRequest } from "@/lib/clients";
import { pendingChats } from "@/lib/chats";

export const dynamic = "force-dynamic";
export const maxDuration = 60;

export async function GET(request: Request) {
  if (!isBotRequest(request)) return Response.json({ error: "unauthorized" }, { status: 401 });
  const limit = Math.min(20, Math.max(1, Number(new URL(request.url).searchParams.get("limit")) || 8));
  return Response.json(await pendingChats(limit));
}
