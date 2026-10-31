// GET — сжатые итоги всех проанализированных переписок (вход для общего отчёта).
// POST — готовый отчёт от бота; в ответ — число клиентов в базе.
import { isBotRequest } from "@/lib/clients";
import { clientsCount, reportInput, saveReport } from "@/lib/chats";

export const dynamic = "force-dynamic";
export const maxDuration = 60;

export async function GET(request: Request) {
  if (!isBotRequest(request)) return Response.json({ error: "unauthorized" }, { status: 401 });
  return Response.json(await reportInput());
}

export async function POST(request: Request) {
  if (!isBotRequest(request)) return Response.json({ error: "unauthorized" }, { status: 401 });
  const body = await request.json().catch(() => ({}));
  if (!body?.report || typeof body.report !== "object") return Response.json({ error: "report обязателен" }, { status: 400 });
  const id = await saveReport(body.report, Number(body.chatsCount) || 0);
  return Response.json({ ok: true, id, clients: await clientsCount() });
}
