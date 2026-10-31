// Результат анализа одной переписки: сохраняется в переписку, а настоящие
// клиенты (лояльные, покупатели, тёплые, проблемные) — в базу «Клиенты».
import { isBotRequest } from "@/lib/clients";
import { saveAnalysis } from "@/lib/chats";

export const dynamic = "force-dynamic";

export async function POST(request: Request) {
  if (!isBotRequest(request)) return Response.json({ error: "unauthorized" }, { status: 401 });
  const body = await request.json().catch(() => ({}));
  if (!body?.chat) return Response.json({ error: "chat обязателен" }, { status: 400 });
  return Response.json(
    await saveAnalysis({ chat: String(body.chat), phone: body.phone ?? null, ok: !!body.ok, result: body.result })
  );
}
