// Сколько переписок и сообщений уже собрано — для команды «/статус» в чате.
import { isBotRequest } from "@/lib/clients";
import { chatStats } from "@/lib/chats";

export const dynamic = "force-dynamic";

export async function GET(request: Request) {
  if (!isBotRequest(request)) return Response.json({ error: "unauthorized" }, { status: 401 });
  return Response.json(await chatStats());
}
